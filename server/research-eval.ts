import { Candle, CanonicalCandle } from '../shared/types';
import { computeIndicators } from './indicators';
import {
  CURRENT_RULE,
  CURRENT_RULE_LONG_ONLY,
  PRIMARY_ALPHA,
  PRIMARY_SERIES,
  RESEARCH_COSTS,
  ResearchParams,
  STARTING_EQUITY,
  embargoSplit,
  eachTunedParams,
  MIN_IN_SAMPLE_TRADES,
  MIN_OOS_TRADES
} from './research-protocol';
import { annualizedSharpe, maxDrawdownPct, sampleStd } from './research-stats';
import { directionTest } from './validation/dependence';
import { Account, CostConfig, PositionTarget, createAccount, markToMarket, rebalance } from './trading-math';

export interface CachedForecast {
  openTime: number;
  meanCloses: number[];
  sampleEnds: number[];
  datasetSha256?: string;
}

export interface StudyRecord {
  index: number;
  fillIndex: number;
  openTime: number;
  outcomeOpenTime: number;
  close: number;
  fillPrice: number;
  meanEnd: number;
  sampleEnds: number[];
  predictedReturnBps: number;
  dispersionBps: number;
  actualEnd: number;
  actualReturnBps: number;
  directionHit: boolean | null;
  atr: number | null;
  ema9: number | null;
  ema20: number | null;
  rsi14: number | null;
  split: 'in_sample' | 'out_of_sample';
}

export interface TradeMetrics {
  label: string;
  returnPct: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  closedTrades: number;
  wins: number;
  winRatePct: number | null;
  feesPaid: number;
  endingEquity: number;
}

export interface DirectionStats {
  hits: number;
  compared: number;
  accuracy: number | null;
  pValue: number | null;
  independentHits?: number;
  independentCompared?: number;
  pValueMethod?: string;
  blockBootstrapPValue?: number | null;
}

export interface TunedChoice {
  tried: number;
  eligible: number;
  params: ResearchParams | null;
  inSample: TradeMetrics | null;
}

export function decisionIndexes(candleCount: number, context: number, horizon: number, stride: number): number[] {
  const indexes: number[] = [];
  for (let t = context - 1; t + horizon < candleCount; t += stride) indexes.push(t);
  return indexes;
}

function toCandle(candle: CanonicalCandle): Candle {
  return {
    timestamp: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  };
}

export function buildStudyRecords(
  candles: readonly CanonicalCandle[],
  forecasts: ReadonlyMap<number, CachedForecast>,
  spec: { context: number; horizon: number; stride: number },
  oosStart: number
): StudyRecord[] {
  const records: StudyRecord[] = [];
  for (const index of decisionIndexes(candles.length, spec.context, spec.horizon, spec.stride)) {
    const forecast = forecasts.get(candles[index].openTime);
    if (!forecast || forecast.meanCloses.length < spec.horizon || forecast.sampleEnds.length === 0) continue;
    const outcome = candles[index + spec.horizon];
    const fill = candles[index + 1];
    const split = embargoSplit(candles[index].openTime, outcome.openTime, oosStart);
    if (split === 'embargo') continue;
    const prefix = candles.slice(0, index + 1).map(toCandle);
    const indicators = computeIndicators(prefix);
    const close = candles[index].close;
    const meanEnd = forecast.meanCloses[spec.horizon - 1];
    const predictedReturnBps = ((meanEnd - close) / close) * 10_000;
    const sampleReturns = forecast.sampleEnds.map(value => ((value - close) / close) * 10_000);
    const actualEnd = outcome.close;
    const actualReturnBps = ((actualEnd - close) / close) * 10_000;
    const predictedSign = Math.sign(meanEnd - close);
    const actualSign = Math.sign(actualEnd - close);
    records.push({
      index,
      fillIndex: index + 1,
      openTime: candles[index].openTime,
      outcomeOpenTime: outcome.openTime,
      close,
      fillPrice: fill.open,
      meanEnd,
      sampleEnds: forecast.sampleEnds.slice(),
      predictedReturnBps,
      dispersionBps: sampleStd(sampleReturns),
      actualEnd,
      actualReturnBps,
      directionHit: predictedSign === 0 || actualSign === 0 ? null : predictedSign === actualSign,
      atr: indicators.atr14,
      ema9: indicators.ema9,
      ema20: indicators.ema20,
      rsi14: indicators.rsi14,
      split
    });
  }
  return records;
}

