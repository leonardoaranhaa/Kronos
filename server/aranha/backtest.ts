import { CanonicalCandle } from '../../shared/types';
import { simulateResearchSchedule, TradingMetrics } from '../backtest';
import { CircuitBreakerConfig } from '../circuit_breaker';
import { SignalAction } from '../signals';
import { CostConfig } from '../trading-math';
import { buildAnalogIndex, searchAnalogs, summarizeAnalogs } from './analogs';
import { analogAction, analogsDisagree, ARANHA_GATES, structureAction } from './gates';
import { evaluatePatterns } from './structures';

export interface AranhaBacktestConfig {
  window: number;
  horizon: number;
  neighbors: number;
  separation: number;
  stride: number;
  costs: CostConfig;
  breaker: CircuitBreakerConfig;
  startingEquity: number;
  intervalMs: number;
  randomSeed: number;
}

export interface AranhaSchedules {
  analogs: Map<number, SignalAction>;
  structures: Map<number, SignalAction>;
  persistence: Map<number, SignalAction>;
  persistenceFiltered: Map<number, SignalAction>;
  random: Map<number, SignalAction>;
  buyAndHold: Map<number, SignalAction>;
  skippedByAnalogFilter: number;
  decisions: number;
  firstOpenTime: number | null;
  lastOpenTime: number | null;
  directionalSamples: number;
  directionalHits: number;
  absoluteErrorBps: number;
  errorSamples: number;
  /** One row per decision. The forward return is a label, recorded after the action is chosen. */
  points: AranhaPoint[];
}

export interface AranhaPoint {
  index: number;
  fillIndex: number;
  predictedBps: number | null;
  probabilityUp: number | null;
  structureSign: number | null;
  filteredSign: number | null;
  actualBps: number;
  wentUp: boolean | null;
}

export interface AranhaBacktestResult {
  sampling: {
    window: number;
    horizon: number;
    neighbors: number;
    separation: number;
    stride: number;
    decisionCount: number;
    candleCount: number;
    firstDecisionOpenTime: number | null;
    lastDecisionOpenTime: number | null;
  };
  analogForecast: {
    directionalAccuracy: number | null;
    directionalSamples: number;
    directionalHits: number;
    maeBps: number | null;
  };
  filter: {
    skippedByAnalogFilter: number;
    decisions: number;
  };
  strategies: {
    analogs: TradingMetrics;
    structures: TradingMetrics;
    persistenceFiltered: TradingMetrics;
    persistence: TradingMetrics;
    buyAndHold: TradingMetrics;
    random: TradingMetrics;
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertOrdered(candles: readonly CanonicalCandle[]): void {
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].openTime <= candles[i - 1].openTime) {
      throw new Error('aranha backtest candles must be strictly ordered by openTime');
    }
  }
}

/**
 * Walk-forward schedules. At decision t, analogs and patterns see only
 * candles whose outcome is already known. The forward return of the market
 * after t is a label, not an input.
 */
