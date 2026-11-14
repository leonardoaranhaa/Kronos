import { CanonicalCandle } from '../../shared/types';
import { ARANHA_GATES } from './gates';
import { mean, median, quantile, roundTo, zscore, clamp } from './math';
import type { AnalogMatch, AnalogSummary } from './types';

export interface AnalogSearchConfig {
  window: number;
  horizon: number;
  k: number;
  separation: number;
  candidateStride: number;
}

export const DEFAULT_ANALOG_SEARCH: AnalogSearchConfig = {
  window: ARANHA_GATES.window,
  horizon: ARANHA_GATES.horizonBars,
  k: ARANHA_GATES.neighbors,
  separation: ARANHA_GATES.separation,
  candidateStride: 1
};

export interface AnalogIndex {
  candles: readonly CanonicalCandle[];
  window: number;
  dim: number;
  /** Row-major vectors. Invalid rows are zeros and marked in `valid`. */
  block: Float64Array;
  valid: Uint8Array;
}

interface IndicatorSeries {
  ema9: (number | null)[];
  ema20: (number | null)[];
  rsi14: (number | null)[];
  atr14: (number | null)[];
}

function emaSeries(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let i = 0; i < period; i++) ema += values[i];
  ema /= period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function rsiSeries(values: readonly number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const at = (gain: number, loss: number) => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = at(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + (change >= 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    out[i] = at(avgGain, avgLoss);
  }
  return out;
}

function atrSeries(candles: readonly CanonicalCandle[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(candles.length).fill(null);
  let rolling = 0;
  const window: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    window.push(tr);
    rolling += tr;
    if (window.length > period) rolling -= window.shift() ?? 0;
    if (window.length === period) out[i] = rolling / period;
  }
  return out;
}

function indicatorsOf(candles: readonly CanonicalCandle[]): IndicatorSeries {
  const closes = candles.map(candle => candle.close);
  return {
    ema9: emaSeries(closes, 9),
    ema20: emaSeries(closes, 20),
    rsi14: rsiSeries(closes, 14),
    atr14: atrSeries(candles, 14)
  };
}

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One row per candle end. Features use only that window and causal indicators
 * (EMA, RSI, ATR) computed from the prefix. Future candles do not move a row.
 */
export function buildAnalogIndex(candles: readonly CanonicalCandle[], window: number): AnalogIndex {
  if (!Number.isInteger(window) || window < 8) throw new Error('analog window must be an integer >= 8');
  const indicators = indicatorsOf(candles);
  const dim = (window - 1) + window + window + 4;
  const block = new Float64Array(candles.length * dim);
  const valid = new Uint8Array(candles.length);

  for (let end = window - 1; end < candles.length; end++) {
    const start = end - window + 1;
    let ok = true;
    const returns: number[] = [];
    const ranges: number[] = [];
    const volumes: number[] = [];
    for (let i = start; i <= end; i++) {
      const candle = candles[i];
      if (!(candle.close > 0) || !(candle.high >= candle.low)) {
        ok = false;
        break;
      }
      ranges.push((candle.high - candle.low) / candle.close);
      volumes.push(candle.volume);
      if (i > start) {
        const previous = candles[i - 1].close;
        if (!(previous > 0)) {
          ok = false;
          break;
        }
        returns.push(Math.log(candle.close / previous));
      }
    }
    if (!ok || returns.length !== window - 1) continue;

    const zReturns = zscore(returns);
    const zRanges = zscore(ranges);
    const zVolumes = zscore(volumes.map(value => value / (medianOf(volumes) || 1)));
    let square = 0;
    for (const value of returns) square += value * value;
    const realized = Math.sqrt(square / returns.length);
    const close = candles[end].close;
    const ema9 = indicators.ema9[end];
    const ema20 = indicators.ema20[end];
    const rsi = indicators.rsi14[end];
    const atr = indicators.atr14[end];
    const spread = ema9 !== null && ema20 !== null ? clamp(((ema9 - ema20) / close) * 100, -3, 3) : 0;
    const rsiFeature = rsi === null ? 0 : (rsi / 100 - 0.5) * 2;
    const atrFeature = atr === null ? 0 : clamp((atr / close) * 100, 0, 3);
    const row = block.subarray(end * dim, (end + 1) * dim);
    let cursor = 0;
    for (const value of zReturns) row[cursor++] = value;
    for (const value of zRanges) row[cursor++] = value * 0.5;
    for (const value of zVolumes) row[cursor++] = value * 0.5;
    row[cursor++] = realized * 200;
    row[cursor++] = rsiFeature;
    row[cursor++] = spread;
    row[cursor++] = atrFeature;
    valid[end] = 1;
  }

  return { candles, window, dim, block, valid };
}

function distanceTo(index: AnalogIndex, end: number, query: Float64Array): number {
  const base = end * index.dim;
  let sum = 0;
  for (let dim = 0; dim < index.dim; dim++) {
    const diff = index.block[base + dim] - query[dim];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function pathSpark(candles: readonly CanonicalCandle[], end: number, window: number, horizon: number): { spark: number[]; forward: number[] } {
  const start = end - window + 1;
  const values: number[] = [];
  for (let i = start; i <= end + horizon; i++) values.push(candles[i].close);
  let low = values[0];
  let high = values[0];
  for (const value of values) {
    if (value < low) low = value;
    if (value > high) high = value;
  }
  const span = high - low || 1;
  const norm = values.map(value => roundTo((value - low) / span, 4));
  return {
    spark: norm.slice(0, window),
    forward: norm.slice(window - 1)
  };
}

/**
 * K nearest historical windows.
 * An analog may end at j only when its bars do not overlap the query and its
 * forward path is already known at t (j + horizon <= t). Candles after t are ignored.
 */
export function searchAnalogs(index: AnalogIndex, t: number, config: AnalogSearchConfig = DEFAULT_ANALOG_SEARCH): AnalogMatch[] {
  const { window, horizon, k, separation, candidateStride } = config;
  if (window !== index.window) throw new Error('analog index window does not match the search window');
  if (t < 0 || t >= index.candles.length || !index.valid[t]) return [];
  const maxJ = t - Math.max(window, horizon);
  const minJ = window - 1;
  if (maxJ < minJ) return [];

  const query = index.block.slice(t * index.dim, (t + 1) * index.dim);
  const ranked: { end: number; distance: number }[] = [];
  const stride = Math.max(1, candidateStride);
  for (let end = minJ; end <= maxJ; end += stride) {
    if (!index.valid[end]) continue;
    ranked.push({ end, distance: distanceTo(index, end, query) });
  }
  ranked.sort((a, b) => a.distance - b.distance || a.end - b.end);

  const chosen: { end: number; distance: number }[] = [];
  for (const candidate of ranked) {
    if (chosen.some(item => Math.abs(item.end - candidate.end) < separation)) continue;
    chosen.push(candidate);
    if (chosen.length === k) break;
  }

  return chosen.map(candidate => {
    const origin = index.candles[candidate.end].close;
    const future = index.candles[candidate.end + horizon].close;
    const forwardReturnBps = roundTo((future / origin - 1) * 10_000, 1);
    const direction = forwardReturnBps > 0 ? 'up' : forwardReturnBps < 0 ? 'down' : 'flat';
    const drawn = pathSpark(index.candles, candidate.end, window, horizon);
    return {
      endIndex: candidate.end,
      endOpenTime: index.candles[candidate.end].openTime,
      distance: roundTo(candidate.distance, 4),
      forwardReturnBps,
      direction,
      spark: drawn.spark,
      forward: drawn.forward
    };
  });
}

export function summarizeAnalogs(matches: readonly AnalogMatch[]): AnalogSummary {
  const returns = matches.map(match => match.forwardReturnBps);
  const ups = matches.filter(match => match.direction === 'up').length;
  const downs = matches.filter(match => match.direction === 'down').length;
  const flats = matches.length - ups - downs;
  const distances = matches.map(match => match.distance);
  return {
    count: matches.length,
    hitRateUp: matches.length ? ups / matches.length : null,
    hitRateDown: matches.length ? downs / matches.length : null,
    flatCount: flats,
    meanForwardReturnBps: mean(returns) === null ? null : roundTo(mean(returns) as number, 1),
    medianForwardReturnBps: median(returns) === null ? null : roundTo(median(returns) as number, 1),
    p25Bps: quantile(returns, 0.25) === null ? null : roundTo(quantile(returns, 0.25) as number, 1),
    p75Bps: quantile(returns, 0.75) === null ? null : roundTo(quantile(returns, 0.75) as number, 1),
    medianDistance: median(distances) === null ? null : roundTo(median(distances) as number, 4)
  };
}

export { emaSeries, rsiSeries, atrSeries };
