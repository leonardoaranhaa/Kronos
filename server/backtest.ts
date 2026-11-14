import { CanonicalCandle, Candle } from '../shared/types';
import {
  BreakerState,
  CircuitBreakerConfig,
  createBreaker,
  evaluateBreaker,
  noteClosedTrade,
  noteEquity,
  noteHeartbeat
} from './circuit_breaker';
import { rebalanceRespectingCooldown } from './execution-policy';
import { computeIndicators } from './indicators';
import { SignalConfig, SignalAction, decideSignal } from './signals';
import { Account, CostConfig, createAccount, markToMarket, rebalance } from './trading-math';

export interface WalkForwardConfig {
  context: number;
  horizon: number;
  stride: number;
  costs: CostConfig;
  signal: SignalConfig;
  breaker: CircuitBreakerConfig;
  startingEquity: number;
  intervalMs: number;
  randomSeed: number;
}

export interface TradingMetrics {
  label: string;
  startingEquity: number;
  endingEquity: number;
  returnPct: number;
  maxDrawdownPct: number;
  winRatePct: number | null;
  closedTrades: number;
  wins: number;
  losses: number;
  feesPaid: number;
  sharpe: number | null;
  breakerTrips: number;
  cooldownEvents: number;
  equityCurve: { t: number; equity: number }[];
}

export interface WalkForwardResult {
  sampling: {
    context: number;
    horizon: number;
    stride: number;
    decisionCount: number;
    candleCount: number;
    firstDecisionOpenTime: number | null;
    lastDecisionOpenTime: number | null;
  };
  forecast: {
    directionalAccuracy: number | null;
    directionalSamples: number;
    directionalHits: number;
    mae: number | null;
    mape: number | null;
  };
  strategies: {
    kronos: TradingMetrics;
    buyAndHold: TradingMetrics;
    persistence: TradingMetrics;
    random: TradingMetrics;
  };
}

export interface Forecaster {
  predict(window: CanonicalCandle[]): Promise<readonly number[]> | readonly number[];
}

export type WalkForwardProgress = (completed: number, total: number) => void;

interface ScheduledAction {
  index: number;
  action: SignalAction;
}

function toIndicatorCandle(candle: CanonicalCandle): Candle {
  return {
    timestamp: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  };
}

function assertOrdered(candles: readonly CanonicalCandle[]): void {
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].openTime <= candles[i - 1].openTime) {
      throw new Error('backtest candles must be strictly ordered by openTime');
    }
  }
}

function downsample(points: { t: number; equity: number }[], maxPoints: number): { t: number; equity: number }[] {
  if (points.length <= maxPoints) return points;
  const sampled: { t: number; equity: number }[] = [];
  const step = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) sampled.push(points[Math.round(i * step)]);
  return sampled;
}

function sharpeRatio(equity: number[], intervalMs: number): number | null {
  if (equity.length < 3) return null;
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (!(equity[i - 1] > 0)) return null;
    returns.push(equity[i] / equity[i - 1] - 1);
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return null;
  const periodsPerYear = (365.25 * 24 * 60 * 60 * 1000) / intervalMs;
  return (mean / std) * Math.sqrt(periodsPerYear);
}

function maxDrawdownPct(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let worst = 0;
  for (const value of equity) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.max(worst, (peak - value) / peak);
  }
  return worst * 100;
}

function metricsOf(
  label: string,
  account: Account,
  equity: { t: number; equity: number }[],
  startingEquity: number,
  intervalMs: number,
  breakerTrips: number,
  cooldownEvents: number
): TradingMetrics {
  const endingEquity = equity.length ? equity[equity.length - 1].equity : account.cash;
  return {
    label,
    startingEquity,
    endingEquity,
    returnPct: ((endingEquity - startingEquity) / startingEquity) * 100,
    maxDrawdownPct: maxDrawdownPct(equity.map(point => point.equity)),
    winRatePct: account.closedTrades > 0 ? (account.wins / account.closedTrades) * 100 : null,
    closedTrades: account.closedTrades,
    wins: account.wins,
    losses: account.losses,
    feesPaid: account.feesPaid,
    sharpe: sharpeRatio(equity.map(point => point.equity), intervalMs),
    breakerTrips,
    cooldownEvents,
    equityCurve: downsample(equity, 180)
  };
}

interface SimulationOptions {
  costs: CostConfig;
  startingEquity: number;
  intervalMs: number;
  breaker: CircuitBreakerConfig | null;
  schedule: Map<number, SignalAction>;
  label: string;
}

