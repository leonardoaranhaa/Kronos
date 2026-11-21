import { applyStandard, fitRidge, standardizeFit } from '../futures/model';
import { VOL_PROTOCOL } from './protocol';

export interface GarchParams {
  omega: number;
  alpha: number;
  beta: number;
}

export function floorVariance(value: number, floor = VOL_PROTOCOL.varianceFloor): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(floor, value);
}

/**
 * Gaussian QMLE on a fixed grid, with variance targeting.
 * `returns[0]` is ignored so the array can be aligned to bar indexes.
 */
export function fitGarch11(returns: readonly number[]): GarchParams | null {
  const usable: number[] = [];
  for (let index = 1; index < returns.length; index++) {
    if (Number.isFinite(returns[index])) usable.push(returns[index]);
  }
  if (usable.length < VOL_PROTOCOL.minTrainRows) return null;
  let sum = 0;
  for (const value of usable) sum += value * value;
  const unconditional = sum / usable.length;
  if (!(unconditional > 0)) return null;
  let best: (GarchParams & { likelihood: number }) | null = null;
  for (const alpha of VOL_PROTOCOL.garchAlphas) {
    for (const beta of VOL_PROTOCOL.garchBetas) {
      if (alpha + beta >= VOL_PROTOCOL.garchPersistenceCap) continue;
      const omega = unconditional * (1 - alpha - beta);
      const likelihood = gaussianGarchLikelihood(usable, omega, alpha, beta, unconditional);
      if (likelihood === null) continue;
      if (!best || likelihood > best.likelihood) best = { omega, alpha, beta, likelihood };
    }
  }
  if (!best) return null;
  return { omega: best.omega, alpha: best.alpha, beta: best.beta };
}

function gaussianGarchLikelihood(
  returns: readonly number[],
  omega: number,
  alpha: number,
  beta: number,
  initial: number
): number | null {
  let state = initial;
  let likelihood = 0;
  for (const value of returns) {
    const square = value * value;
    state = omega + alpha * square + beta * state;
    if (!(state > 0) || !Number.isFinite(state)) return null;
    likelihood += -0.5 * (Math.log(state) + square / state);
  }
  return Number.isFinite(likelihood) ? likelihood : null;
}

/**
 * Sum of the next `horizon` one-step variances at each requested bar.
 * The state at bar t uses the return that closed at t and nothing after it.
 * Parameters stay frozen; this only filters.
 */
export function garchHorizonForecast(
  returns: readonly number[],
  params: GarchParams,
  barIndexes: readonly number[],
  horizon: number,
  initial: number
): number[] {
  const persistence = params.alpha + params.beta;
  const unconditional = params.omega / (1 - persistence);
  const oneStep = new Array<number>(returns.length).fill(Number.NaN);
  let state = initial;
  for (let index = 1; index < returns.length; index++) {
    if (!Number.isFinite(returns[index])) {
      oneStep[index] = state;
      continue;
    }
    state = params.omega + params.alpha * returns[index] * returns[index] + params.beta * state;
    if (!(state > 0) || !Number.isFinite(state)) state = unconditional;
    oneStep[index] = state;
  }
  return barIndexes.map(index => {
    let next = oneStep[index];
    if (!(next > 0) || !Number.isFinite(next)) return Number.NaN;
    let sum = 0;
    for (let step = 0; step < horizon; step++) {
      sum += next;
      next = unconditional + persistence * (next - unconditional);
    }
    return sum;
  });
}

export interface HarModel {
  scaleMean: number[];
  scaleStd: number[];
  beta: number[];
}

/** Ridge of next realized variance on the three HAR regressors. Train rows only. */
export function fitHar(
  day: readonly number[],
  week: readonly number[],
  month: readonly number[],
  target: readonly number[]
): HarModel | null {
  if (day.length !== week.length || day.length !== month.length || day.length !== target.length) return null;
  const raw = day.map((value, index) => [value, week[index], month[index]]);
  const scale = standardizeFit(raw);
  if (!scale) return null;
  const design = raw.map(row => applyStandard(row, scale));
  const beta = fitRidge(design, target, VOL_PROTOCOL.ridgeLambda);
  if (!beta) return null;
  return { scaleMean: scale.mean, scaleStd: scale.std, beta };
}

export function predictHar(model: HarModel, day: number, week: number, month: number): number | null {
  const design = applyStandard([day, week, month], { mean: model.scaleMean, std: model.scaleStd });
  let value = 0;
  for (let index = 0; index < design.length; index++) value += design[index] * model.beta[index];
  return floorVariance(value);
}

export interface RidgeVolModel {
  scaleMean: number[];
  scaleStd: number[];
  beta: number[];
}

/**
 * Ridge of log realized variance. The forecast is exp(xβ), floored.
 * Rows that are not finite are the caller's job to drop before fitting.
 */
export function fitRidgeVol(rows: readonly (readonly number[])[], targetVariance: readonly number[]): RidgeVolModel | null {
  if (rows.length !== targetVariance.length || rows.length < VOL_PROTOCOL.minTrainRows) return null;
  const scale = standardizeFit(rows);
  if (!scale) return null;
  const design = rows.map(row => applyStandard(row, scale));
  const target = targetVariance.map(value => Math.log(Math.max(VOL_PROTOCOL.varianceFloor, value)));
  const beta = fitRidge(design, target, VOL_PROTOCOL.ridgeLambda);
  if (!beta) return null;
  return { scaleMean: scale.mean, scaleStd: scale.std, beta };
}

export function predictRidgeVol(model: RidgeVolModel, row: readonly number[]): number | null {
  const design = applyStandard(row, { mean: model.scaleMean, std: model.scaleStd });
  let value = 0;
  for (let index = 0; index < design.length; index++) value += design[index] * model.beta[index];
  if (!Number.isFinite(value)) return null;
  return floorVariance(Math.exp(value));
}
