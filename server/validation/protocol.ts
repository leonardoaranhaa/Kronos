/**
 * Gates fixed before the validation run. They are not moved after seeing a result.
 * The Portuguese text in VERDICT_RULES is the rule the report prints.
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

export type VerdictLabel =
  | 'aprovada'
  | 'inconclusiva'
  | 'reprovada'
  | 'reprovada (provável sorte/overfit)';

/** Exact rule, printed in reports/validation-latest.md. */
export const VERDICT_RULES: readonly string[] = [
  '**Aprovada** só quando o teste walk-forward, depois das taxas, passa de comprar e segurar, o Sharpe deflacionado fica em pelo menos 0,95, a probabilidade de backtest overfitting fica abaixo de 0,50, há pelo menos 30 observações de retorno e, se a estratégia emite direção, pelo menos 30 decisões independentes com p-valor abaixo de 0,05. Se emite P(alta), o Brier tem de ser melhor que a taxa-base.',
  '**Reprovada** quando essa medição existe e a estratégia não passa. Perder para comprar e segurar no teste, com Sharpe calculado, reprova mesmo se o acerto ficar um pouco acima de 50% e mesmo se o DSR for quase zero. O mesmo vale se o treino também perdeu.',
  '**Reprovada (provável sorte/overfit)** é o caso em que o ganho do treino não se repete no teste, o Sharpe do teste é positivo mas o deflacionado fica abaixo de 0,95, ou o PBO fica em 0,50 ou mais.',
  '**Inconclusiva** só por falta de dados ou de amostra: sem modelo ou sem previsões, menos de 30 observações de retorno, ou uma série parada (nenhum trade, Sharpe inexistente). Um resultado econômico medido não fica inconclusivo.'
];

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
  label: VerdictLabel;
  reason: string;
}

export function decideVerdict(input: VerdictInput): VerdictResult {
  const enoughReturns = (input.returnObservations ?? 0) >= VALIDATION_GATES.minReturnObservations;
  if (enoughReturns && input.excessReturn !== null && input.perPeriodSharpe === null) {
    return {
      verdict: 'inconclusiva',
      label: 'inconclusiva',
      reason: 'A série de retornos não varia, então o Sharpe não existe. Ficar parado não é aprovação, mesmo quando comprar e segurar caiu no mesmo período.'
    };
  }
  if (!enoughReturns || input.excessReturn === null) {
    return {
      verdict: 'inconclusiva',
      label: 'inconclusiva',
      reason: 'Amostra curta demais, ou sem a série de retornos, para separar vantagem de acaso.'
    };
  }
  const directionReady = !input.hasDirection
    || ((input.independentDecisions ?? 0) >= VALIDATION_GATES.minIndependentDecisions
      && input.directionPValue !== null
      && input.directionPValue < VALIDATION_GATES.directionalAlpha);
  const probabilityReady = !input.hasProbability
    || (input.brier !== null && input.climatologyBrier !== null && input.brier < input.climatologyBrier);
  const sharpeSupported = input.deflatedSharpe !== null && input.deflatedSharpe >= VALIDATION_GATES.deflatedSharpeMin;
  const overfitClear = input.probabilityOfOverfit !== null
    && input.probabilityOfOverfit < VALIDATION_GATES.maxProbabilityOfOverfit;
  const beatHold = input.excessReturn > 0;
  const gainDidNotRepeat = input.trainExcessReturn !== null && input.trainExcessReturn > 0 && input.excessReturn <= 0;
  const luckySharpe = input.perPeriodSharpe !== null && input.perPeriodSharpe > 0 && !sharpeSupported;
  const overfitMenu = input.probabilityOfOverfit !== null && input.probabilityOfOverfit >= VALIDATION_GATES.maxProbabilityOfOverfit;

  if (beatHold && sharpeSupported && overfitClear && directionReady && probabilityReady) {
    return {
      verdict: 'aprovada',
      label: 'aprovada',
      reason: 'No teste walk-forward, depois das taxas, passou de comprar e segurar, o Sharpe deflacionado ficou em pelo menos 0,95 e a probabilidade de overfit ficou abaixo de 0,50.'
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
  if (!beatHold) {
    const bothSides = input.trainExcessReturn !== null && input.trainExcessReturn <= 0
      ? 'no treino e no teste'
      : 'no teste';
    return {
      verdict: 'reprovada',
      label: 'reprovada',
      reason: `Depois das taxas, o walk-forward ficou atrás de comprar e segurar ${bothSides}. O Sharpe desta série não sustenta vantagem. Acerto perto ou acima de 50% não muda esse veredito.`
    };
  }
  if (input.hasDirection && (input.independentDecisions ?? 0) < VALIDATION_GATES.minIndependentDecisions) {
    return {
      verdict: 'inconclusiva',
      label: 'inconclusiva',
      reason: 'O retorno foi medido, mas há menos de 30 decisões independentes de direção. Falta amostra para fechar o veredito.'
    };
  }
  return {
    verdict: 'reprovada',
    label: 'reprovada',
    reason: 'A medição existe e a estratégia não passou na direção, na calibração ou no Sharpe deflacionado.'
  };
}
