/**
 * Gates fixed before the validation run. They are not moved after seeing a result.
 *
 * A strategy is "aprovada" only when the walk-forward test, the deflated Sharpe
 * and the probability of backtest overfitting all clear these bars.
 * "reprovada (provável sorte/overfit)" is a positive-looking result that fails
 * one of those bars, or an in-sample gain that the walk-forward test does not repeat.
 * Anything without enough independent decisions stays "inconclusiva".
 */
export const VALIDATION_GATES = Object.freeze({
  minIndependentDecisions: 30,
  minReturnObservations: 30,
  directionalAlpha: 0.05,
  deflatedSharpeMin: 0.95,
  maxProbabilityOfOverfit: 0.5,
  walkForwardGroups: 5,
  walkForwardMinTrainGroups: 2,
  cpcvGroups: 6,
  cpcvTestGroups: 2
});

export type Verdict = 'aprovada' | 'inconclusiva' | 'reprovada';

export interface VerdictInput {
  independentDecisions: number | null;
  returnObservations: number | null;
  excessReturn: number | null;
  trainExcessReturn: number | null;
  perPeriodSharpe: number | null;
  deflatedSharpe: number | null;
  probabilityOfOverfit: number | null;
  directionPValue: number | null;
  hasDirection: boolean;
  brier: number | null;
  climatologyBrier: number | null;
  hasProbability: boolean;
}

export interface VerdictResult {
  verdict: Verdict;
  label: 'aprovada' | 'inconclusiva' | 'reprovada (provável sorte/overfit)';
  reason: string;
}

export function decideVerdict(input: VerdictInput): VerdictResult {
  const enoughDecisions = (input.independentDecisions ?? 0) >= VALIDATION_GATES.minIndependentDecisions;
  const enoughReturns = (input.returnObservations ?? 0) >= VALIDATION_GATES.minReturnObservations;
  if (enoughReturns && input.excessReturn !== null && input.perPeriodSharpe === null) {
    return {
      verdict: 'inconclusiva',
      label: 'inconclusiva',
      reason: 'A série de retornos não varia, então o Sharpe não existe. Ficar parado não é aprovação, mesmo quando comprar e segurar caiu no mesmo período.'
    };
  }
  if (!enoughDecisions || !enoughReturns || input.excessReturn === null) {
    return {
      verdict: 'inconclusiva',
      label: 'inconclusiva',
      reason: 'Amostra curta demais, ou sem a série de retornos, para separar vantagem de acaso.'
    };
  }
  const directionFails = input.hasDirection
    && (input.directionPValue === null || input.directionPValue >= VALIDATION_GATES.directionalAlpha);
  const probabilityFails = input.hasProbability
    && (input.brier === null || input.climatologyBrier === null || !(input.brier < input.climatologyBrier));
  const sharpeSupported = input.deflatedSharpe !== null && input.deflatedSharpe >= VALIDATION_GATES.deflatedSharpeMin;
  const overfitClear = input.probabilityOfOverfit !== null
    && input.probabilityOfOverfit < VALIDATION_GATES.maxProbabilityOfOverfit;
  const beatHold = input.excessReturn > 0;
  const gainDidNotRepeat = input.trainExcessReturn !== null && input.trainExcessReturn > 0 && input.excessReturn <= 0;
  const luckySharpe = input.perPeriodSharpe !== null && input.perPeriodSharpe > 0 && !sharpeSupported;
  const overfitMenu = input.probabilityOfOverfit !== null && input.probabilityOfOverfit >= VALIDATION_GATES.maxProbabilityOfOverfit;

  if (beatHold && sharpeSupported && overfitClear && !directionFails && !probabilityFails) {
    return {
      verdict: 'aprovada',
      label: 'aprovada',
      reason: 'No teste walk-forward, depois das taxas, passou do comprar-e-segurar, o Sharpe deflacionado ficou em pelo menos 0,95 e a probabilidade de overfit ficou abaixo de 0,50.'
    };
  }
  if (gainDidNotRepeat || luckySharpe || overfitMenu) {
    return {
      verdict: 'reprovada',
      label: 'reprovada (provável sorte/overfit)',
      reason: gainDidNotRepeat
        ? 'O ganho contra comprar e segurar apareceu no treino do walk-forward e não se repetiu no teste.'
        : overfitMenu
          ? 'A probabilidade de backtest overfitting ficou em 0,50 ou mais: a configuração que ganha num pedaço tende a perder no pedaço complementar.'
          : 'O Sharpe do teste é positivo, mas o Sharpe deflacionado pelo número de tentativas não chega a 0,95.'
    };
  }
  if (input.excessReturn <= 0 && (input.trainExcessReturn === null || input.trainExcessReturn <= 0)) {
    return {
      verdict: 'inconclusiva',
      label: 'inconclusiva',
      reason: 'Depois das taxas, o walk-forward ficou atrás de comprar e segurar no treino e no teste. Não há aprovação e não há um ganho de amostra que o teste tenha derrubado.'
    };
  }
  return {
    verdict: 'inconclusiva',
    label: 'inconclusiva',
    reason: 'O teste não fecha uma vantagem. A direção, a calibração ou o tamanho da amostra não passam dos limites, e também não há um ganho de treino desmentido no teste.'
  };
}
