import { standardNormalCdf, standardNormalQuantile } from '../validation/normal';
import { mean } from '../validation/moments';

/** Patton's QLIKE. Lower is better. The forecast has to be a positive variance. */
export function qlike(forecast: number, realized: number): number | null {
  if (!(forecast > 0) || !Number.isFinite(forecast) || !Number.isFinite(realized) || realized < 0) return null;
  return Math.log(forecast) + realized / forecast;
}

export function mse(forecast: number, realized: number): number | null {
  if (!Number.isFinite(forecast) || !Number.isFinite(realized)) return null;
  return (forecast - realized) ** 2;
}

export function averageLoss(
  forecast: readonly number[],
  realized: readonly number[],
  loss: (forecast: number, realized: number) => number | null
): { mean: number | null; losses: number[]; count: number } {
  const losses: number[] = [];
  for (let index = 0; index < forecast.length; index++) {
    const value = loss(forecast[index], realized[index]);
    if (value === null || !Number.isFinite(value)) continue;
    losses.push(value);
  }
  if (losses.length === 0) return { mean: null, losses, count: 0 };
  return { mean: mean(losses), losses, count: losses.length };
}

export interface DieboldMariano {
  /** Mean of model loss minus baseline loss. Negative means the model loses less. */
  meanGap: number | null;
  statistic: number | null;
  /** One-sided p-value for "the model has the smaller loss". */
  pValue: number | null;
  observations: number;
}

/**
 * Diebold-Mariano with a Newey-West variance of `lag` and the Harvey,
 * Leybourne and Newbold small-sample correction for horizon `hlnHorizon`.
 * The loss differential is model minus baseline.
 */
export function dieboldMariano(
  modelLoss: readonly number[],
  baselineLoss: readonly number[],
  lag: number,
  hlnHorizon: number
): DieboldMariano {
  const empty: DieboldMariano = { meanGap: null, statistic: null, pValue: null, observations: 0 };
  if (modelLoss.length !== baselineLoss.length || !Number.isInteger(lag) || lag < 0) return empty;
  const gap: number[] = [];
  for (let index = 0; index < modelLoss.length; index++) {
    if (!Number.isFinite(modelLoss[index]) || !Number.isFinite(baselineLoss[index])) continue;
    gap.push(modelLoss[index] - baselineLoss[index]);
  }
  const n = gap.length;
  if (n < 3) return { ...empty, observations: n };
  const center = mean(gap);
  const autocovariance = (k: number): number => {
    let sum = 0;
    for (let index = k; index < n; index++) sum += (gap[index] - center) * (gap[index - k] - center);
    return sum / n;
  };
  let variance = autocovariance(0);
  for (let k = 1; k <= lag; k++) {
    const weight = 1 - k / (lag + 1);
    variance += 2 * weight * autocovariance(k);
  }
  if (!(variance > 0)) return { meanGap: center, statistic: null, pValue: null, observations: n };
  const raw = center / Math.sqrt(variance / n);
  const h = hlnHorizon;
  const correction = (n + 1 - 2 * h + (h * (h - 1)) / n) / n;
  if (!(correction > 0)) return { meanGap: center, statistic: null, pValue: null, observations: n };
  const statistic = raw * Math.sqrt(correction);
  return {
    meanGap: center,
    statistic,
    pValue: standardNormalCdf(statistic),
    observations: n
  };
}

/** Two-sided Gaussian interval. 80% uses z_0.90 and 95% uses z_0.975. */
export function coverageRate(
  absoluteLogReturn: readonly number[],
  varianceForecast: readonly number[],
  level: number
): number | null {
  if (absoluteLogReturn.length !== varianceForecast.length || absoluteLogReturn.length === 0) return null;
  if (!(level > 0) || !(level < 1)) return null;
  const z = standardNormalQuantile(0.5 + level / 2);
  let covered = 0;
  let counted = 0;
  for (let index = 0; index < absoluteLogReturn.length; index++) {
    const forecast = varianceForecast[index];
    const move = absoluteLogReturn[index];
    if (!(forecast > 0) || !Number.isFinite(move) || move < 0) continue;
    counted += 1;
    if (move <= z * Math.sqrt(forecast)) covered += 1;
  }
  if (counted === 0) return null;
  return covered / counted;
}

/** Same nearest-rank quantile the futures study uses. */
export function empiricalQuantile(values: readonly number[], probability: number): number | null {
  if (values.length === 0 || !(probability >= 0) || !(probability <= 1)) return null;
  const sorted = values.filter(value => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * probability)));
  return sorted[index];
}

export function median(values: readonly number[]): number | null {
  const sorted = values.filter(value => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function maxDrawdownPct(returns: readonly number[]): number | null {
  if (returns.length === 0) return null;
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of returns) {
    if (!Number.isFinite(value)) return null;
    equity *= 1 + value;
    if (!(equity > 0)) return null;
    if (equity > peak) peak = equity;
    worst = Math.max(worst, (peak - equity) / peak);
  }
  return worst * 100;
}
