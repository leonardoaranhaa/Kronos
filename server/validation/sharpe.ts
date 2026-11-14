import { mean } from './moments';
import { standardNormalCdf, standardNormalQuantile } from './normal';

/** Euler–Mascheroni constant used by the expected-maximum formula. */
export const EULER_MASCHERONI = 0.5772156649015329;

export function sampleStd(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const center = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - center) ** 2;
  const variance = sum / (values.length - 1);
  if (!(variance > 0)) return null;
  return Math.sqrt(variance);
}

/** Per-period Sharpe ratio. Not annualized. Null when the sample is flat or short. */
export function sharpeRatio(returns: readonly number[]): number | null {
  const std = sampleStd(returns);
  if (std === null) return null;
  return mean(returns) / std;
}

export function annualizeSharpe(perPeriod: number, periodMs: number): number | null {
  if (!Number.isFinite(perPeriod) || !(periodMs > 0)) return null;
  const periodsPerYear = (365.25 * 24 * 60 * 60 * 1000) / periodMs;
  return perPeriod * Math.sqrt(periodsPerYear);
}

/**
 * Probabilistic Sharpe Ratio from Bailey and López de Prado.
 * `benchmark` is the Sharpe the observed one is tested against.
 * `kurtosis` is the fourth standardized moment (a normal sample is 3).
 */
export function probabilisticSharpeRatio(
  observed: number,
  benchmark: number,
  observations: number,
  skew: number,
  kurtosis: number
): number | null {
  if (!(observations > 1) || !Number.isFinite(observed) || !Number.isFinite(benchmark)) return null;
  const varianceFactor = 1 - skew * observed + ((kurtosis - 1) / 4) * observed * observed;
  if (!(varianceFactor > 0)) return null;
  const z = ((observed - benchmark) * Math.sqrt(observations - 1)) / Math.sqrt(varianceFactor);
  return standardNormalCdf(z);
}

/**
 * Expected maximum Sharpe under the null, given N independent trials and the
 * cross-sectional standard deviation of their Sharpe ratios.
 * N = 1 has no selection, so the benchmark is zero.
 */
export function expectedMaximumSharpe(trials: number, sharpeStd: number): number {
  if (!Number.isInteger(trials) || trials < 1) throw new Error('trial count must be a positive integer');
  if (!(sharpeStd >= 0) || !Number.isFinite(sharpeStd)) throw new Error('Sharpe dispersion must be non-negative');
  if (trials === 1 || sharpeStd === 0) return 0;
  const zPrimary = standardNormalQuantile(1 - 1 / trials);
  const zSecondary = standardNormalQuantile(1 - 1 / (trials * Math.E));
  return sharpeStd * ((1 - EULER_MASCHERONI) * zPrimary + EULER_MASCHERONI * zSecondary);
}

/**
 * Standard error of one Sharpe estimate. Bailey and López de Prado use this
 * as the trial dispersion when the individual trial Sharpes were not stored.
 */
export function sharpeStandardError(
  observed: number,
  observations: number,
  skew: number,
  kurtosis: number
): number | null {
  if (!(observations > 1)) return null;
  const varianceFactor = 1 - skew * observed + ((kurtosis - 1) / 4) * observed * observed;
  if (!(varianceFactor > 0)) return null;
  return Math.sqrt(varianceFactor / (observations - 1));
}

export interface DeflatedSharpe {
  value: number | null;
  benchmark: number | null;
  trials: number;
  dispersion: number | null;
  dispersionSource: 'desvio-entre-tentativas' | 'erro-padrao' | 'indisponivel';
}

export function deflatedSharpeRatio(options: {
  returns: readonly number[];
  trials: number;
  /** Sharpe ratios already recorded for the same family. May be incomplete. */
  recordedSharpes?: readonly number[];
  skew: number;
  kurtosis: number;
}): DeflatedSharpe {
  const observed = sharpeRatio(options.returns);
  const empty: DeflatedSharpe = {
    value: null,
    benchmark: null,
    trials: options.trials,
    dispersion: null,
    dispersionSource: 'indisponivel'
  };
  if (observed === null) return empty;
  const finite = (options.recordedSharpes ?? []).filter(value => Number.isFinite(value));
  let dispersion: number | null = null;
  let dispersionSource: DeflatedSharpe['dispersionSource'] = 'indisponivel';
  // Two or more stored trial Sharpes are the cross-section. N can be larger
  // when older attempts were counted without a Sharpe; the standard error is
  // only the fallback when fewer than two Sharpes were saved.
  if (finite.length >= 2) {
    dispersion = sampleStd(finite) ?? 0;
    dispersionSource = 'desvio-entre-tentativas';
  } else {
    dispersion = sharpeStandardError(observed, options.returns.length, options.skew, options.kurtosis);
    dispersionSource = dispersion === null ? 'indisponivel' : 'erro-padrao';
  }
  if (dispersion === null) return empty;
  const benchmark = expectedMaximumSharpe(options.trials, dispersion);
  return {
    value: probabilisticSharpeRatio(observed, benchmark, options.returns.length, options.skew, options.kurtosis),
    benchmark,
    trials: options.trials,
    dispersion,
    dispersionSource
  };
}

/**
 * Recompute a published DSR after the trial dispersion changes, keeping the
 * skew and kurtosis that were baked into the previous probability.
 */
export function restateDeflatedSharpe(options: {
  observed: number;
  observations: number;
  previousBenchmark: number;
  previousProbability: number;
  trials: number;
  recordedSharpes: readonly number[];
}): Pick<DeflatedSharpe, 'value' | 'benchmark' | 'trials' | 'dispersion' | 'dispersionSource'> | null {
  const finite = options.recordedSharpes.filter(value => Number.isFinite(value));
  if (finite.length < 2 || !(options.observations > 1)) return null;
  if (!(options.previousProbability > 0 && options.previousProbability < 1)) return null;
  const previousZ = standardNormalQuantile(options.previousProbability);
  if (!Number.isFinite(previousZ) || previousZ === 0) return null;
  const varianceFactor = ((options.observed - options.previousBenchmark) ** 2 * (options.observations - 1)) / (previousZ ** 2);
  if (!(varianceFactor > 0)) return null;
  const dispersion = sampleStd(finite) ?? 0;
  const benchmark = expectedMaximumSharpe(options.trials, dispersion);
  const z = ((options.observed - benchmark) * Math.sqrt(options.observations - 1)) / Math.sqrt(varianceFactor);
  return {
    value: standardNormalCdf(z),
    benchmark,
    trials: options.trials,
    dispersion,
    dispersionSource: 'desvio-entre-tentativas'
  };
}