export function directionStats(
  records: readonly { index: number; directionHit: boolean | null }[],
  overlap: { horizon: number; stride: number } = { horizon: 1, stride: 1 }
): DirectionStats {
  const test = directionTest(
    records.map(record => ({ index: record.index, hit: record.directionHit })),
    overlap
  );
  return {
    hits: test.hits,
    compared: test.compared,
    accuracy: test.accuracy,
    pValue: test.pValue,
    independentHits: test.independentHits,
    independentCompared: test.independentCompared,
    pValueMethod: test.method,
    blockBootstrapPValue: test.blockBootstrapPValue
  };
}

export type ResearchSignalInput = Pick<StudyRecord, 'close' | 'predictedReturnBps' | 'dispersionBps' | 'atr' | 'ema9' | 'ema20'> & {
  rsi14?: number | null;
};

function blockedByRsi(record: ResearchSignalInput, params: ResearchParams, side: 'BUY' | 'SELL'): boolean {
  if (record.rsi14 == null) return false;
  if (side === 'BUY' && params.rsiBuyMax != null && record.rsi14 >= params.rsiBuyMax) return true;
  if (side === 'SELL' && params.rsiSellMin != null && record.rsi14 <= params.rsiSellMin) return true;
  return false;
}

/** Research signal. SELL means "down"; a long-only simulator turns that into an exit. */
export function researchAction(record: ResearchSignalInput, params: ResearchParams): 'BUY' | 'SELL' | 'HOLD' {
  const magnitude = Math.abs(record.predictedReturnBps);
  if (record.dispersionBps > params.maxDispersionBps) return 'HOLD';
  if (magnitude < params.minMoveBps) return 'HOLD';
  if (params.atrMultiple > 0) {
    if (record.atr === null || !(record.close > 0)) return 'HOLD';
    const atrBps = (record.atr / record.close) * 10_000;
    if (magnitude < params.atrMultiple * atrBps) return 'HOLD';
  }
  const up = record.predictedReturnBps > 0;
  const down = record.predictedReturnBps < 0;
  if (params.trendFilter) {
    if (record.ema9 === null || record.ema20 === null) return 'HOLD';
    if (up && record.ema9 > record.ema20) return blockedByRsi(record, params, 'BUY') ? 'HOLD' : 'BUY';
    if (down && record.ema9 < record.ema20) return blockedByRsi(record, params, 'SELL') ? 'HOLD' : 'SELL';
    return 'HOLD';
  }
  if (up) return blockedByRsi(record, params, 'BUY') ? 'HOLD' : 'BUY';
  if (down) return blockedByRsi(record, params, 'SELL') ? 'HOLD' : 'SELL';
  return 'HOLD';
}

function metricsOf(
  label: string,
  account: Account,
  equity: number[],
  intervalMs: number
): TradeMetrics {
  const endingEquity = equity.length ? equity[equity.length - 1] : account.cash;
  return {
    label,
    returnPct: ((endingEquity - STARTING_EQUITY) / STARTING_EQUITY) * 100,
    maxDrawdownPct: maxDrawdownPct(equity),
    sharpe: annualizedSharpe(equity, intervalMs),
    closedTrades: account.closedTrades,
    wins: account.wins,
    winRatePct: account.closedTrades > 0 ? (account.wins / account.closedTrades) * 100 : null,
    feesPaid: account.feesPaid,
    endingEquity
  };
}

