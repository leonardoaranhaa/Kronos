import { brierScore, climatologyBrier, reliabilityCurve, ReliabilityCurveBin } from '../calibration';
import { spearmanTest } from './correlation';
import { directionTest } from './dependence';
import { compound, returnMoments } from './moments';
import { probabilityOfBacktestOverfitting } from './pbo';
import { VALIDATION_GATES, decideVerdict, VerdictResult } from './protocol';
import { annualizeSharpe, deflatedSharpeRatio, sharpeRatio } from './sharpe';
import { combinatorialPurgedFolds, walkForwardFolds } from './splits';
import { trialCount, trialSharpePool, TrialEntry } from './trials';

export interface DecisionObservation {
  /** Position of this decision in the aligned return array. */
  index: number;
  predicted: number | null;
  probabilityUp: number | null;
  actual: number;
  wentUp: boolean | null;
}

export interface InformationOverride {
  coefficient: number | null;
  pValue: number | null;
  observations: number;
}

export interface StrategySeries {
  id: string;
  family: string;
  name: string;
  /** One simple return per completed hold. Columns of one family share this clock. */
  returns: number[];
  benchmarkReturns: number[];
  decisions: DecisionObservation[];
  /** Label length in holds. Use 1 when the next hold starts only after this label ends. */
  horizon: number;
  stride: number;
  periodMs: number;
  hasDirection: boolean;
  hasProbability: boolean;
  note: string;
  informationOverride?: InformationOverride;
}

export interface StrategyMetrics {
  directionalAccuracy: number | null;
  directionalHits: number | null;
  directionalCompared: number | null;
  independentCompared: number | null;
  directionPValue: number | null;
  directionMethod: string | null;
  informationCoefficient: number | null;
  informationCoefficientPValue: number | null;
  informationCoefficientObservations: number | null;
  strategyReturnPct: number | null;
  buyAndHoldReturnPct: number | null;
  excessReturnPct: number | null;
  trainExcessReturnPct: number | null;
  sharpe: number | null;
  sharpePerPeriod: number | null;
  deflatedSharpeRatio: number | null;
  deflatedSharpeBenchmark: number | null;
  deflatedSharpeTrials: number | null;
  deflatedSharpeDispersion: string | null;
  probabilityOfBacktestOverfitting: number | null;
  pboSplits: number | null;
  brier: number | null;
  climatologyBrier: number | null;
  reliability: ReliabilityCurveBin[];
  walkForwardFolds: number | null;
  cpcvFolds: number | null;
  cpcvMedianSharpe: number | null;
  observations: number | null;
  independentDecisions: number | null;
}

export interface StrategyEvaluation {
  id: string;
  family: string;
  name: string;
  note: string;
  verdict: VerdictResult;
  metrics: StrategyMetrics;
}

