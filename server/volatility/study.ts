import { VALIDATION_GATES } from '../validation/protocol';
import { walkForwardFolds } from '../validation/splits';
import type { VolDecision } from './build';
import { ridgeRow } from './build';
import { empiricalQuantile, median } from './losses';
import {
  fitGarch11,
  fitHar,
  fitRidgeVol,
  floorVariance,
  garchHorizonForecast,
  predictHar,
  predictRidgeVol
} from './models';
import { VOL_PROTOCOL, type VolModelId } from './protocol';

export interface ModelCall {
  forecast: number | null;
  /** True when the forecast is strictly above the training quantile. */
  high: boolean;
  /** min(1, median training forecast / forecast). Zero when the forecast is missing. */
  weight: number;
}

export interface VolPoint {
  decision: VolDecision;
  models: Record<VolModelId, ModelCall>;
}

function emptyCall(): ModelCall {
  return { forecast: null, high: false, weight: 0 };
}

function finiteOf(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value) && value > 0);
}

function callsFrom(forecasts: readonly (number | null)[], trainForecasts: readonly (number | null)[]): ModelCall[] {
  const finite = finiteOf(trainForecasts);
  const ready = finite.length >= VOL_PROTOCOL.minTrainForecasts;
  const cutoff = ready ? empiricalQuantile(finite, VOL_PROTOCOL.filterQuantile) : null;
  const scale = ready ? median(finite) : null;
  return forecasts.map(forecast => {
    const usable = forecast !== null && Number.isFinite(forecast) && forecast > 0 ? forecast : null;
    if (usable === null || cutoff === null || scale === null || !(scale > 0)) return emptyCall();
    return {
      forecast: usable,
      high: usable > cutoff,
      weight: Math.min(1, scale / usable)
    };
  });
}

function trainVariance(returns: readonly number[]): number {
  let sum = 0;
  let counted = 0;
  for (let index = 1; index < returns.length; index++) {
    if (!Number.isFinite(returns[index])) continue;
    sum += returns[index] * returns[index];
    counted += 1;
  }
  return counted > 0 ? sum / counted : VOL_PROTOCOL.varianceFloor;
}

/**
 * Forecasts on the walk-forward test points only.
 * A test label is not an input of the fit that scores it.
 * Naive and EWMA have no coefficients; their threshold still comes from past forecasts only.
 */
export function scoreVolPoints(
  decisions: readonly VolDecision[],
  hourlyReturns: readonly number[],
  horizonHours: number
): VolPoint[] {
  if (decisions.length < VOL_PROTOCOL.walkForwardGroups) return [];
  const folds = walkForwardFolds({
    count: decisions.length,
    groups: VOL_PROTOCOL.walkForwardGroups,
    minTrainGroups: VOL_PROTOCOL.walkForwardMinTrainGroups,
    horizon: VOL_PROTOCOL.labelHorizonSteps,
    embargo: VOL_PROTOCOL.labelEmbargoSteps
  });
  const byIndex = new Map<number, VolPoint>();
  for (const fold of folds) {
    const train = fold.train.map(index => decisions[index]).filter(row => row.barIndex >= 0);
    const testIndexes = fold.test.filter(index => decisions[index].barIndex >= 0);
    if (train.length < VOL_PROTOCOL.minTrainRows || testIndexes.length === 0) continue;
    const lastTrainBar = Math.max(...train.map(row => row.barIndex));
    const har = fitHar(
      train.map(row => row.rvDay),
      train.map(row => row.rvWeek),
      train.map(row => row.rvMonth),
      train.map(row => row.realizedVariance)
    );
    const ridgePairs = train
      .map(row => ({ row: ridgeRow(row), target: row.realizedVariance }))
      .filter((item): item is { row: number[]; target: number } => item.row !== null);
    const ridge = fitRidgeVol(ridgePairs.map(item => item.row), ridgePairs.map(item => item.target));
    const garch = fitGarch11(hourlyReturns.slice(0, lastTrainBar + 1));
    const garchInitial = trainVariance(hourlyReturns.slice(0, lastTrainBar + 1));
    const garchAt = (rows: readonly VolDecision[]): (number | null)[] => {
      if (!garch) return rows.map(() => null);
      const raw = garchHorizonForecast(hourlyReturns, garch, rows.map(row => row.barIndex), horizonHours, garchInitial);
      return raw.map(value => floorVariance(value));
    };
    const trainRows = train;
    const testRows = testIndexes.map(index => decisions[index]);
    const packs: Record<VolModelId, ModelCall[]> = {
      naive: callsFrom(testRows.map(row => floorVariance(row.rvDay)), trainRows.map(row => floorVariance(row.rvDay))),
      ewma: callsFrom(testRows.map(row => floorVariance(row.ewmaVariance)), trainRows.map(row => floorVariance(row.ewmaVariance))),
      har: callsFrom(
        testRows.map(row => har ? predictHar(har, row.rvDay, row.rvWeek, row.rvMonth) : null),
        trainRows.map(row => har ? predictHar(har, row.rvDay, row.rvWeek, row.rvMonth) : null)
      ),
      garch: callsFrom(garchAt(testRows), garchAt(trainRows)),
      ridge: callsFrom(
        testRows.map(row => {
          const features = ridgeRow(row);
          return ridge && features ? predictRidgeVol(ridge, features) : null;
        }),
        trainRows.map(row => {
          const features = ridgeRow(row);
          return ridge && features ? predictRidgeVol(ridge, features) : null;
        })
      )
    };
    testIndexes.forEach((decisionIndex, slot) => {
      byIndex.set(decisionIndex, {
        decision: decisions[decisionIndex],
        models: {
          naive: packs.naive[slot],
          ewma: packs.ewma[slot],
          har: packs.har[slot],
          garch: packs.garch[slot],
          ridge: packs.ridge[slot]
        }
      });
    });
  }
  return [...byIndex.keys()].sort((a, b) => a - b).map(index => byIndex.get(index) as VolPoint);
}

