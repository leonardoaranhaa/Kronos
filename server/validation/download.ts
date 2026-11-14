import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanonicalCandle } from '../../shared/types';
import { getNextBinanceCursor, normalizeBinanceKlineRow, sha256Content } from '../binance-import-core';
import { auditCandleSeries, intervalToMilliseconds } from '../candle-validation';
import type { MarketBar } from '../crawler/types';

const DEFAULT_BASE = 'https://data-api.binance.vision';

export async function downloadKlines(options: {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  base?: string;
  cacheDir?: string;
}): Promise<{ candles: CanonicalCandle[]; sha256: string; path: string | null }> {
  const intervalMs = intervalToMilliseconds(options.interval);
  if (intervalMs === null) throw new Error(`unsupported interval ${options.interval}`);
  const base = (options.base || process.env.BINANCE_REST_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const cacheDir = options.cacheDir;
  const cachePath = cacheDir
    ? join(cacheDir, `${options.symbol}_${options.interval}_${options.startTime}_${options.endTime}.jsonl`)
    : null;
  if (cachePath) {
    try {
      const cached = readFileSync(cachePath, 'utf8');
      const candles = cached.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as CanonicalCandle);
      const quality = auditCandleSeries(candles);
      if (quality.valid && candles.length > 0) {
        return { candles, sha256: sha256Content(cached), path: cachePath };
      }
    } catch {
      // A missing cache is the normal path. A broken cache is downloaded again.
    }
  }
  const now = Date.now();
  const candles: CanonicalCandle[] = [];
  let cursor = options.startTime;
  while (cursor < options.endTime) {
    const url = new URL(`${base}/api/v3/klines`);
    url.searchParams.set('symbol', options.symbol);
    url.searchParams.set('interval', options.interval);
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(options.endTime));
    url.searchParams.set('limit', '1000');
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${options.symbol} ${options.interval} HTTP ${response.status}`);
    const page = await response.json() as unknown[];
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      const candle = normalizeBinanceKlineRow(row, options.symbol, options.interval, now, now);
      if (candle && candle.openTime >= options.startTime && candle.openTime < options.endTime) {
        if (Array.isArray(row) && Number.isFinite(Number(row[10])) && Number(row[10]) >= 0) {
          (candle as CanonicalCandle & { takerBuyQuote?: number }).takerBuyQuote = Number(row[10]);
        }
        candles.push(candle);
      }
    }
    cursor = getNextBinanceCursor(page, cursor, intervalMs);
    if (page.length < 1000) break;
  }
  candles.sort((a, b) => a.openTime - b.openTime);
  const quality = auditCandleSeries(candles);
  if (!quality.valid) {
    throw new Error(`${options.symbol} ${options.interval} failed the candle audit: ${quality.errors.join('; ')}`);
  }
  const body = candles.map(candle => JSON.stringify(candle)).join('\n') + (candles.length ? '\n' : '');
  if (cachePath) {
    mkdirSync(cacheDir as string, { recursive: true });
    writeFileSync(cachePath, body);
  }
  return { candles, sha256: sha256Content(body), path: cachePath };
}

export function asMarketBars(candles: readonly CanonicalCandle[]): MarketBar[] {
  return candles.map(candle => ({
    openTime: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    quoteVolume: candle.quoteVolume ?? 0,
    takerBuyQuote: Number((candle as CanonicalCandle & { takerBuyQuote?: number }).takerBuyQuote ?? 0)
  }));
}