function targetFor(action: 'BUY' | 'SELL' | 'HOLD', mode: ResearchParams['mode'], qty: number): PositionTarget | null {
  if (action === 'HOLD') return null;
  if (action === 'BUY') return qty > 0 ? null : 'long';
  if (mode === 'long_only') return qty > 0 ? 'flat' : null;
  return qty < 0 ? null : 'short';
}

export function simulateDecisions(
  candles: readonly CanonicalCandle[],
  scheduled: ReadonlyMap<number, 'BUY' | 'SELL' | 'HOLD'>,
  mode: ResearchParams['mode'],
  intervalMs: number,
  costs: CostConfig = RESEARCH_COSTS,
  label = 'estratégia',
  endIndex = candles.length
): TradeMetrics {
  const fillIndexes = [...scheduled.keys()].filter(index => index < endIndex);
  if (fillIndexes.length === 0 || endIndex <= 0) {
    return metricsOf(label, createAccount(STARTING_EQUITY), [STARTING_EQUITY], intervalMs);
  }
  const first = Math.min(...fillIndexes);
  const lastMarked = Math.min(candles.length, endIndex) - 1;
  let account = createAccount(STARTING_EQUITY);
  const equity = [STARTING_EQUITY];
  for (let i = first; i <= lastMarked; i++) {
    const action = scheduled.get(i);
    if (action) {
      const target = targetFor(action, mode, account.qty);
      if (target) account = rebalance(account, target, candles[i].open, costs).account;
    }
    equity.push(markToMarket(account, candles[i].close));
  }
  if (account.qty !== 0 && lastMarked >= 0) {
    account = rebalance(account, 'flat', candles[lastMarked].close, costs).account;
    equity.push(markToMarket(account, candles[lastMarked].close));
  }
  return metricsOf(label, account, equity, intervalMs);
}

function scheduleFor(records: readonly StudyRecord[], actionAt: (record: StudyRecord) => 'BUY' | 'SELL' | 'HOLD'): Map<number, 'BUY' | 'SELL' | 'HOLD'> {
  const scheduled = new Map<number, 'BUY' | 'SELL' | 'HOLD'>();
  for (const record of records) scheduled.set(record.fillIndex, actionAt(record));
  return scheduled;
}

export function runParams(
  candles: readonly CanonicalCandle[],
  records: readonly StudyRecord[],
  params: ResearchParams,
  intervalMs: number,
  endIndex = candles.length
): TradeMetrics {
  return simulateDecisions(
    candles,
    scheduleFor(records, record => researchAction(record, params)),
    params.mode,
    intervalMs,
    RESEARCH_COSTS,
    params.id,
    endIndex
  );
}

/** Direction of the bar that just closed. The previous close is known at decision time. */
export function persistenceAction(record: StudyRecord, previousClose: number): 'BUY' | 'SELL' | 'HOLD' {
  if (record.close > previousClose) return 'BUY';
  if (record.close < previousClose) return 'SELL';
  return 'HOLD';
}

export function tuneInSample(
  candles: readonly CanonicalCandle[],
  inSample: readonly StudyRecord[],
  intervalMs: number,
  endIndex = candles.length
): TunedChoice {
  const grid = eachTunedParams();
  let best: { params: ResearchParams; metrics: TradeMetrics } | null = null;
  let eligible = 0;
  for (const params of grid) {
    const metrics = runParams(candles, inSample, params, intervalMs, endIndex);
    if (metrics.closedTrades < MIN_IN_SAMPLE_TRADES) continue;
    eligible += 1;
    const betterSharpe = best === null
      || (metrics.sharpe ?? Number.NEGATIVE_INFINITY) > (best.metrics.sharpe ?? Number.NEGATIVE_INFINITY);
    if (betterSharpe) best = { params, metrics };
  }
  return {
    tried: grid.length,
    eligible,
    params: best?.params ?? null,
    inSample: best?.metrics ?? null
  };
}

export interface SeriesScore {
  symbol: string;
  interval: string;
  inSampleDecisions: number;
  outOfSampleDecisions: number;
  embargoed: number;
  directionInSample: DirectionStats;
  directionOutOfSample: DirectionStats;
  maeOutOfSample: number | null;
  strategies: TradeMetrics[];
}

