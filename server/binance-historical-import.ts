import { loadEnvFile } from './load-env';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CanonicalCandle } from '../shared/types';
import { auditCandleSeries, intervalToMilliseconds, validateCanonicalCandle } from './candle-validation';

loadEnvFile();

const symbol = (process.env.SYMBOL || 'BTCUSDT').toUpperCase();
const interval = process.env.TIMEFRAME || '5m';
const intervalMs = intervalToMilliseconds(interval);
if (intervalMs === null) throw new Error(`Unsupported interval: ${interval}`);

const endTime = Number(process.env.END_TIME || Date.now());
const startTime = Number(process.env.START_TIME || (endTime - intervalMs * 1000));
if (!Number.isFinite(startTime) || startTime < 0 || startTime >= endTime) {
  throw new Error('START_TIME and END_TIME must be valid Unix milliseconds with START_TIME < END_TIME');
}

const baseUrl = (process.env.BINANCE_REST_BASE_URL || 'https://data-api.binance.vision').replace(/\/$/, '');
const rawPages: string[] = [];
const candles: CanonicalCandle[] = [];
const now = Date.now();

async function fetchPage(cursor: number): Promise<unknown[]> {
  const url = new URL(`${baseUrl}/api/v3/klines`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('startTime', String(cursor));
  url.searchParams.set('endTime', String(endTime));
  url.searchParams.set('limit', '1000');

  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) {
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error('Binance klines response was not an array');
      return payload;
    }
    if (response.status === 418 || response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(30_000, 1_000 * (2 ** attempt));
      await new Promise(resolve => setTimeout(resolve, waitMs));
      continue;
    }
    throw new Error(`Binance klines request failed: HTTP ${response.status} ${await response.text()}`);
  }
  throw new Error('Binance rate limit retry budget exhausted');
}

async function main() {
  let cursor = startTime;
  let pageCount = 0;

  while (cursor < endTime) {
    const page = await fetchPage(cursor);
    if (page.length === 0) break;
    pageCount += 1;
    rawPages.push(JSON.stringify({ fetchedAt: Date.now(), cursor, rows: page }));

    for (const [rowIndex, row] of page.entries()) {
      if (!Array.isArray(row) || row.length < 11) {
        throw new Error(`Malformed Binance kline row at page ${pageCount}, index ${rowIndex}: expected at least 11 fields`);
      }
      const candle: CanonicalCandle = {
        venue: 'binance',
        symbol,
        interval,
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
        quoteVolume: Number(row[7]),
        source: 'historical',
        ingestedAt: Date.now()
      };
      if (candle.closeTime >= now) continue;
      const validation = validateCanonicalCandle(candle);
      if (validation.valid) candles.push(candle);
      else throw new Error(`Invalid Binance candle at ${candle.openTime}: ${validation.errors.join(', ')}`);
    }

    const lastRow = page[page.length - 1];
    if (!Array.isArray(lastRow) || !Number.isFinite(Number(lastRow[0]))) {
      throw new Error('Binance pagination returned an invalid final row');
    }
    const nextCursor = Number(lastRow[0]) + intervalMs;
    if (!Number.isFinite(nextCursor) || nextCursor <= cursor) {
      throw new Error('Binance pagination did not advance; aborting to prevent an infinite loop');
    }
    cursor = nextCursor;
    if (page.length < 1000) break;
  }

  if (candles.length === 0) {
    throw new Error('Historical import produced zero completed candles; no dataset or manifest was written');
  }

  candles.sort((a, b) => a.openTime - b.openTime);
  const quality = auditCandleSeries(candles);
  const createdAt = new Date().toISOString().replace(/[:.]/g, '-');
  const stem = `${symbol}_${interval}_${startTime}_${endTime}_${createdAt}`;
  const rawDir = join('data', 'raw');
  const normalizedDir = join('data', 'normalized');
  const manifestDir = join('data', 'manifests');
  await Promise.all([mkdir(rawDir, { recursive: true }), mkdir(normalizedDir, { recursive: true }), mkdir(manifestDir, { recursive: true })]);

  const rawPath = join(rawDir, `${stem}.jsonl`);
  const normalizedPath = join(normalizedDir, `${stem}.jsonl`);
  const rawContent = rawPages.join('\n') + (rawPages.length ? '\n' : '');
  const normalizedContent = candles.map(candle => JSON.stringify(candle)).join('\n') + '\n';
  const rawSha256 = createHash('sha256').update(rawContent).digest('hex');
  const normalizedSha256 = createHash('sha256').update(normalizedContent).digest('hex');

  await writeFile(rawPath, rawContent, { flag: 'wx' });
  await writeFile(normalizedPath, normalizedContent, { flag: 'wx' });
  const manifest = {
    venue: 'binance',
    symbol,
    interval,
    startTime,
    endTime,
    createdAt: new Date().toISOString(),
    pageCount,
    candleCount: candles.length,
    sourceEndpoint: `${baseUrl}/api/v3/klines`,
    rawPath,
    normalizedPath,
    rawSha256,
    normalizedSha256,
    quality
  };
  const manifestPath = join(manifestDir, `${stem}.manifest.json`);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });

  console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
  if (!quality.valid) {
    console.error('Dataset was saved, but the quality audit failed. Do not load it into the model until gaps/duplicates are resolved.');
    process.exitCode = 2;
  }
}

main().catch(error => {
  console.error('[Binance Historical Import Error]', error);
  process.exitCode = 1;
});
