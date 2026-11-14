export interface Bar {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ResampleInput {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Builds higher-timeframe bars from a lower-timeframe series.
 * A bucket is emitted only when it contains every child candle and its close
 * is already known at `asOfCloseTime`. The current, unfinished bucket is dropped.
 */
export function resampleCompleted(
  candles: readonly ResampleInput[],
  bucketMs: number,
  childMs: number,
  asOfCloseTime: number
): Bar[] {
  if (!(bucketMs > 0) || !(childMs > 0) || bucketMs % childMs !== 0) {
    throw new Error('bucket size must be a positive multiple of the child interval');
  }
  const expected = bucketMs / childMs;
  const bars: Bar[] = [];
  let group: ResampleInput[] = [];
  let groupStart = -1;

  const flush = () => {
    if (group.length !== expected) {
      group = [];
      return;
    }
    const start = groupStart;
    const last = group[group.length - 1];
    const closeTime = start + bucketMs - 1;
    if (group[0].openTime !== start || last.openTime !== start + bucketMs - childMs || closeTime > asOfCloseTime) {
      group = [];
      return;
    }
    let high = group[0].high;
    let low = group[0].low;
    let volume = 0;
    for (const candle of group) {
      if (candle.high > high) high = candle.high;
      if (candle.low < low) low = candle.low;
      volume += candle.volume;
    }
    bars.push({
      openTime: start,
      closeTime,
      open: group[0].open,
      high,
      low,
      close: last.close,
      volume
    });
    group = [];
  };

  for (const candle of candles) {
    if (candle.closeTime > asOfCloseTime) break;
    const start = Math.floor(candle.openTime / bucketMs) * bucketMs;
    if (group.length > 0 && start !== groupStart) flush();
    groupStart = start;
    group.push(candle);
  }
  flush();
  return bars;
}