function simulate(candles: readonly CanonicalCandle[], options: SimulationOptions): TradingMetrics {
  let account = createAccount(options.startingEquity);
  const curve: { t: number; equity: number }[] = [];
  const scheduled = [...options.schedule.keys()];
  const firstIndex = scheduled.length ? Math.min(...scheduled) : 0;
  if (candles[firstIndex]) {
    curve.push({ t: candles[firstIndex].openTime, equity: options.startingEquity });
  }
  // The 30s feed timeout watches a live socket. A 5-minute historical series is
  // already continuous, so replaying that timeout would block every decision.
  const breakerConfig = options.breaker
    ? { ...options.breaker, feedTimeoutMs: Number.MAX_SAFE_INTEGER }
    : null;
  let breaker: BreakerState | null = breakerConfig
    ? createBreaker(breakerConfig, candles[0].openTime, options.startingEquity)
    : null;
  let breakerTrips = 0;
  let cooldownEvents = 0;
  let wasTripped = false;
  let lastCooldownUntil = 0;

  const applyAt = (index: number, action: SignalAction, price: number, now: number) => {
    if (breaker && breakerConfig) {
      breaker = noteHeartbeat(breaker, now);
      const decision = evaluateBreaker(breaker, breakerConfig, now);
      if (decision.tripped && !wasTripped) breakerTrips += 1;
      wasTripped = decision.tripped;
      if (decision.inCooldown && breaker.cooldownUntil !== lastCooldownUntil) {
        cooldownEvents += 1;
        lastCooldownUntil = breaker.cooldownUntil;
      }
      const changed = rebalanceRespectingCooldown(account, breaker, breakerConfig, action, price, now, options.costs);
      account = changed.account;
      breaker = changed.breaker;
      if (breaker.cooldownUntil > now && breaker.cooldownUntil !== lastCooldownUntil) {
        cooldownEvents += 1;
        lastCooldownUntil = breaker.cooldownUntil;
      }
    } else {
      const target = action === 'BUY' ? 'long' : action === 'SELL' ? 'short' : 'flat';
      if (action === 'HOLD') return;
      const changed = rebalance(account, target, price, options.costs);
      account = changed.account;
    }
  };

  for (let i = 0; i < candles.length; i++) {
    const action = options.schedule.get(i);
    if (action) applyAt(i, action, candles[i].open, candles[i].openTime);
    const equityBefore = markToMarket(account, candles[i].close);
    let equity = equityBefore;
    if (breaker && breakerConfig) {
      breaker = noteHeartbeat(breaker, candles[i].closeTime);
      const before = breaker.tripped;
      breaker = noteEquity(breaker, breakerConfig, equity, candles[i].closeTime);
      if (!before && breaker.tripped) breakerTrips += 1;
      wasTripped = breaker.tripped;
      const decision = evaluateBreaker(breaker, breakerConfig, candles[i].closeTime);
      if (decision.mustFlatten && account.qty !== 0) {
        const closed = rebalance(account, 'flat', candles[i].close, options.costs);
        account = closed.account;
        for (const fill of closed.fills) {
          if (fill.realizedPnl !== null) {
            breaker = noteClosedTrade(breaker, breakerConfig, fill.realizedPnl, candles[i].closeTime);
          }
        }
        equity = markToMarket(account, candles[i].close);
        breaker = noteEquity(breaker, breakerConfig, equity, candles[i].closeTime);
      }
    }
    if (i >= firstIndex) curve.push({ t: candles[i].closeTime, equity });
  }

  if (account.qty !== 0) {
    const last = candles[candles.length - 1];
    const closed = rebalance(account, 'flat', last.close, options.costs);
    account = closed.account;
    const equity = markToMarket(account, last.close);
    curve.push({ t: last.closeTime, equity });
  }

  return metricsOf(
    options.label,
    account,
    curve,
    options.startingEquity,
    options.intervalMs,
    breakerTrips,
    cooldownEvents
  );
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

/**
 * Walk-forward research backtest.
 * At decision index t the model and indicators see only candles[0..t].
 * The resulting order is filled at the open of candle t+1.
 * Forecast errors use candles after t and are not inputs to the signal.
 */
export async function runWalkForward(
  candles: readonly CanonicalCandle[],
  config: WalkForwardConfig,
  forecaster: Forecaster,
  onProgress?: WalkForwardProgress
): Promise<WalkForwardResult> {
  assertOrdered(candles);
  const { context, horizon, stride } = config;
  if (candles.length < context + horizon + 1) {
    throw new Error(`need at least ${context + horizon + 1} candles, received ${candles.length}`);
  }

  let absError = 0;
  let absPct = 0;
  let points = 0;
  let directionalHits = 0;
  let directionalSamples = 0;
  const kronosSchedule = new Map<number, SignalAction>();
  const persistenceSchedule = new Map<number, SignalAction>();
  const randomSchedule = new Map<number, SignalAction>();
  const random = mulberry32(config.randomSeed);
  let decisionCount = 0;
  let firstDecisionOpenTime: number | null = null;
  let lastDecisionOpenTime: number | null = null;
  const decisionIndexes: number[] = [];
  for (let t = context - 1; t + horizon < candles.length; t += stride) decisionIndexes.push(t);

  for (const t of decisionIndexes) {
    const window = candles.slice(t - context + 1, t + 1);
    const prefix = candles.slice(0, t + 1);
    const predicted = [...await forecaster.predict(window)];
    if (predicted.length < horizon) {
      throw new Error(`forecaster returned ${predicted.length} values, expected ${horizon}`);
    }
    const indicators = computeIndicators(prefix.map(toIndicatorCandle));
    const signal = decideSignal({
      close: candles[t].close,
      predictedCloses: predicted.slice(0, horizon),
      ema9: indicators.ema9,
      ema20: indicators.ema20,
      rsi14: indicators.rsi14,
      atr14: indicators.atr14
    }, config.signal);
    kronosSchedule.set(t + 1, signal.action);

    const previousClose = candles[t - 1].close;
    const persistence: SignalAction = candles[t].close > previousClose
      ? 'BUY'
      : candles[t].close < previousClose ? 'SELL' : 'HOLD';
    persistenceSchedule.set(t + 1, persistence);

    const roll = random();
    const randomAction: SignalAction = roll < 1 / 3 ? 'HOLD' : roll < 2 / 3 ? 'BUY' : 'SELL';
    randomSchedule.set(t + 1, randomAction);

    for (let step = 0; step < horizon; step++) {
      const actual = candles[t + 1 + step].close;
      absError += Math.abs(predicted[step] - actual);
      absPct += Math.abs(predicted[step] - actual) / actual;
      points += 1;
    }
    const base = candles[t].close;
    const predictedSign = Math.sign(predicted[horizon - 1] - base);
    const actualSign = Math.sign(candles[t + horizon].close - base);
    if (predictedSign !== 0 && actualSign !== 0) {
      directionalSamples += 1;
      if (predictedSign === actualSign) directionalHits += 1;
    }

    decisionCount += 1;
    firstDecisionOpenTime ??= candles[t].openTime;
    lastDecisionOpenTime = candles[t].openTime;
    onProgress?.(decisionCount, decisionIndexes.length);
  }

  const firstFill = kronosSchedule.keys().next().value as number | undefined;
  const buyAndHold = new Map<number, SignalAction>();
  if (firstFill !== undefined) buyAndHold.set(firstFill, 'BUY');

  const shared = {
    costs: config.costs,
    startingEquity: config.startingEquity,
    intervalMs: config.intervalMs
  };

  return {
    sampling: {
      context,
      horizon,
      stride,
      decisionCount,
      candleCount: candles.length,
      firstDecisionOpenTime,
      lastDecisionOpenTime
    },
    forecast: {
      directionalAccuracy: directionalSamples > 0 ? directionalHits / directionalSamples : null,
      directionalSamples,
      directionalHits,
      mae: points > 0 ? absError / points : null,
      mape: points > 0 ? absPct / points : null
    },
    strategies: {
      kronos: simulate(candles, {
        ...shared,
        breaker: config.breaker,
        schedule: kronosSchedule,
        label: 'Kronos'
      }),
      buyAndHold: simulate(candles, {
        ...shared,
        breaker: null,
        schedule: buyAndHold,
        label: 'Comprar e segurar'
      }),
      persistence: simulate(candles, {
        ...shared,
        breaker: null,
        schedule: persistenceSchedule,
        label: 'Último candle'
      }),
      random: simulate(candles, {
        ...shared,
        breaker: null,
        schedule: randomSchedule,
        label: 'Aleatório'
      })
    }
  };
}

/**
 * Same fill, fee and breaker path as the Kronos walk-forward.
 * The Aranha research backtest uses this so its costs are not a second implementation.
 */
export function simulateResearchSchedule(
  candles: readonly CanonicalCandle[],
  options: {
    label: string;
    costs: CostConfig;
    startingEquity: number;
    intervalMs: number;
    breaker: CircuitBreakerConfig | null;
    schedule: Map<number, SignalAction>;
  }
): TradingMetrics {
  return simulate(candles, options);
}
