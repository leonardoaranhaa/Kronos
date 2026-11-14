import { createHash } from 'node:crypto';
import { CanonicalCandle } from '../shared/types';
import { validateCanonicalCandle } from './candle-validation';

/** Converts one Binance REST kline row into the canonical historical schema. */
export function normalizeBinanceKlineRow(
  row: unknown,
  symbol: string,
  interval: string,
  ingestedAt: number,
  now: number
): CanonicalCandle | null {
  if (!Array.isArray(row) || row.length < 11) {
    throw new Error('Malformed Binance kline row: expected at least 11 fields');
  }

  const candle: CanonicalCandle = {
    venue: 'binance',
    symbol: symbol.toUpperCase(),
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
    ingestedAt
  };

  const validation = validateCanonicalCandle(candle);
  if (!validation.valid) {
    throw new Error(`Invalid Binance candle at ${candle.openTime}: ${validation.errors.join(', ')}`);
  }
  if (candle.closeTime >= now) return null;
  return candle;
}

/** Returns the next REST pagination cursor and rejects non-advancing pages. */
export function getNextBinanceCursor(page: unknown[], cursor: number, intervalMs: number): number {
  if (page.length === 0) throw new Error('Binance pagination returned an empty page');
  if (!Number.isFinite(cursor) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('Binance pagination cursor and interval must be finite; interval must be positive');
  }

  const openTimes = page.map((row, index) => {
    if (!Array.isArray(row) || !Number.isFinite(Number(row[0]))) {
      throw new Error(`Binance pagination returned an invalid row at index ${index}`);
    }
    return Number(row[0]);
  });

  if (openTimes[0] < cursor) {
    throw new Error('Binance pagination page begins before the requested cursor');
  }
  for (let index = 1; index < openTimes.length; index += 1) {
    if (openTimes[index] <= openTimes[index - 1]) {
      throw new Error('Binance pagination rows are not strictly chronological');
    }
  }

  const nextCursor = openTimes[openTimes.length - 1] + intervalMs;
  if (!Number.isFinite(nextCursor) || nextCursor <= cursor) {
    throw new Error('Binance pagination did not advance; aborting to prevent an infinite loop');
  }
  return nextCursor;
}

export function sha256Content(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