function sliceByIndex(values: readonly number[], indexes: readonly number[]): number[] {
  return indexes.filter(index => index >= 0 && index < values.length).map(index => values[index]);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function nonOverlappingPairs(decisions: readonly DecisionObservation[], horizon: number): { predicted: number; actual: number }[] {
  const pairs: { predicted: number; actual: number }[] = [];
  let next = -Infinity;
  const ordered = decisions.filter(decision => decision.predicted !== null).slice().sort((a, b) => a.index - b.index);
  for (const decision of ordered) {
    if (decision.predicted === null || decision.index < next) continue;
    pairs.push({ predicted: decision.predicted, actual: decision.actual });
    next = decision.index + Math.max(1, horizon);
  }
  return pairs;
}

export function evaluateFamily(
  strategies: readonly StrategySeries[],
  trials: readonly TrialEntry[]
): StrategyEvaluation[] {
  if (strategies.length === 0) return [];
  const width = strategies[0].returns.length;
  if (strategies.some(strategy => strategy.returns.length !== width || strategy.benchmarkReturns.length !== width)) {
    throw new Error('strategies in one family must share the same return clock');
  }
  const family = strategies[0].family;
  const transposed: number[][] = [];
  for (let time = 0; time < width; time++) transposed.push(strategies.map(strategy => strategy.returns[time]));
  const pbo = probabilityOfBacktestOverfitting(transposed);
  const usable = width >= VALIDATION_GATES.walkForwardGroups;
  const folds = usable
    ? walkForwardFolds({
      count: width,
      groups: VALIDATION_GATES.walkForwardGroups,
      minTrainGroups: VALIDATION_GATES.walkForwardMinTrainGroups,
      horizon: strategies[0].horizon,
      embargo: strategies[0].horizon
    })
    : [];
  const testIndexes = folds.flatMap(fold => fold.test);
  const trainIndexes = folds.length ? folds[0].train : [];
  const firstTest = testIndexes.length ? Math.min(...testIndexes) : width;
  const ownSharpes = strategies
    .map(strategy => sharpeRatio(sliceByIndex(strategy.returns, testIndexes)))
    .filter((value): value is number => value !== null);
  const loggedTrials = trialCount(trials, family);
  const trialsUsed = Math.max(loggedTrials, ownSharpes.length, 1);
  const recorded = trialSharpePool(trials, family, ownSharpes);

  const cpcv = usable
    ? combinatorialPurgedFolds({
      count: width,
      groups: Math.min(VALIDATION_GATES.cpcvGroups, width),
      testGroups: VALIDATION_GATES.cpcvTestGroups,
      horizon: strategies[0].horizon,
      embargo: strategies[0].horizon
    })
    : [];

  return strategies.map(strategy => {
    const testReturns = sliceByIndex(strategy.returns, testIndexes);
    const testBenchmark = sliceByIndex(strategy.benchmarkReturns, testIndexes);
    const trainReturns = sliceByIndex(strategy.returns, trainIndexes);
    const trainBenchmark = sliceByIndex(strategy.benchmarkReturns, trainIndexes);
    const oosDecisions = strategy.decisions.filter(decision => decision.index >= firstTest);
    const direction = directionTest(
      oosDecisions.map(decision => ({
        index: decision.index,
        hit: decision.predicted === null || decision.predicted === 0 || decision.actual === 0
          ? null
          : Math.sign(decision.predicted) === Math.sign(decision.actual)
      })),
      { horizon: strategy.horizon, stride: strategy.stride }
    );
    const pairs = nonOverlappingPairs(oosDecisions, strategy.horizon);
    const information = strategy.informationOverride ?? spearmanTest(
      pairs.map(pair => pair.predicted),
      pairs.map(pair => pair.actual)
    );
    const probabilityRows = oosDecisions
      .filter(decision => decision.probabilityUp !== null && decision.wentUp !== null)
      .map(decision => ({ pUp: decision.probabilityUp as number, wentUp: decision.wentUp as boolean }));
    const moments = returnMoments(testReturns);
    const perPeriod = sharpeRatio(testReturns);
    const deflated = moments
      ? deflatedSharpeRatio({
        returns: testReturns,
        trials: trialsUsed,
        recordedSharpes: recorded,
        skew: moments.skew,
        kurtosis: moments.kurtosis
      })
      : null;
    const cpcvSharpes = cpcv
      .map(fold => sharpeRatio(sliceByIndex(strategy.returns, fold.test)))
      .filter((value): value is number => value !== null);
    const strategyReturn = testReturns.length ? compound(testReturns) : null;
    const buyAndHoldReturn = testBenchmark.length ? compound(testBenchmark) : null;
    const trainStrategy = trainReturns.length ? compound(trainReturns) : null;
    const trainHold = trainBenchmark.length ? compound(trainBenchmark) : null;
    const excess = strategyReturn === null || buyAndHoldReturn === null ? null : strategyReturn - buyAndHoldReturn;
    const trainExcess = trainStrategy === null || trainHold === null ? null : trainStrategy - trainHold;
    const metrics: StrategyMetrics = {
      directionalAccuracy: direction.accuracy,
      directionalHits: direction.hits,
      directionalCompared: direction.compared,
      independentCompared: direction.independentCompared,
      directionPValue: direction.pValue,
      directionMethod: direction.method,
      informationCoefficient: information.coefficient,
      informationCoefficientPValue: information.pValue,
      informationCoefficientObservations: information.observations,
      strategyReturnPct: strategyReturn === null ? null : strategyReturn * 100,
      buyAndHoldReturnPct: buyAndHoldReturn === null ? null : buyAndHoldReturn * 100,
      excessReturnPct: excess === null ? null : excess * 100,
      trainExcessReturnPct: trainExcess === null ? null : trainExcess * 100,
      sharpe: perPeriod === null ? null : annualizeSharpe(perPeriod, strategy.periodMs),
      sharpePerPeriod: perPeriod,
      deflatedSharpeRatio: deflated?.value ?? null,
      deflatedSharpeBenchmark: deflated?.benchmark ?? null,
      deflatedSharpeTrials: trialsUsed,
      deflatedSharpeDispersion: deflated?.dispersionSource ?? null,
      probabilityOfBacktestOverfitting: pbo.probability,
      pboSplits: pbo.splits || null,
      brier: strategy.hasProbability ? brierScore(probabilityRows) : null,
      climatologyBrier: strategy.hasProbability ? climatologyBrier(probabilityRows) : null,
      reliability: strategy.hasProbability ? reliabilityCurve(probabilityRows).filter(bin => bin.count > 0) : [],
      walkForwardFolds: folds.length || null,
      cpcvFolds: cpcv.length || null,
      cpcvMedianSharpe: median(cpcvSharpes),
      observations: testReturns.length || null,
      independentDecisions: direction.independentCompared
    };
    return {
      id: strategy.id,
      family: strategy.family,
      name: strategy.name,
      note: strategy.note,
      verdict: decideVerdict({
        independentDecisions: metrics.independentDecisions,
        returnObservations: metrics.observations,
        excessReturn: excess,
        trainExcessReturn: trainExcess,
        perPeriodSharpe: perPeriod,
        deflatedSharpe: metrics.deflatedSharpeRatio,
        probabilityOfOverfit: metrics.probabilityOfBacktestOverfitting,
        directionPValue: metrics.directionPValue,
        hasDirection: strategy.hasDirection,
        brier: metrics.brier,
        climatologyBrier: metrics.climatologyBrier,
        hasProbability: strategy.hasProbability
      }),
      metrics
    };
  });
}
