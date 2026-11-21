import { featureVector, type HourFrame } from '../futures/align';
import type { FundingPrint, KlineBar } from '../futures/parse';
import { VOL_PROTOCOL } from './protocol';

const HOUR_MS = 3_600_000;

export interface VolDecision {
  openTime: number;
  barIndex: number;
  /** Simple return over the next horizon. The economic book uses this, never the model. */
  priceReturn: number;
  /** Absolute log return over the next horizon. A label, never a feature. */
  absoluteLogReturn: number;
  /** Sum of squared hourly log returns over the next horizon. A label. */
  realizedVariance: number;
  /** Squared log return over the next horizon. The Kronos dispersion target. */
  squaredLogReturn: number;
  fundingPaidByLong: number;
  /** Realized variance of the last horizon, known at this close. */
  rvDay: number;
  /** Average realized variance of the last `weekSpan` horizons. */
  rvWeek: number;
  /** Average realized variance of the last `monthSpan` horizons. */
  rvMonth: number;
  /** EWMA hourly variance times the horizon. Known at this close. */
  ewmaVariance: number;
  /** Absolute log return of the last horizon. */
  absPast: number;
  /** Futures features known at this close. Null when a print is missing or stale. */
  features: number[] | null;
}

export function hourlyLogReturns(closes: readonly number[]): number[] {
  const returns = new Array<number>(closes.length).fill(Number.NaN);
  for (let index = 1; index < closes.length; index++) {
    const previous = closes[index - 1];
    const current = closes[index];
    if (!(previous > 0) || !(current > 0)) continue;
    returns[index] = Math.log(current / previous);
  }
  return returns;
}

/** EWMA of squared log returns. v[t] uses r[t] and nothing later. */
export function ewmaPath(returns: readonly number[], lambda = VOL_PROTOCOL.ewmaLambda): number[] {
  const path = new Array<number>(returns.length).fill(Number.NaN);
  let state = Number.NaN;
  for (let index = 1; index < returns.length; index++) {
    if (!Number.isFinite(returns[index])) continue;
    const square = returns[index] * returns[index];
    state = Number.isFinite(state) ? lambda * state + (1 - lambda) * square : square;
    path[index] = state;
  }
  return path;
}

function contiguous(klines: readonly KlineBar[], from: number, to: number): boolean {
  if (from < 0 || to >= klines.length) return false;
  for (let index = from + 1; index <= to; index++) {
    if (klines[index].openTime - klines[index - 1].openTime !== HOUR_MS) return false;
  }
  return true;
}

function sumSquares(returns: readonly number[], from: number, to: number): number | null {
  let sum = 0;
  for (let index = from; index <= to; index++) {
    if (!Number.isFinite(returns[index])) return null;
    sum += returns[index] * returns[index];
  }
  return sum;
}

function fundingBetween(funding: readonly FundingPrint[], after: number, until: number): number {
  let paid = 0;
  for (const print of funding) {
    if (print.time <= after) continue;
    if (print.time > until) break;
    paid += print.rate;
  }
  return paid;
}

/**
 * One decision per non-overlapping block. Features stop at this close.
 * Labels use the next `horizonHours` and are not returned inside the feature fields.
 */
