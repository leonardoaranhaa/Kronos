export interface ReturnMoments {
  mean: number;
  /** Sample standard deviation, divisor n - 1. */
  sampleStd: number;
  /** Standardized third moment, divisor n. Zero for a symmetric sample. */
  skew: number;
  /** Standardized fourth moment, divisor n. A normal sample is near 3, not 0. */
  kurtosis: number;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('mean of an empty sample');
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Population-style central moments. Sharpe itself uses the sample standard deviation. */
export function returnMoments(values: readonly number[]): ReturnMoments | null {
  const n = values.length;
  if (n < 4) return null;
  const center = mean(values);
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const value of values) {
    const delta = value - center;
    const square = delta * delta;
    m2 += square;
    m3 += square * delta;
    m4 += square * square;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  if (!(m2 > 0)) return null;
  return {
    mean: center,
    sampleStd: Math.sqrt((m2 * n) / (n - 1)),
    skew: m3 / (m2 ** 1.5),
    kurtosis: m4 / (m2 * m2)
  };
}

export function compound(returns: readonly number[]): number {
  let equity = 1;
  for (const value of returns) equity *= 1 + value;
  return equity - 1;
}
