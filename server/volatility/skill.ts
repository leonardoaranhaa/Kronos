import { spearmanTest } from '../validation/correlation';
import type { VolPoint } from './study';
import { coverageRate, dieboldMariano, mse, qlike } from './losses';
import { VOL_PROTOCOL, type VolModelId } from './protocol';

export interface VolSkillCell {
  symbol: string;
  horizonHours: number;
  model: VolModelId;
  observations: number;
  qlike: number | null;
  baselineQlike: number | null;
  /** Baseline QLIKE minus model QLIKE. Positive means the model loses less. */
  qlikeGap: number | null;
  mse: number | null;
  baselineMse: number | null;
  mseGap: number | null;
  dmStatistic: number | null;
  dmPValue: number | null;
  rankVariance: number | null;
  rankVarianceP: number | null;
  rankAbsolute: number | null;
  rankAbsoluteP: number | null;
  coverage80: number | null;
  coverage95: number | null;
  enough: boolean;
  beatsBaseline: boolean;
}

function meanOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/**
 * Skill against the naive forecast on the points where both forecasts exist.
 * The naive row reports its own QLIKE and does not get a win against itself.
 */
export function skillCell(symbol: string, horizonHours: number, model: VolModelId, points: readonly VolPoint[]): VolSkillCell {
  const paired = points.filter(point => point.models[model].forecast !== null && point.models.naive.forecast !== null);
  const forecast = paired.map(point => point.models[model].forecast as number);
  const baseline = paired.map(point => point.models.naive.forecast as number);
  const realized = paired.map(point => point.decision.realizedVariance);
  const absolute = paired.map(point => point.decision.absoluteLogReturn);
  const modelQ = forecast.map((value, index) => qlike(value, realized[index])).filter((value): value is number => value !== null);
  const baseQ = baseline.map((value, index) => qlike(value, realized[index])).filter((value): value is number => value !== null);
  const modelM = forecast.map((value, index) => mse(value, realized[index])).filter((value): value is number => value !== null);
  const baseM = baseline.map((value, index) => mse(value, realized[index])).filter((value): value is number => value !== null);
  const qlikeMean = meanOf(modelQ);
  const baselineQlike = meanOf(baseQ);
  const mseMean = meanOf(modelM);
  const baselineMse = meanOf(baseM);
  const dm = model === 'naive'
    ? { statistic: null, pValue: null }
    : dieboldMariano(
      forecast.map((value, index) => qlike(value, realized[index]) ?? Number.NaN),
      baseline.map((value, index) => qlike(value, realized[index]) ?? Number.NaN),
      VOL_PROTOCOL.dmLag,
      VOL_PROTOCOL.dmHorizon
    );
  const rankVariance = spearmanTest(forecast, realized);
  const rankAbsolute = spearmanTest(forecast, absolute);
  const enough = paired.length >= VOL_PROTOCOL.minTestObservations;
  const beatsBaseline = model !== 'naive'
    && enough
    && qlikeMean !== null
    && baselineQlike !== null
    && qlikeMean < baselineQlike
    && dm.pValue !== null
    && dm.pValue < VOL_PROTOCOL.dmAlpha;
  return {
    symbol,
    horizonHours,
    model,
    observations: paired.length,
    qlike: qlikeMean,
    baselineQlike,
    qlikeGap: qlikeMean === null || baselineQlike === null ? null : baselineQlike - qlikeMean,
    mse: mseMean,
    baselineMse,
    mseGap: mseMean === null || baselineMse === null ? null : baselineMse - mseMean,
    dmStatistic: dm.statistic,
    dmPValue: dm.pValue,
    rankVariance: rankVariance.coefficient,
    rankVarianceP: rankVariance.pValue,
    rankAbsolute: rankAbsolute.coefficient,
    rankAbsoluteP: rankAbsolute.pValue,
    coverage80: coverageRate(absolute, forecast, 0.8),
    coverage95: coverageRate(absolute, forecast, 0.95),
    enough,
    beatsBaseline
  };
}
