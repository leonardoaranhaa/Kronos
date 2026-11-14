import { FUTURES_PROTOCOL } from './protocol';
import { takerImbalance } from './flow';
import type { BookSnapshot, FundingPrint, KlineBar, MetricsPrint } from './parse';

const HOUR_MS = 3_600_000;

export interface HourFrame {
  openTime: number;
  closeTime: number;
  close: number;
  volume: number;
  takerBuyVolume: number;
  fundingRate: number | null;
  fundingTime: number | null;
  previousFundingRate: number | null;
  openInterestValue: number | null;
  longShortRatio: number | null;
  takerLongShortRatio: number | null;
  metricsTime: number | null;
  bookImbalance: number | null;
  bookTime: number | null;
}

export interface FuturesDecision {
  openTime: number;
  closeTime: number;
  entry: number;
  exit: number;
  priceReturn: number;
  /** Sum of funding rates settled strictly after entry and at or before the exit. Positive means longs pay. */
  fundingPaidByLong: number;
  features: number[];
}

export function asOf<T extends { time: number }>(rows: readonly T[], time: number): T | null {
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (rows[mid].time <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found < 0 ? null : rows[found];
}

function logReturn(bars: readonly KlineBar[], index: number, hours: number): number | null {
  const previous = index - hours;
  if (previous < 0) return null;
  if (bars[index].openTime - bars[previous].openTime !== hours * HOUR_MS) return null;
  const start = bars[previous].close;
  const end = bars[index].close;
  if (!(start > 0) || !(end > 0)) return null;
  return Math.log(end / start);
}

function fresh<T extends { time: number }>(row: T | null, closeTime: number, maxAge: number): T | null {
  if (!row) return null;
  if (row.time > closeTime) return null;
  if (closeTime - row.time > maxAge) return null;
  return row;
}

export function buildHourFrames(input: {
  klines: readonly KlineBar[];
  funding: readonly FundingPrint[];
  metrics: readonly MetricsPrint[];
  book: readonly BookSnapshot[];
  maxFundingAgeMs?: number;
  maxMetricsAgeMs?: number;
  maxBookAgeMs?: number;
}): HourFrame[] {
  const fundingAge = input.maxFundingAgeMs ?? FUTURES_PROTOCOL.maxFundingAgeMs;
  const metricsAge = input.maxMetricsAgeMs ?? FUTURES_PROTOCOL.maxMetricsAgeMs;
  const bookAge = input.maxBookAgeMs ?? FUTURES_PROTOCOL.maxBookAgeMs;
  const funding = input.funding.slice().sort((a, b) => a.time - b.time);
  const metrics = input.metrics.slice().sort((a, b) => a.time - b.time);
  const book = input.book.slice().sort((a, b) => a.time - b.time);
  return input.klines.map(bar => {
    const fundingPrint = fresh(asOf(funding, bar.closeTime), bar.closeTime, fundingAge);
    const previousFunding = fundingPrint
      ? funding.filter(print => print.time < fundingPrint.time).at(-1) ?? null
      : null;
    const metric = fresh(asOf(metrics, bar.closeTime), bar.closeTime, metricsAge);
    const bookPrint = fresh(asOf(book, bar.closeTime), bar.closeTime, bookAge);
    return {
      openTime: bar.openTime,
      closeTime: bar.closeTime,
      close: bar.close,
      volume: bar.volume,
      takerBuyVolume: bar.takerBuyVolume,
      fundingRate: fundingPrint?.rate ?? null,
      fundingTime: fundingPrint?.time ?? null,
      previousFundingRate: previousFunding?.rate ?? null,
      openInterestValue: metric?.openInterestValue ?? null,
      longShortRatio: metric?.longShortRatio ?? null,
      takerLongShortRatio: metric?.takerLongShortRatio ?? null,
      metricsTime: metric?.time ?? null,
      bookImbalance: bookPrint?.imbalance ?? null,
      bookTime: bookPrint?.time ?? null
    };
  });
}

function valueAt(frames: readonly HourFrame[], index: number, hoursBack: number, read: (frame: HourFrame) => number | null): number | null {
  const previous = index - hoursBack;
  if (previous < 0) return null;
  if (frames[index].openTime - frames[previous].openTime !== hoursBack * HOUR_MS) return null;
  return read(frames[previous]);
}

function cvdWindow(klines: readonly KlineBar[], index: number, hours: number): number | null {
  const start = index - hours + 1;
  if (start < 0) return null;
  let taker = 0;
  let volume = 0;
  for (let cursor = start; cursor <= index; cursor++) {
    if (cursor > start && klines[cursor].openTime - klines[cursor - 1].openTime !== HOUR_MS) return null;
    taker += klines[cursor].takerBuyVolume;
    volume += klines[cursor].volume;
  }
  return takerImbalance(taker, volume);
}

/**
 * One row per decision. Features use only prints at or before this candle's close.
 * The label uses the close `horizonHours` later and is not an input.
 */
export function buildDecisions(input: {
  klines: readonly KlineBar[];
  frames: readonly HourFrame[];
  funding: readonly FundingPrint[];
  horizonHours?: number;
  lookbackHours?: number;
  anchorHourUtc?: number;
}): FuturesDecision[] {
  const horizon = input.horizonHours ?? FUTURES_PROTOCOL.horizonHours;
  const lookback = input.lookbackHours ?? FUTURES_PROTOCOL.lookbackHours;
  const anchor = input.anchorHourUtc ?? FUTURES_PROTOCOL.anchorHourUtc;
  const funding = input.funding.slice().sort((a, b) => a.time - b.time);
  const { klines, frames } = input;
  if (klines.length !== frames.length) throw new Error('klines e frames precisam do mesmo relógio');
  const decisions: FuturesDecision[] = [];
  for (let index = lookback; index + horizon < klines.length; index++) {
    const hour = new Date(klines[index].openTime).getUTCHours();
    if ((hour - anchor + 24) % horizon !== 0) continue;
    if (klines[index + horizon].openTime - klines[index].openTime !== horizon * HOUR_MS) continue;
    const entry = klines[index].close;
    const exit = klines[index + horizon].close;
    if (!(entry > 0) || !(exit > 0)) continue;
    const features = featureVector(klines, frames, index);
    if (!features) continue;
    let fundingPaidByLong = 0;
    for (const print of funding) {
      if (print.time <= klines[index].closeTime) continue;
      if (print.time > klines[index + horizon].closeTime) break;
      fundingPaidByLong += print.rate;
    }
    decisions.push({
      openTime: klines[index].openTime,
      closeTime: klines[index].closeTime,
      entry,
      exit,
      priceReturn: exit / entry - 1,
      fundingPaidByLong,
      features
    });
  }
  return decisions;
}

export function featureVector(
  klines: readonly KlineBar[],
  frames: readonly HourFrame[],
  index: number
): number[] | null {
  const frame = frames[index];
  const ret1 = logReturn(klines, index, 1);
  const ret4 = logReturn(klines, index, 4);
  const ret24 = logReturn(klines, index, 24);
  const taker = takerImbalance(klines[index].takerBuyVolume, klines[index].volume);
  const cvd = cvdWindow(klines, index, 4);
  const oiNow = frame.openInterestValue;
  const oi4 = valueAt(frames, index, 4, item => item.openInterestValue);
  const oi24 = valueAt(frames, index, 24, item => item.openInterestValue);
  const ls24 = valueAt(frames, index, 24, item => item.longShortRatio);
  if (
    ret1 === null || ret4 === null || ret24 === null || taker === null || cvd === null
    || frame.fundingRate === null || frame.previousFundingRate === null
    || oiNow === null || oi4 === null || oi24 === null || !(oiNow > 0) || !(oi4 > 0) || !(oi24 > 0)
    || frame.longShortRatio === null || ls24 === null
    || frame.bookImbalance === null || frame.takerLongShortRatio === null
  ) return null;
  const features = [
    ret1,
    ret4,
    ret24,
    frame.fundingRate,
    frame.fundingRate - frame.previousFundingRate,
    Math.log(oiNow / oi4),
    Math.log(oiNow / oi24),
    frame.longShortRatio,
    frame.longShortRatio - ls24,
    taker,
    cvd,
    frame.bookImbalance,
    frame.takerLongShortRatio
  ];
  if (features.length !== FUTURES_PROTOCOL.features.length) return null;
  if (features.some(value => !Number.isFinite(value))) return null;
  return features;
}
