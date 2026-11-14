/** Lanczos approximation of log(gamma(z)) for z > 0. */
export function logGamma(z: number): number {
  const p = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843696540789806e-6, 1.5056327351493116e-7
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
  const t = z + p.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * One-sided binomial survival P(X >= hits) for X ~ Binomial(n, 0.5).
 * This is the pre-registered test against a coin-flip direction.
 */
export function binomialSurvivalHalf(hits: number, n: number): number {
  if (!Number.isInteger(n) || n < 0 || !Number.isInteger(hits)) {
    throw new Error('binomial test expects integer hits and n');
  }
  if (n === 0 || hits <= 0) return 1;
  if (hits > n) return 0;
  const logs: number[] = [];
  let logTerm = logChoose(n, hits) - n * Math.LN2;
  logs.push(logTerm);
  for (let k = hits; k < n; k++) {
    logTerm += Math.log(n - k) - Math.log(k + 1);
    logs.push(logTerm);
  }
  const maxLog = Math.max(...logs);
  const sum = logs.reduce((total, value) => total + Math.exp(value - maxLog), 0);
  return Math.min(1, Math.exp(maxLog) * sum);
}

export function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function maxDrawdownPct(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let worst = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.max(worst, (peak - value) / peak);
  }
  return worst * 100;
}

/** Bar-return Sharpe, annualized with 365.25 days. Null when the path is too short or flat. */
export function annualizedSharpe(equity: number[], intervalMs: number): number | null {
  if (equity.length < 3 || !(intervalMs > 0)) return null;
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (!(equity[i - 1] > 0)) return null;
    returns.push(equity[i] / equity[i - 1] - 1);
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  const periodsPerYear = (365.25 * 24 * 60 * 60 * 1000) / intervalMs;
  return (mean / std) * Math.sqrt(periodsPerYear);
}
