/** Point-in-time indicator series. Index i uses only values at or before i. Null means not enough history. */

export function sma(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (period < 1) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (period < 1 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(closes: readonly number[], period = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (period < 1 || closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const value = (up: number, down: number) => (down === 0 ? 100 : 100 - 100 / (1 + up / down));
  out[period] = value(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    out[i] = value(avgGain, avgLoss);
  }
  return out;
}

export function bollinger(closes: readonly number[], period = 20, mult = 2): {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
} {
  const middle = sma(closes, period);
  const upper: (number | null)[] = closes.map(() => null);
  const lower: (number | null)[] = closes.map(() => null);
  for (let i = 0; i < closes.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const delta = closes[j] - mean;
      acc += delta * delta;
    }
    const dev = Math.sqrt(acc / period) * mult;
    upper[i] = mean + dev;
    lower[i] = mean - dev;
  }
  return { middle, upper, lower };
}

export interface Ohlcv {
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function vwap(bars: readonly Ohlcv[]): (number | null)[] {
  const out: (number | null)[] = bars.map(() => null);
  let pv = 0;
  let volume = 0;
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.volume > 0) {
      pv += ((bar.high + bar.low + bar.close) / 3) * bar.volume;
      volume += bar.volume;
    }
    out[i] = volume > 0 ? pv / volume : null;
  }
  return out;
}

export function atr(bars: readonly { high: number; low: number; close: number }[], period = 14): (number | null)[] {
  const out: (number | null)[] = bars.map(() => null);
  if (period < 1 || bars.length <= period) return out;
  const tr: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    const prev = bars[i - 1].close;
    tr.push(Math.max(bar.high - bar.low, Math.abs(bar.high - prev), Math.abs(bar.low - prev)));
  }
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

function emaNullable(values: readonly (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  const nums: { index: number; value: number }[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value !== null) nums.push({ index: i, value });
  }
  if (period < 1 || nums.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += nums[i].value;
  let prev = sum / period;
  out[nums[period - 1].index] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < nums.length; i++) {
    prev = nums[i].value * k + prev * (1 - k);
    out[nums[i].index] = prev;
  }
  return out;
}

export function macd(closes: readonly number[], fast = 12, slow = 26, signalPeriod = 9): {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
} {
  const fastLine = ema(closes, fast);
  const slowLine = ema(closes, slow);
  const line = closes.map((_, index) => {
    const a = fastLine[index];
    const b = slowLine[index];
    return a === null || b === null ? null : a - b;
  });
  const signal = emaNullable(line, signalPeriod);
  const histogram = line.map((value, index) => {
    const sig = signal[index];
    return value === null || sig === null ? null : value - sig;
  });
  return { macd: line, signal, histogram };
}

export function parsePeriods(text: string): number[] {
  const found = text.split(/[^0-9]+/).map(part => Number(part)).filter(period => period >= 2 && period <= 400);
  return [...new Set(found)].slice(0, 4);
}