export function buildAranhaSchedules(
  candles: readonly CanonicalCandle[],
  config: Pick<AranhaBacktestConfig, 'window' | 'horizon' | 'neighbors' | 'separation' | 'stride' | 'randomSeed'>
): AranhaSchedules {
  assertOrdered(candles);
  const index = buildAnalogIndex(candles, config.window);
  const search = {
    window: config.window,
    horizon: config.horizon,
    k: config.neighbors,
    separation: config.separation,
    candidateStride: 1
  };
  const schedules: AranhaSchedules = {
    analogs: new Map(),
    structures: new Map(),
    persistence: new Map(),
    persistenceFiltered: new Map(),
    random: new Map(),
    buyAndHold: new Map(),
    skippedByAnalogFilter: 0,
    decisions: 0,
    firstOpenTime: null,
    lastOpenTime: null,
    directionalSamples: 0,
    directionalHits: 0,
    absoluteErrorBps: 0,
    errorSamples: 0,
    points: []
  };
  const random = mulberry32(config.randomSeed);
  const start = config.window * 2;
  let firstFill: number | null = null;

  for (let t = start; t + config.horizon < candles.length && t + 1 < candles.length; t += config.stride) {
    const matches = searchAnalogs(index, t, search);
    const summary = summarizeAnalogs(matches);
    const fillAt = t + 1;
    schedules.analogs.set(fillAt, analogAction(summary));
    schedules.structures.set(fillAt, structureAction(evaluatePatterns(candles, t)));

    const previous = candles[t - 1].close;
    const persistence: SignalAction = candles[t].close > previous ? 'BUY' : candles[t].close < previous ? 'SELL' : 'HOLD';
    schedules.persistence.set(fillAt, persistence);
    let filtered = persistence;
    if ((persistence === 'BUY' || persistence === 'SELL') && analogsDisagree(summary, persistence)) {
      filtered = 'HOLD';
      schedules.skippedByAnalogFilter += 1;
    }
    schedules.persistenceFiltered.set(fillAt, filtered);

    const roll = random();
    const randomAction: SignalAction = roll < 1 / 3 ? 'HOLD' : roll < 2 / 3 ? 'BUY' : 'SELL';
    schedules.random.set(fillAt, randomAction);

    if (summary.count >= ARANHA_GATES.minAnalogs && summary.medianForwardReturnBps !== null) {
      const actual = (candles[t + config.horizon].close / candles[t].close - 1) * 10_000;
      const predicted = summary.medianForwardReturnBps;
      schedules.absoluteErrorBps += Math.abs(predicted - actual);
      schedules.errorSamples += 1;
      if (Math.sign(predicted) !== 0 && Math.sign(actual) !== 0) {
        schedules.directionalSamples += 1;
        if (Math.sign(predicted) === Math.sign(actual)) schedules.directionalHits += 1;
      }
    }

    const actualBps = (candles[t + config.horizon].close / candles[t].close - 1) * 10_000;
    const signOf = (action: SignalAction): number | null => action === 'BUY' ? 1 : action === 'SELL' ? -1 : null;
    const comparable = summary.count >= ARANHA_GATES.minAnalogs && summary.medianForwardReturnBps !== null;
    schedules.points.push({
      index: t,
      fillIndex: fillAt,
      predictedBps: comparable ? summary.medianForwardReturnBps : null,
      probabilityUp: comparable && summary.hitRateUp !== null ? summary.hitRateUp : null,
      structureSign: signOf(schedules.structures.get(fillAt) ?? 'HOLD'),
      filteredSign: signOf(filtered),
      actualBps,
      wentUp: actualBps === 0 ? null : actualBps > 0
    });
    schedules.decisions += 1;
    schedules.firstOpenTime ??= candles[t].openTime;
    schedules.lastOpenTime = candles[t].openTime;
    firstFill ??= fillAt;
  }

  if (firstFill !== null) schedules.buyAndHold.set(firstFill, 'BUY');
  return schedules;
}

export function runAranhaBacktest(candles: readonly CanonicalCandle[], config: AranhaBacktestConfig): AranhaBacktestResult {
  const schedules = buildAranhaSchedules(candles, config);
  const shared = {
    costs: config.costs,
    startingEquity: config.startingEquity,
    intervalMs: config.intervalMs
  };
  const run = (label: string, schedule: Map<number, SignalAction>, breaker: CircuitBreakerConfig | null) => simulateResearchSchedule(candles, {
    ...shared,
    label,
    breaker,
    schedule
  });

  return {
    sampling: {
      window: config.window,
      horizon: config.horizon,
      neighbors: config.neighbors,
      separation: config.separation,
      stride: config.stride,
      decisionCount: schedules.decisions,
      candleCount: candles.length,
      firstDecisionOpenTime: schedules.firstOpenTime,
      lastDecisionOpenTime: schedules.lastOpenTime
    },
    analogForecast: {
      directionalAccuracy: schedules.directionalSamples > 0 ? schedules.directionalHits / schedules.directionalSamples : null,
      directionalSamples: schedules.directionalSamples,
      directionalHits: schedules.directionalHits,
      maeBps: schedules.errorSamples > 0 ? schedules.absoluteErrorBps / schedules.errorSamples : null
    },
    filter: {
      skippedByAnalogFilter: schedules.skippedByAnalogFilter,
      decisions: schedules.decisions
    },
    strategies: {
      analogs: run('Análogos', schedules.analogs, config.breaker),
      structures: run('Estruturas', schedules.structures, config.breaker),
      persistenceFiltered: run('Persistência com filtro de análogos', schedules.persistenceFiltered, config.breaker),
      persistence: run('Último candle', schedules.persistence, null),
      buyAndHold: run('Comprar e segurar', schedules.buyAndHold, null),
      random: run('Aleatório', schedules.random, null)
    }
  };
}
