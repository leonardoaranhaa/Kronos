import { FUTURES_PROTOCOL } from '../futures/protocol';
import { VALIDATION_GATES } from '../validation/protocol';

/**
 * Frozen on 2026-11-21 before this study's test block was scored.
 * The window, the horizons, the models, the loss and the filter threshold
 * stay put after a result. Do not edit them to improve a verdict.
 * The same object is what the trial log stores.
 */
export const VOL_PROTOCOL = Object.freeze({
  registeredAt: '2026-11-21T22:40:00.000Z',
  id: 'vol-v1',
  symbols: Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const),
  interval: '1h' as const,
  /** Next-N-hour realized variance. Both horizons are scored. Neither is dropped after the fact. */
  horizons: Object.freeze([4, 24] as const),
  windowStart: FUTURES_PROTOCOL.windowStart,
  windowEnd: FUTURES_PROTOCOL.windowEnd,
  /** RiskMetrics lambda on hourly squared log returns. Not searched. */
  ewmaLambda: 0.94,
  /** HAR week and month, in units of the forecast horizon. Corsi's 7 and 22 become 7 and 30. */
  weekSpan: 7,
  monthSpan: 30,
  /**
   * Ridge penalty after the regressors are standardized on the training fold.
   * The intercept is not penalized. Same lambda the futures study already froze.
   * LightGBM is not a candidate: the test has to stay deterministic and free of a native library.
   */
  ridgeLambda: 1,
  varianceFloor: 1e-12,
  /** "Vol prevista alta" means strictly above this quantile of the training forecasts. Not searched. */
  filterQuantile: 0.8,
  walkForwardGroups: VALIDATION_GATES.walkForwardGroups,
  walkForwardMinTrainGroups: VALIDATION_GATES.walkForwardMinTrainGroups,
  labelHorizonSteps: 1,
  labelEmbargoSteps: 1,
  minTrainRows: 80,
  minTrainForecasts: 30,
  minTestObservations: 30,
  /** Non-overlapping decisions, so the Diebold-Mariano lag is zero and the HLN horizon is 1. */
  dmLag: 0,
  dmHorizon: 1,
  dmAlpha: 0.05,
  coverageLevels: Object.freeze([0.8, 0.95] as const),
  feeRate: FUTURES_PROTOCOL.feeRate,
  slippageRate: FUTURES_PROTOCOL.slippageRate,
  primaryModel: 'har' as const,
  baselineModel: 'naive' as const,
  models: Object.freeze(['naive', 'ewma', 'har', 'garch', 'ridge'] as const),
  sizingModels: Object.freeze(['naive', 'har'] as const),
  ruleIds: Object.freeze(['logistica', 'direcao', 'funding'] as const),
  garchAlphas: Object.freeze([0.02, 0.05, 0.08, 0.12] as const),
  garchBetas: Object.freeze([0.8, 0.9, 0.94, 0.97] as const),
  garchPersistenceCap: 0.995,
  /** Kronos-small's frozen 1h spec. The dispersion is a forecast of that path, not of 4h or 24h. */
  kronosHorizonBars: 6,
  kronosContext: 256,
  kronosStride: 12,
  kronosSampleCount: 4
});

export type VolSymbol = (typeof VOL_PROTOCOL.symbols)[number];
export type VolHorizon = (typeof VOL_PROTOCOL.horizons)[number];
export type VolModelId = (typeof VOL_PROTOCOL.models)[number];
export type VolRuleId = (typeof VOL_PROTOCOL.ruleIds)[number];

export const VOL_MODEL_NAMES: Record<VolModelId, string> = {
  naive: 'vol recente',
  ewma: 'EWMA',
  har: 'HAR-RV',
  garch: 'GARCH(1,1)',
  ridge: 'ridge com futuros'
};

export const VOL_SKILL_RULES: readonly string[] = [
  '**Aprovada** (tamanho do movimento) só quando o HAR-RV, no teste walk-forward, tem QLIKE médio menor que a vol recente do mesmo horizonte e o p-valor unilateral de Diebold-Mariano fica abaixo de 0,05, nas seis células: BTC, ETH e SOL, em 4 horas e em 24 horas. Cada célula precisa de pelo menos 30 pontos sem sobreposição.',
  '**Reprovada** quando essa medição existe e o HAR-RV não ganha em todas as seis. EWMA, GARCH e a regressão não mudam esse veredito; os números deles saem na tabela. MSE, correlação de rank e cobertura dos intervalos são publicados e não são o portão.',
  '**Inconclusiva** quando falta a série, falta o modelo, ou alguma das seis células fica com menos de 30 pontos. Sem a conta, não há número.'
];

export const VOL_FILTER_RULES: readonly string[] = [
  '**Aprovada** (filtro) só quando, nas mesmas seis células, ficar de fora com a vol prevista pelo HAR-RV acima do percentil 80 do treino reduz o drawdown máximo de comprar e segurar e ainda passa na régua já usada: excesso depois da taxa acima de zero, Sharpe deflacionado de pelo menos 0,95 e probabilidade de overfit abaixo de 0,50.',
  '**Reprovada** quando a conta existe e alguma célula não reduz o drawdown, fica atrás de comprar e segurar, ou não passa no Sharpe deflacionado ou no PBO.',
  '**Inconclusiva** quando não há série, não há funding para cobrar o custo, ou o teste não fecha 30 retornos. Ficar parado o tempo todo não é aprovação.'
];