/** Same outer walk-forward the economic verdict uses. Drawdown is read on this slice. */
export function outerTestIndexes(count: number): number[] {
  if (count < VALIDATION_GATES.walkForwardGroups) return [];
  return walkForwardFolds({
    count,
    groups: VALIDATION_GATES.walkForwardGroups,
    minTrainGroups: VALIDATION_GATES.walkForwardMinTrainGroups,
    horizon: 1,
    embargo: 1
  }).flatMap(fold => fold.test);
}

/** Long-only book. A weight change pays the fee on the traded fraction. The last bar is flattened. */
export function exposureReturns(
  decisions: readonly VolDecision[],
  weights: readonly number[],
  feeRate = VOL_PROTOCOL.feeRate,
  slippageRate = VOL_PROTOCOL.slippageRate
): number[] {
  if (decisions.length !== weights.length) throw new Error('pesos e decisões precisam do mesmo relógio');
  const sideCost = feeRate + slippageRate;
  let previous = 0;
  return decisions.map((decision, index) => {
    const weight = weights[index];
    if (!Number.isFinite(weight) || weight < 0) throw new Error('peso da posição inválido');
    let cost = Math.abs(weight - previous) * sideCost;
    if (index === decisions.length - 1) cost += Math.abs(weight) * sideCost;
    previous = weight;
    const result = weight * decision.priceReturn - weight * decision.fundingPaidByLong - cost;
    return Object.is(result, -0) ? 0 : result;
  });
}

/**
 * The futures rule already pays a full round trip whenever the side is not flat.
 * The vol scale multiplies that whole return. A high-vol filter uses scale 0.
 */
export function scaledRuleReturns(
  decisions: readonly VolDecision[],
  sides: readonly (-1 | 0 | 1)[],
  scales: readonly number[],
  roundTrip = 2 * (VOL_PROTOCOL.feeRate + VOL_PROTOCOL.slippageRate)
): number[] {
  if (decisions.length !== sides.length || decisions.length !== scales.length) {
    throw new Error('lados, escalas e decisões precisam do mesmo relógio');
  }
  return decisions.map((decision, index) => {
    const side = sides[index];
    const scale = scales[index];
    if (side === 0 || scale === 0) return 0;
    const held = side * decision.priceReturn - side * decision.fundingPaidByLong - roundTrip;
    return scale * held;
  });
}
