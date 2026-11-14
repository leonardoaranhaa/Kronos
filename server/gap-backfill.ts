import { CanonicalCandle } from '../shared/types';
import { getNextBinanceCursor, normalizeBinanceKlineRow } from './binance-import-core';

/** Open times strictly between two candles, one interval apart. */
export function gapOpenTimes(lastOpenTime: number, nextOpenTime: number, intervalMs: number): number[] {
  if (!Number.isFinite(lastOpenTime) || !Number.isFinite(nextOpenTime) || !(intervalMs > 0)) return [];
  const missing: number[] = [];
  for (let openTime = lastOpenTime + intervalMs; openTime < nextOpenTime; openTime += intervalMs) {
    missing.push(openTime);
    if (missing.length > 5_000) break;
  }
  return missing;
}

export interface GapBackfillRequest {
  lastOpenTime: number;
  nextOpenTime: number;
  symbol: string;
  interval: string;
  intervalMs: number;
  restBaseUrl: string;
  now?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches completed public klines that fell between the snapshot and the live feed.
 * Returns only candles that keep the series contiguous. The caller must not append
 * a live candle when this list stops short of it.
 */
export async function backfillGap(request: GapBackfillRequest): Promise<CanonicalCandle[]> {
  const missing = gapOpenTimes(request.lastOpenTime, request.nextOpenTime, request.intervalMs);
  if (missing.length === 0) return [];
  if (missing.length >= 5_000) {
    throw new Error('Gap is larger than 5000 candles; refusing to backfill');
  }

  const fetchImpl = request.fetchImpl ?? fetch;
  const now = request.now ?? Date.now();
  const base = request.restBaseUrl.replace(/\/$/, '');
  const wanted = new Set(missing);
  const found: CanonicalCandle[] = [];
  let cursor = request.lastOpenTime + request.intervalMs;

  while (cursor < request.nextOpenTime && found.length < missing.length) {
    const url = new URL(`${base}/api/v3/klines`);
    url.searchParams.set('symbol', request.symbol.toUpperCase());
    url.searchParams.set('interval', request.interval);
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(request.nextOpenTime - 1));
    url.searchParams.set('limit', '1000');
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Gap backfill failed: HTTP ${response.status}`);
    const page = await response.json() as unknown;
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      const candle = normalizeBinanceKlineRow(row, request.symbol, request.interval, now, now);
      if (candle && wanted.has(candle.openTime)) found.push(candle);
    }
    const next = getNextBinanceCursor(page, cursor, request.intervalMs);
    if (next <= cursor) break;
    cursor = next;
    if (page.length < 1000) break;
  }

  found.sort((a, b) => a.openTime - b.openTime);
  const contiguous: CanonicalCandle[] = [];
  let expected = request.lastOpenTime + request.intervalMs;
  for (const candle of found) {
    if (candle.openTime !== expected) break;
    contiguous.push(candle);
    expected += request.intervalMs;
  }
  return contiguous;
}
