import { walkForwardFolds } from '../validation/splits';
import type { StrategySeries } from '../validation/evaluate';
import { fitFoldModel, predictFold } from './model';
import {
  FUTURES_PROTOCOL,
  FUTURES_RULES,
  futuresFamily,
  futuresStrategyId,
  roundTripCost,
  type FuturesRuleId
} from './protocol';
import type { FuturesDecision } from './align';

export interface ScoredDecision {
  decision: FuturesDecision;
  probabilityUp: number;
  expectedReturn: number;
}

export interface FuturesStudy {
  scored: ScoredDecision[];
  /** Decisions before the first walk-forward test block. They train the first model and are not scored. */
  trainOnly: number;
  strategies: StrategySeries[];
}

function sideFor(rule: FuturesRuleId, probabilityUp: number, expectedReturn: number, fundingRate: number): -1 | 0 | 1 {
  const cost = roundTripCost();
  if (rule === 'funding') {
    if (fundingRate > FUTURES_PROTOCOL.fundingShortAbove) return -1;
    if (fundingRate < FUTURES_PROTOCOL.fundingLongBelow) return 1;
    return 0;
  }
  if (rule === 'direcao') {
    if (probabilityUp >= FUTURES_PROTOCOL.probabilityLong) return 1;
    if (probabilityUp <= FUTURES_PROTOCOL.probabilityShort) return -1;
    return 0;
  }
  if (probabilityUp >= FUTURES_PROTOCOL.probabilityLong && expectedReturn > cost) return 1;
  if (probabilityUp <= FUTURES_PROTOCOL.probabilityShort && expectedReturn < -cost) return -1;
  return 0;
}

function holdReturn(side: -1 | 0 | 1, decision: FuturesDecision): number {
  if (side === 0) return 0;
  return side * decision.priceReturn - side * decision.fundingPaidByLong - roundTripCost();
}

/**
 * Fits inside the same purged walk-forward the report uses, then keeps only the test rows.
 * A test label is never an input of the model that scores it.
 */
export function scoreDecisions(symbol: string, decisions: readonly FuturesDecision[]): FuturesStudy {
  const empty: FuturesStudy = { scored: [], trainOnly: decisions.length, strategies: [] };
  if (decisions.length < FUTURES_PROTOCOL.walkForwardGroups) return empty;
  const folds = walkForwardFolds({
    count: decisions.length,
    groups: FUTURES_PROTOCOL.walkForwardGroups,
    minTrainGroups: FUTURES_PROTOCOL.walkForwardMinTrainGroups,
    horizon: FUTURES_PROTOCOL.labelHorizonSteps,
    embargo: FUTURES_PROTOCOL.labelEmbargoSteps
  });
  const scoredByIndex = new Map<number, ScoredDecision>();
  for (const fold of folds) {
    const trainable = fold.train.filter(index => decisions[index].priceReturn !== 0);
    const positives = trainable.filter(index => decisions[index].priceReturn > 0).length;
    if (trainable.length < FUTURES_PROTOCOL.minTrainRows) continue;
    if (positives < FUTURES_PROTOCOL.minClassRows || trainable.length - positives < FUTURES_PROTOCOL.minClassRows) continue;
    const model = fitFoldModel(
      trainable.map(index => decisions[index].features),
      trainable.map(index => decisions[index].priceReturn > 0 ? 1 : 0),
      trainable.map(index => decisions[index].priceReturn),
      FUTURES_PROTOCOL.logisticLambda,
      FUTURES_PROTOCOL.ridgeLambda,
      FUTURES_PROTOCOL.logisticIterations
    );
    if (!model) continue;
    for (const index of fold.test) {
      const forecast = predictFold(model, decisions[index].features);
      if (!Number.isFinite(forecast.probabilityUp) || !Number.isFinite(forecast.expectedReturn)) continue;
      scoredByIndex.set(index, { decision: decisions[index], ...forecast });
    }
  }
  const order = [...scoredByIndex.keys()].sort((a, b) => a - b);
  const scored = order.map(index => scoredByIndex.get(index) as ScoredDecision);
  const trainOnly = order.length ? order[0] : decisions.length;
  if (scored.length === 0) return { scored, trainOnly, strategies: [] };
  const benchmark = scored.map((row, index) => {
    let value = row.decision.priceReturn - row.decision.fundingPaidByLong;
    if (index === 0) value -= FUTURES_PROTOCOL.feeRate + FUTURES_PROTOCOL.slippageRate;
    if (index === scored.length - 1) value -= FUTURES_PROTOCOL.feeRate + FUTURES_PROTOCOL.slippageRate;
    return value;
  });
  const periodMs = FUTURES_PROTOCOL.horizonHours * 3_600_000;
  const family = futuresFamily(symbol);
  const strategies = FUTURES_RULES.map(rule => {
    const returns = scored.map(row => sideFor(
      rule.id,
      row.probabilityUp,
      row.expectedReturn,
      row.decision.features[3]
    )).map((side, index) => holdReturn(side, scored[index].decision));
    const probability = rule.id !== 'funding';
    return {
      id: futuresStrategyId(symbol, rule.id),
      family,
      name: `Futuros ${symbol}: ${rule.name}`,
      returns,
      benchmarkReturns: benchmark,
      decisions: scored.map((row, index) => {
        const side = sideFor(rule.id, row.probabilityUp, row.expectedReturn, row.decision.features[3]);
        const predicted = rule.id === 'funding'
          ? side
          : row.expectedReturn;
        return {
          index,
          predicted,
          probabilityUp: probability ? row.probabilityUp : null,
          actual: row.decision.priceReturn,
          wentUp: row.decision.priceReturn > 0
        };
      }),
      horizon: 1,
      stride: 1,
      periodMs,
      hasDirection: true,
      hasProbability: probability,
      note: [
        rule.summary,
        `Horizonte de ${FUTURES_PROTOCOL.horizonHours} horas, sem sobreposição, em ${symbol} perp 1h.`,
        'Cada decisão usa só o que já tinha fechado. O modelo de cada bloco de teste não vê o rótulo desse bloco.',
        `Custo de ida e volta: ${(roundTripCost() * 100).toFixed(2)}% (taxa taker de 5 bps e slippage de 1 bp por lado).`,
        'Comprar e segurar paga o funding do perp e uma ida e volta no período inteiro, não a cada bloco.',
        `Regra gravada em ${FUTURES_PROTOCOL.registeredAt}, antes deste teste.`
      ].join(' ')
    } satisfies StrategySeries;
  });
  return { scored, trainOnly, strategies };
}
