/**
 * Frozen on 2026-11-14 before this study's test block was scored.
 * Thresholds, the window, the cost and the feature list stay put after a result.
 * The trial log stores the same object. Do not edit it to improve a verdict.
 */
export const FUTURES_PROTOCOL = Object.freeze({
  registeredAt: '2026-11-14T14:30:00.000Z',
  id: 'futuros-v1',
  interval: '1h' as const,
  horizonHours: 4,
  lookbackHours: 24,
  /** Decisions on candle opens at 00:00, 04:00, 08:00, 12:00, 16:00 and 20:00 UTC. */
  anchorHourUtc: 0,
  symbols: Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const),
  windowStart: '2024-11-01T00:00:00.000Z',
  windowEnd: '2026-11-01T00:00:00.000Z',
  /** Last three days inside the frozen window. Used only to compare aggTrades with the kline taker volume. */
  aggTradeCheckDays: Object.freeze(['2026-10-29', '2026-10-30', '2026-10-31'] as const),
  /** Binance USD-M taker fee for VIP 0, public schedule. Per side. */
  feeRate: 0.0005,
  /** One basis point of slippage per side. Not searched. */
  slippageRate: 0.0001,
  probabilityLong: 0.55,
  probabilityShort: 0.45,
  logisticLambda: 1,
  ridgeLambda: 1,
  logisticIterations: 25,
  /** Short the perp when the last funding print is above 3 bps per 8h. */
  fundingShortAbove: 0.0003,
  /** Long the perp when the last funding print is below -1 bp per 8h. */
  fundingLongBelow: -0.0001,
  maxFundingAgeMs: 16 * 60 * 60 * 1000,
  maxMetricsAgeMs: 30 * 60 * 1000,
  maxBookAgeMs: 5 * 60 * 1000,
  minTrainRows: 80,
  minClassRows: 8,
  walkForwardGroups: 5,
  walkForwardMinTrainGroups: 2,
  labelHorizonSteps: 1,
  labelEmbargoSteps: 1,
  features: Object.freeze([
    'retorno_1h',
    'retorno_4h',
    'retorno_24h',
    'funding',
    'funding_variacao',
    'oi_variacao_4h',
    'oi_variacao_24h',
    'long_short',
    'long_short_variacao_24h',
    'desequilibrio_taker_1h',
    'cvd_4h',
    'desequilibrio_livro_1pct',
    'taker_ratio_metrics'
  ] as const)
});

export type FuturesSymbol = (typeof FUTURES_PROTOCOL.symbols)[number];

export const FUTURES_RULES = Object.freeze([
  Object.freeze({
    id: 'logistica',
    name: 'logística',
    summary: 'Compra só com P(alta) ≥ 0,55 e retorno previsto acima do custo de ida e volta. Vende no espelho. O restante fica zerado.'
  }),
  Object.freeze({
    id: 'direcao',
    name: 'só direção',
    summary: 'O mesmo modelo. Compra com P(alta) ≥ 0,55 e vende com P(alta) ≤ 0,45, sem exigir o tamanho previsto.'
  }),
  Object.freeze({
    id: 'funding',
    name: 'funding',
    summary: 'Sem ajuste. Vende se o funding passa de 3 bps e compra se fica abaixo de −1 bp. É a regra de referência, não um modelo.'
  })
] as const);

export type FuturesRuleId = (typeof FUTURES_RULES)[number]['id'];

export function futuresFamily(symbol: string): string {
  return `futuros-${symbol.toLowerCase()}`;
}

export function futuresStrategyId(symbol: string, rule: FuturesRuleId): string {
  return `${futuresFamily(symbol)}-${rule}`;
}

export function roundTripCost(protocol: { feeRate: number; slippageRate: number } = FUTURES_PROTOCOL): number {
  return 2 * (protocol.feeRate + protocol.slippageRate);
}

/** Parameters stored in the trial log. The shape is part of the registration. */
export function futuresTrialParams(): Record<string, unknown> {
  return {
    registeredAt: FUTURES_PROTOCOL.registeredAt,
    id: FUTURES_PROTOCOL.id,
    interval: FUTURES_PROTOCOL.interval,
    horizonHours: FUTURES_PROTOCOL.horizonHours,
    windowStart: FUTURES_PROTOCOL.windowStart,
    windowEnd: FUTURES_PROTOCOL.windowEnd,
    aggTradeCheckDays: [...FUTURES_PROTOCOL.aggTradeCheckDays],
    feeRate: FUTURES_PROTOCOL.feeRate,
    slippageRate: FUTURES_PROTOCOL.slippageRate,
    probabilityLong: FUTURES_PROTOCOL.probabilityLong,
    probabilityShort: FUTURES_PROTOCOL.probabilityShort,
    logisticLambda: FUTURES_PROTOCOL.logisticLambda,
    ridgeLambda: FUTURES_PROTOCOL.ridgeLambda,
    fundingShortAbove: FUTURES_PROTOCOL.fundingShortAbove,
    fundingLongBelow: FUTURES_PROTOCOL.fundingLongBelow,
    features: [...FUTURES_PROTOCOL.features],
    rules: FUTURES_RULES.map(rule => rule.id)
  };
}
