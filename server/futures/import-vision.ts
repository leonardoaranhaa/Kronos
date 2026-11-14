import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { hourlyAggFlow } from './flow';
import {
  parseAggTradeCsv,
  parseBookDepthCsv,
  parseFundingCsv,
  parseKlineCsv,
  parseMetricsCsv,
  type BookSnapshot,
  type FundingPrint,
  type KlineBar,
  type MetricsPrint
} from './parse';
import { FUTURES_PROTOCOL } from './protocol';
import { symbolDir } from './paths';
import { readZipText } from './zip';
import { writeJsonl } from './store';

const VISION = 'https://data.binance.vision/data/futures/um';

export interface AggCheck {
  days: string[];
  hours: number;
  compared: number;
  maxAbsBaseDiff: number | null;
  meanAbsBaseDiff: number | null;
}

export interface CoverageProbe {
  url: string;
  status: number | null;
  error: string | null;
}

export interface SymbolManifest {
  symbol: string;
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  klines: number;
  funding: number;
  metrics: number;
  bookHours: number;
  firstOpenTime: number | null;
  lastOpenTime: number | null;
  klinesSha256: string | null;
  missingMetricDays: string[];
  missingBookDays: string[];
  aggTradeCheck: AggCheck | null;
  coverage: CoverageProbe[];
  source: string;
}

export function listMonths(startMs: number, endMs: number): string[] {
  const months: string[] = [];
  const cursor = new Date(startMs);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() < endMs) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    months.push(`${year}-${month}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export function listDays(startMs: number, endMs: number): string[] {
  const days: string[] = [];
  for (let cursor = startMs; cursor < endMs; cursor += 86_400_000) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchZip(url: string, attempts = 4): Promise<{ status: number; text: string | null }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (response.status === 404) return { status: 404, text: null };
      if (response.status === 429 || response.status >= 500) {
        await sleep(400 * (attempt + 1));
        lastError = new Error(`HTTP ${response.status}`);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
      const text = readZipText(Buffer.from(await response.arrayBuffer())).text;
      return { status: response.status, text };
    } catch (error) {
      lastError = error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${url}: ${String(lastError)}`);
}

async function pool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