export const VOL_KRONOS_RULES: readonly string[] = [
  'O Kronos-small não entra nas seis células. A previsão dele é a variância das amostras do caminho de 6 horas já congelado no protocolo de pesquisa, comparada com o quadrado do log-retorno nessas 6 horas.',
  '**Aprovada** nessa célula só com QLIKE melhor que a vol recente e p-valor de Diebold-Mariano abaixo de 0,05, em pelo menos 30 pontos. Sem o worker e sem os pesos o veredito fica inconclusivo. O comando é `npm run validate -- --strategy kronos-vol`.'
];

export function volFamily(symbol: string, horizonHours: number, book: 'segurar' | 'regras' = 'segurar'): string {
  const base = `vol-${symbol.toLowerCase()}-${horizonHours}h`;
  return book === 'regras' ? `${base}-regras` : base;
}

export function volStrategyId(
  symbol: string,
  horizonHours: number,
  use: 'filtro' | 'dimensionar',
  model: VolModelId,
  book: 'segurar' | VolRuleId
): string {
  return `${volFamily(symbol, horizonHours, book === 'segurar' ? 'segurar' : 'regras')}-${use}-${model}-${book}`;
}

export function volSkillFamily(): string {
  return 'vol-habilidade';
}

export function volKronosFamily(): string {
  return 'vol-kronos';
}

/** Every attempt that will be scored. Built from the protocol, not from a result. */
export function volTrialPlans(): {
  family: string;
  strategy: string;
  params: Record<string, unknown>;
}[] {
  const plans: { family: string; strategy: string; params: Record<string, unknown> }[] = [];
  const base = {
    protocol: VOL_PROTOCOL.id,
    registeredAt: VOL_PROTOCOL.registeredAt,
    windowStart: VOL_PROTOCOL.windowStart,
    windowEnd: VOL_PROTOCOL.windowEnd,
    filterQuantile: VOL_PROTOCOL.filterQuantile,
    ewmaLambda: VOL_PROTOCOL.ewmaLambda,
    ridgeLambda: VOL_PROTOCOL.ridgeLambda,
    feeRate: VOL_PROTOCOL.feeRate,
    slippageRate: VOL_PROTOCOL.slippageRate
  };
  for (const symbol of VOL_PROTOCOL.symbols) {
    for (const horizon of VOL_PROTOCOL.horizons) {
      for (const model of VOL_PROTOCOL.models) {
        plans.push({
          family: volSkillFamily(),
          strategy: `habilidade-${symbol.toLowerCase()}-${horizon}h-${model}`,
          params: { ...base, kind: 'habilidade', symbol, horizon, model }
        });
        plans.push({
          family: volFamily(symbol, horizon),
          strategy: volStrategyId(symbol, horizon, 'filtro', model, 'segurar'),
          params: { ...base, kind: 'filtro', symbol, horizon, model, book: 'segurar' }
        });
      }
      for (const model of VOL_PROTOCOL.sizingModels) {
        plans.push({
          family: volFamily(symbol, horizon),
          strategy: volStrategyId(symbol, horizon, 'dimensionar', model, 'segurar'),
          params: { ...base, kind: 'dimensionar', symbol, horizon, model, book: 'segurar' }
        });
      }
      if (horizon === 4) {
        for (const rule of VOL_PROTOCOL.ruleIds) {
          plans.push({
            family: volFamily(symbol, horizon, 'regras'),
            strategy: volStrategyId(symbol, horizon, 'filtro', 'har', rule),
            params: { ...base, kind: 'filtro', symbol, horizon, model: 'har', book: rule }
          });
          plans.push({
            family: volFamily(symbol, horizon, 'regras'),
            strategy: volStrategyId(symbol, horizon, 'dimensionar', 'har', rule),
            params: { ...base, kind: 'dimensionar', symbol, horizon, model: 'har', book: rule }
          });
        }
      }
    }
  }
  plans.push({
    family: volKronosFamily(),
    strategy: 'kronos-vol',
    params: {
      ...base,
      kind: 'kronos-dispersao',
      symbol: 'BTCUSDT',
      horizon: VOL_PROTOCOL.kronosHorizonBars,
      model: 'kronos-small',
      book: 'filtro'
    }
  });
  plans.push({
    family: volKronosFamily(),
    strategy: 'kronos-vol-naive',
    params: {
      ...base,
      kind: 'kronos-dispersao',
      symbol: 'BTCUSDT',
      horizon: VOL_PROTOCOL.kronosHorizonBars,
      model: 'naive',
      book: 'filtro'
    }
  });
  return plans;
}

export function roundTripCost(): number {
  return 2 * (VOL_PROTOCOL.feeRate + VOL_PROTOCOL.slippageRate);
}
