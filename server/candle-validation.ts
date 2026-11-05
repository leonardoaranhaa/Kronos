import {
  CanonicalCandle,
  CandleSeriesQuality,
  CandleValidationResult
} from '../shared/types';

const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
  '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
  '4h': 14_400_000, '6h': 21_600_000, '8h': 28_800_000,
  '12h': 43_200_000, '1d': 86_400_000, '3d': 259_200_000,
  '1w': 604_800_000
};

export function intervalToMilliseconds(interval: string): number | null {
  return INTERVAL_MS[interval] ?? null;
}

export function validateCanonicalCandle(candle: CanonicalCandle): CandleValidationResult {
  const errors: string[] = [];
  const intervalMs = intervalToMilliseconds(candle.interval);

  if (!candle.venue.trim()) errors.push('venue is required');
  if (!candle.symbol.trim()) errors.push('symbol is required');
  if (intervalMs === null) errors.push(`unsupported interval: ${candle.interval}`);

  const fields = [
    ['openTime', candle.openTime], ['closeTime', candle.closeTime],
    ['ingestedAt', candle.ingestedAt], ['open', candle.open],
    ['high', candle.high], ['low', candle.low], ['close', candle.close],
    ['volume', candle.volume]
  ] as const;
  for (const [field, value] of fields) {
    if (!Number.isFinite(value)) errors.push(`${field} must be finite`);
  }

  if (candle.openTime < 0 || candle.closeTime < 0 || candle.ingestedAt < 0) {
    errors.push('timestamps must be non-negative Unix milliseconds');
  }
  if (candle.closeTime <= candle.openTime) errors.push('closeTime must be later than openTime');
  if (intervalMs !== null) {
    if (candle.openTime % intervalMs !== 0) errors.push('openTime is not aligned to the interval boundary');
    if (candle.closeTime !== candle.openTime + intervalMs - 1) {
      errors.push('closeTime does not match the inclusive interval boundary');
    }
  }
  if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
    errors.push('OHLC prices must be greater than zero');
  }
  if (candle.volume < 0) errors.push('volume cannot be negative');
  if (candle.high < candle.low) errors.push('high cannot be lower than low');
  if (candle.high < candle.open || candle.high < candle.close) {
    errors.push('high must be greater than or equal to open and close');
  }
  if (candle.low > candle.open || candle.low > candle.close) {
    errors.push('low must be less than or equal to open and close');
  }
  if (!['historical', 'websocket', 'replay'].includes(candle.source)) {
    errors.push('source must be historical, websocket or replay');
  }
  return { valid: errors.length === 0, errors };
}

/** Audits series without silently sorting, deduplicating, repairing or discarding input. */
export function auditCandleSeries(candles: CanonicalCandle[]): CandleSeriesQuality {
  const errors: string[] = [];
  const duplicates = new Set<number>();
  const seen = new Set<number>();
  const validCandles: CanonicalCandle[] = [];

  for (const candle of candles) {
    const result = validateCanonicalCandle(candle);
    if (!result.valid) {
      errors.push(...result.errors.map(error => `${candle.openTime}: ${error}`));
      continue;
    }
    validCandles.push(candle);
    if (seen.has(candle.openTime)) duplicates.add(candle.openTime);
    seen.add(candle.openTime);
  }

  const sorted = [...validCandles].sort((a, b) => a.openTime - b.openTime);
  const missingIntervals: number[] = [];
  if (sorted.length > 1) {
    const intervalMs = intervalToMilliseconds(sorted[0].interval);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].venue !== sorted[0].venue ||
          sorted[i].symbol !== sorted[0].symbol ||
          sorted[i].interval !== sorted[0].interval) {
        errors.push('series contains mixed venue, symbol or interval values');
        break;
      }
      const delta = sorted[i].openTime - sorted[i - 1].openTime;
      if (delta <= 0) continue;
      if (intervalMs !== null && delta > intervalMs && delta % intervalMs === 0) {
        for (let missing = sorted[i - 1].openTime + intervalMs;
             missing < sorted[i].openTime; missing += intervalMs) {
          missingIntervals.push(missing);
        }
      } else if (intervalMs !== null && delta !== intervalMs) {
        errors.push(`unexpected interval spacing between ${sorted[i - 1].openTime} and ${sorted[i].openTime}`);
      }
    }
  }
  if (duplicates.size > 0) errors.push('series contains duplicate openTime values');
  if (missingIntervals.length > 0) errors.push('series contains missing intervals');

  return {
    valid: errors.length === 0,
    errors,
    duplicateOpenTimes: [...duplicates].sort((a, b) => a - b),
    missingIntervals,
    receivedCount: candles.length,
    acceptedCount: validCandles.length - duplicates.size
  };
}