async function probe(url: string): Promise<CoverageProbe> {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20_000) });
    return { url, status: response.status, error: response.ok ? null : `HTTP ${response.status}` };
  } catch (error) {
    return { url, status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function sha256(rows: readonly object[]): string {
  const body = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  return createHash('sha256').update(body).digest('hex');
}

export async function importFuturesVision(options: {
  symbols?: readonly string[];
  startMs?: number;
  endMs?: number;
  root: string;
  concurrency?: number;
  onProgress?: (message: string) => void;
}): Promise<SymbolManifest[]> {
  const symbols = options.symbols ?? [...FUTURES_PROTOCOL.symbols];
  const startMs = options.startMs ?? Date.parse(FUTURES_PROTOCOL.windowStart);
  const endMs = options.endMs ?? Date.parse(FUTURES_PROTOCOL.windowEnd);
  const months = listMonths(startMs, endMs);
  const days = listDays(startMs, endMs);
  const progress = options.onProgress ?? (() => undefined);
  const coverage = await Promise.all([
    probe(`${VISION}/daily/metrics/BTCUSDT/BTCUSDT-metrics-2020-10-01.zip`),
    probe(`${VISION}/daily/bookDepth/BTCUSDT/BTCUSDT-bookDepth-2022-12-01.zip`),
    probe(`${VISION}/daily/bookDepth/BTCUSDT/BTCUSDT-bookDepth-2023-03-01.zip`),
    probe(`${VISION}/daily/liquidationSnapshot/BTCUSDT/BTCUSDT-liquidationSnapshot-2025-11-01.zip`),
    probe('https://fapi.binance.com/fapi/v1/allForceOrders?symbol=BTCUSDT&limit=1')
  ]);
  progress(`cobertura: ${coverage.map(item => `${item.status ?? 'erro'} ${item.url}`).join(' | ')}`);
  const manifests: SymbolManifest[] = [];
  for (const symbol of symbols) {
    progress(`${symbol}: candles e funding, ${months.length} meses`);
    const klines: KlineBar[] = [];
    const funding: FundingPrint[] = [];
    for (const month of months) {
      const klineUrl = `${VISION}/monthly/klines/${symbol}/1h/${symbol}-1h-${month}.zip`;
      const fundingUrl = `${VISION}/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${month}.zip`;
      const [klineZip, fundingZip] = await Promise.all([fetchZip(klineUrl), fetchZip(fundingUrl)]);
      if (!klineZip.text) throw new Error(`${symbol} sem klines em ${month}`);
      if (!fundingZip.text) throw new Error(`${symbol} sem funding em ${month}`);
      klines.push(...parseKlineCsv(klineZip.text).filter(bar => bar.openTime >= startMs && bar.openTime < endMs));
      funding.push(...parseFundingCsv(fundingZip.text).filter(print => print.time >= startMs && print.time < endMs + 8 * 3_600_000));
    }
    klines.sort((a, b) => a.openTime - b.openTime);
    funding.sort((a, b) => a.time - b.time);
    const metrics: MetricsPrint[] = [];
    const book: BookSnapshot[] = [];
    const missingMetricDays: string[] = [];
    const missingBookDays: string[] = [];
    let finished = 0;
    progress(`${symbol}: métricas e livro, ${days.length} dias`);
    await pool(days, options.concurrency ?? 8, async day => {
      const metricUrl = `${VISION}/daily/metrics/${symbol}/${symbol}-metrics-${day}.zip`;
      const bookUrl = `${VISION}/daily/bookDepth/${symbol}/${symbol}-bookDepth-${day}.zip`;
      const [metricZip, bookZip] = await Promise.all([fetchZip(metricUrl), fetchZip(bookUrl)]);
      if (!metricZip.text) missingMetricDays.push(day);
      else metrics.push(...parseMetricsCsv(metricZip.text));
      if (!bookZip.text) missingBookDays.push(day);
      else book.push(...parseBookDepthCsv(bookZip.text));
      finished += 1;
      if (finished % 60 === 0) progress(`${symbol}: ${finished}/${days.length} dias`);
    });
    metrics.sort((a, b) => a.time - b.time);
    book.sort((a, b) => a.time - b.time);
    const dedupedKlines = dedupe(klines, bar => bar.openTime);
    const dedupedFunding = dedupe(funding, print => print.time);
    const dedupedMetrics = dedupe(metrics, print => print.time);
    const dedupedBook = dedupe(book, print => print.time);
    const aggTradeCheck = await compareAggTrades(symbol, dedupedKlines, progress);
    const directory = symbolDir(options.root, symbol);
    writeJsonl(join(directory, 'klines-1h.jsonl'), dedupedKlines);
    writeJsonl(join(directory, 'funding.jsonl'), dedupedFunding);
    writeJsonl(join(directory, 'metrics.jsonl'), dedupedMetrics);
    writeJsonl(join(directory, 'book-1h.jsonl'), dedupedBook);
    const manifest: SymbolManifest = {
      symbol,
      generatedAt: new Date().toISOString(),
      windowStart: new Date(startMs).toISOString(),
      windowEnd: new Date(endMs).toISOString(),
      klines: dedupedKlines.length,
      funding: dedupedFunding.length,
      metrics: dedupedMetrics.length,
      bookHours: dedupedBook.length,
      firstOpenTime: dedupedKlines[0]?.openTime ?? null,
      lastOpenTime: dedupedKlines[dedupedKlines.length - 1]?.openTime ?? null,
      klinesSha256: sha256(dedupedKlines),
      missingMetricDays: missingMetricDays.sort(),
      missingBookDays: missingBookDays.sort(),
      aggTradeCheck,
      coverage,
      source: VISION
    };
    writeJsonl(join(directory, 'manifest.jsonl'), [manifest]);
    manifests.push(manifest);
    progress(`${symbol}: ${manifest.klines} candles, ${manifest.metrics} métricas, ${manifest.bookHours} horas de livro`);
  }
  return manifests;
}

async function compareAggTrades(
  symbol: string,
  klines: readonly KlineBar[],
  progress: (message: string) => void
): Promise<AggCheck | null> {
  const byOpen = new Map(klines.map(bar => [bar.openTime, bar]));
  let hours = 0;
  let compared = 0;
  let absSum = 0;
  let maxAbs = 0;
  for (const day of FUTURES_PROTOCOL.aggTradeCheckDays) {
    const url = `${VISION}/daily/aggTrades/${symbol}/${symbol}-aggTrades-${day}.zip`;
    progress(`${symbol}: aggTrades ${day}`);
    const zip = await fetchZip(url);
    if (!zip.text) continue;
    const flow = hourlyAggFlow(parseAggTradeCsv(zip.text));
    hours += flow.length;
    for (const hour of flow) {
      const bar = byOpen.get(hour.openTime);
      if (!bar) continue;
      const diff = Math.abs(hour.buyQuantity - bar.takerBuyVolume);
      compared += 1;
      absSum += diff;
      if (diff > maxAbs) maxAbs = diff;
    }
  }
  if (compared === 0) return { days: [...FUTURES_PROTOCOL.aggTradeCheckDays], hours, compared, maxAbsBaseDiff: null, meanAbsBaseDiff: null };
  return {
    days: [...FUTURES_PROTOCOL.aggTradeCheckDays],
    hours,
    compared,
    maxAbsBaseDiff: maxAbs,
    meanAbsBaseDiff: absSum / compared
  };
}

function dedupe<T>(rows: readonly T[], timeOf: (row: T) => number): T[] {
  const sorted = rows.slice().sort((a, b) => timeOf(a) - timeOf(b));
  const unique: T[] = [];
  for (const row of sorted) {
    const last = unique[unique.length - 1];
    if (last && timeOf(last) === timeOf(row)) unique[unique.length - 1] = row;
    else unique.push(row);
  }
  return unique;
}
