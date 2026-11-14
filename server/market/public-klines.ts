export const PUBLIC_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type PublicInterval = (typeof PUBLIC_INTERVALS)[number];

export interface PublicCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function isPublicInterval(value: string): value is PublicInterval {
  return (PUBLIC_INTERVALS as readonly string[]).includes(value);
}

function valid(candle: PublicCandle): boolean {
  return candle.open > 0
    && candle.high >= candle.low
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close)
    && candle.volume >= 0;
}

/** Keeps well-formed public klines, ordered and unique by open time. The last copy wins. */
export function parsePublicKlines(payload: unknown): PublicCandle[] {
  if (!Array.isArray(payload)) return [];
  const candles: PublicCandle[] = [];
  for (const row of payload) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const candle: PublicCandle = {
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5])
    };
    if (!Object.values(candle).every(Number.isFinite) || !valid(candle)) continue;
    candles.push(candle);
  }
  candles.sort((a, b) => a.time - b.time);
  const unique: PublicCandle[] = [];
  for (const candle of candles) {
    const last = unique[unique.length - 1];
    if (last && last.time === candle.time) unique[unique.length - 1] = candle;
    else unique.push(candle);
  }
  return unique;
}

export function mergePublicCandles(older: readonly PublicCandle[], newer: readonly PublicCandle[]): PublicCandle[] {
  return parsePublicKlines([
    ...older.map(candle => [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume]),
    ...newer.map(candle => [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume])
  ]);
}