export function scoreWindow(
  candles: readonly CanonicalCandle[],
  records: readonly StudyRecord[],
  params: ResearchParams,
  intervalMs: number,
  previousCloseAt: (record: StudyRecord) => number,
  seed: number,
  endIndex = candles.length
): TradeMetrics[] {
  const strategies = [
    runParams(candles, records, params, intervalMs, endIndex)
  ];
  const buyAndHold = new Map<number, 'BUY' | 'SELL' | 'HOLD'>();
  const persistence = new Map<number, 'BUY' | 'SELL' | 'HOLD'>();
  const random = new Map<number, 'BUY' | 'SELL' | 'HOLD'>();
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (records[0]) buyAndHold.set(records[0].fillIndex, 'BUY');
  for (const record of records) {
    persistence.set(record.fillIndex, persistenceAction(record, previousCloseAt(record)));
    const roll = next();
    random.set(record.fillIndex, roll < 1 / 3 ? 'HOLD' : roll < 2 / 3 ? 'BUY' : 'SELL');
  }
  strategies.push(
    simulateDecisions(candles, buyAndHold, 'long_only', intervalMs, RESEARCH_COSTS, 'comprar-e-segurar', endIndex),
    simulateDecisions(candles, persistence, 'long_short', intervalMs, RESEARCH_COSTS, 'ultimo-candle', endIndex),
    simulateDecisions(candles, random, 'long_short', intervalMs, RESEARCH_COSTS, 'aleatorio', endIndex)
  );
  return strategies;
}

export function seriesSeed(symbol: string, interval: string, split: string): number {
  const text = `${symbol}|${interval}|${split}|42`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return hash >>> 0;
}

export interface PromotionDecision {
  promoteToPaper: boolean;
  reasons: string[];
}

/**
 * The only way a research rule becomes selectable for paper trading.
 * Primary series only. Other series cannot unlock it.
 */
export function promotionDecision(
  symbol: string,
  interval: string,
  direction: DirectionStats,
  strategy: TradeMetrics | null,
  buyAndHold: TradeMetrics | null
): PromotionDecision {
  const reasons: string[] = [];
  if (symbol !== PRIMARY_SERIES.symbol || interval !== PRIMARY_SERIES.interval) {
    return { promoteToPaper: false, reasons: ['Só BTCUSDT 1h pode habilitar a estratégia opcional.'] };
  }
  if (direction.pValue === null || direction.compared === 0) {
    reasons.push('Não houve comparações de direção fora da amostra.');
    return { promoteToPaper: false, reasons };
  }
  if (direction.pValue >= PRIMARY_ALPHA) {
    reasons.push(`O p-valor da direção foi ${direction.pValue.toFixed(4)}, acima de ${PRIMARY_ALPHA}.`);
  }
  if (!strategy || !buyAndHold) {
    reasons.push('A configuração escolhida na amostra não pôde ser medida fora da amostra.');
    return { promoteToPaper: false, reasons };
  }
  if (strategy.closedTrades < MIN_OOS_TRADES) {
    reasons.push(`Houve ${strategy.closedTrades} trades fora da amostra; o mínimo é ${MIN_OOS_TRADES}.`);
  }
  if (strategy.returnPct <= buyAndHold.returnPct) {
    reasons.push(`O retorno ${strategy.returnPct.toFixed(2)}% não superou comprar e segurar (${buyAndHold.returnPct.toFixed(2)}%).`);
  }
  const promoteToPaper = reasons.length === 0;
  if (promoteToPaper) {
    reasons.push('A regra principal passou: direção melhor que o acaso e retorno acima de comprar e segurar, com trades suficientes.');
  }
  return { promoteToPaper, reasons };
}

export function preRegisteredRules(): ResearchParams[] {
  return [CURRENT_RULE, CURRENT_RULE_LONG_ONLY];
}