export function buildVolSample(input: {
  klines: readonly KlineBar[];
  funding?: readonly FundingPrint[];
  frames?: readonly HourFrame[];
  horizonHours: number;
  windowStartMs?: number;
  windowEndMs?: number;
}): { decisions: VolDecision[]; hourlyReturns: number[] } {
  const horizon = input.horizonHours;
  const lookback = VOL_PROTOCOL.monthSpan * horizon;
  const start = input.windowStartMs ?? Date.parse(VOL_PROTOCOL.windowStart);
  const end = input.windowEndMs ?? Date.parse(VOL_PROTOCOL.windowEnd);
  const klines = input.klines
    .filter(bar => bar.openTime >= start && bar.openTime < end)
    .slice()
    .sort((a, b) => a.openTime - b.openTime);
  const funding = (input.funding ?? []).slice().sort((a, b) => a.time - b.time);
  const frames = input.frames;
  if (frames && frames.length !== input.klines.length) {
    throw new Error('frames e klines precisam do mesmo relógio, antes do corte da janela');
  }
  const frameByOpen = new Map<number, HourFrame>();
  if (frames) {
    for (let index = 0; index < input.klines.length; index++) frameByOpen.set(input.klines[index].openTime, frames[index]);
  }
  const alignedFrames: (HourFrame | undefined)[] = klines.map(bar => frameByOpen.get(bar.openTime));
  const closes = klines.map(bar => bar.close);
  const returns = hourlyLogReturns(closes);
  const ewma = ewmaPath(returns);
  const decisions: VolDecision[] = [];
  for (let index = lookback; index + horizon < klines.length; index++) {
    const hour = new Date(klines[index].openTime).getUTCHours();
    if ((hour - 0 + 24) % horizon !== 0) continue;
    if (!contiguous(klines, index - lookback, index + horizon)) continue;
    const entry = closes[index];
    const exit = closes[index + horizon];
    if (!(entry > 0) || !(exit > 0)) continue;
    const realized = sumSquares(returns, index + 1, index + horizon);
    const day = sumSquares(returns, index - horizon + 1, index);
    const week = sumSquares(returns, index - VOL_PROTOCOL.weekSpan * horizon + 1, index);
    const month = sumSquares(returns, index - lookback + 1, index);
    if (realized === null || day === null || week === null || month === null) continue;
    if (!Number.isFinite(ewma[index])) continue;
    const logMove = Math.log(exit / entry);
    const pastMove = Math.log(entry / closes[index - horizon]);
    let features: number[] | null = null;
    if (frames) {
      const localFrames = alignedFrames.map((frame, frameIndex) => frame ?? {
        openTime: klines[frameIndex].openTime,
        closeTime: klines[frameIndex].closeTime,
        close: klines[frameIndex].close,
        volume: klines[frameIndex].volume,
        takerBuyVolume: klines[frameIndex].takerBuyVolume,
        fundingRate: null,
        fundingTime: null,
        previousFundingRate: null,
        openInterestValue: null,
        longShortRatio: null,
        takerLongShortRatio: null,
        metricsTime: null,
        bookImbalance: null,
        bookTime: null
      });
      features = featureVector(klines, localFrames, index);
    }
    decisions.push({
      openTime: klines[index].openTime,
      barIndex: index,
      priceReturn: exit / entry - 1,
      absoluteLogReturn: Math.abs(logMove),
      realizedVariance: realized,
      squaredLogReturn: logMove * logMove,
      fundingPaidByLong: fundingBetween(funding, klines[index].closeTime, klines[index + horizon].closeTime),
      rvDay: day,
      rvWeek: week / VOL_PROTOCOL.weekSpan,
      rvMonth: month / VOL_PROTOCOL.monthSpan,
      ewmaVariance: horizon * ewma[index],
      absPast: Math.abs(pastMove),
      features
    });
  }
  return { decisions, hourlyReturns: returns };
}

export function buildVolDecisions(input: {
  klines: readonly KlineBar[];
  funding?: readonly FundingPrint[];
  frames?: readonly HourFrame[];
  horizonHours: number;
  windowStartMs?: number;
  windowEndMs?: number;
}): VolDecision[] {
  return buildVolSample(input).decisions;
}

export function ridgeRow(decision: VolDecision): number[] | null {
  if (!decision.features) return null;
  if (!(decision.rvDay > 0) || !(decision.rvWeek > 0) || !(decision.rvMonth > 0)) return null;
  const row = [
    Math.log(decision.rvDay),
    Math.log(decision.rvWeek),
    Math.log(decision.rvMonth),
    decision.absPast,
    ...decision.features
  ];
  if (row.some(value => !Number.isFinite(value))) return null;
  return row;
}
