export interface CircuitBreakerConfig {
  /** Trip when equity falls this many percent below the UTC day's starting equity. */
  maxDailyDrawdownPct: number;
  /** After this many losing round trips, block new risk for `cooldownPeriodMs`. */
  maxConsecutiveLosses: number;
  cooldownPeriodMs: number;
  /** Block new risk when the feed has been silent for longer than this. */
  feedTimeoutMs: number;
}

export interface BreakerState {
  dayKey: string;
  dayStartEquity: number;
  equity: number;
  consecutiveLosses: number;
  tripped: boolean;
  tripReason: string;
  cooldownUntil: number;
  lastHeartbeatAt: number;
}

export interface BreakerDecision {
  canOpen: boolean;
  mustFlatten: boolean;
  feedStale: boolean;
  inCooldown: boolean;
  tripped: boolean;
  reason: string;
}

export const DEFAULT_BREAKER_CONFIG: CircuitBreakerConfig = {
  maxDailyDrawdownPct: 2,
  maxConsecutiveLosses: 3,
  cooldownPeriodMs: 30 * 60 * 1000,
  feedTimeoutMs: 30_000
};

export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function createBreaker(config: CircuitBreakerConfig, now: number, equity: number): BreakerState {
  return {
    dayKey: utcDayKey(now),
    dayStartEquity: equity,
    equity,
    consecutiveLosses: 0,
    tripped: false,
    tripReason: '',
    cooldownUntil: 0,
    lastHeartbeatAt: now
  };
}

export function noteHeartbeat(state: BreakerState, now: number): BreakerState {
  return { ...state, lastHeartbeatAt: now };
}

export function dailyPnlPct(state: BreakerState): number {
  if (!(state.dayStartEquity > 0)) return 0;
  return ((state.equity - state.dayStartEquity) / state.dayStartEquity) * 100;
}

/** Rolls the daily baseline at UTC midnight, then trips on a drawdown breach. */
export function noteEquity(state: BreakerState, config: CircuitBreakerConfig, equity: number, now: number): BreakerState {
  const dayKey = utcDayKey(now);
  let next = state;
  if (dayKey !== state.dayKey) {
    next = {
      ...state,
      dayKey,
      dayStartEquity: equity,
      tripped: false,
      tripReason: '',
      consecutiveLosses: 0
    };
  }
  next = { ...next, equity };
  if (next.dayStartEquity > 0) {
    const drawdown = ((equity - next.dayStartEquity) / next.dayStartEquity) * 100;
    if (drawdown <= -config.maxDailyDrawdownPct) {
      next = {
        ...next,
        tripped: true,
        tripReason: `Perda diária de ${drawdown.toFixed(2)}% atingiu o limite de -${config.maxDailyDrawdownPct}%.`
      };
    }
  }
  return next;
}

/** Counts closed round trips. A loss streak starts a cooldown and then resets the counter. */
export function noteClosedTrade(state: BreakerState, config: CircuitBreakerConfig, realizedPnl: number, now: number): BreakerState {
  if (realizedPnl > 0) return { ...state, consecutiveLosses: 0 };
  if (realizedPnl === 0) return state;
  const consecutiveLosses = state.consecutiveLosses + 1;
  if (consecutiveLosses >= config.maxConsecutiveLosses) {
    return {
      ...state,
      consecutiveLosses: 0,
      cooldownUntil: now + config.cooldownPeriodMs
    };
  }
  return { ...state, consecutiveLosses };
}

export function evaluateBreaker(state: BreakerState, config: CircuitBreakerConfig, now: number): BreakerDecision {
  const feedStale = now - state.lastHeartbeatAt > config.feedTimeoutMs;
  const inCooldown = now < state.cooldownUntil;
  if (state.tripped) {
    return {
      canOpen: false,
      mustFlatten: true,
      feedStale,
      inCooldown,
      tripped: true,
      reason: state.tripReason || 'Trava diária disparada.'
    };
  }
  if (inCooldown) {
    const remainingSec = Math.ceil((state.cooldownUntil - now) / 1000);
    return {
      canOpen: false,
      mustFlatten: false,
      feedStale,
      inCooldown: true,
      tripped: false,
      reason: `Pausa após ${config.maxConsecutiveLosses} perdas seguidas (${remainingSec}s restantes).`
    };
  }
  if (feedStale) {
    return {
      canOpen: false,
      mustFlatten: false,
      feedStale: true,
      inCooldown: false,
      tripped: false,
      reason: 'Feed sem heartbeat dentro do tempo limite. Novas entradas bloqueadas.'
    };
  }
  return {
    canOpen: true,
    mustFlatten: false,
    feedStale: false,
    inCooldown: false,
    tripped: false,
    reason: 'Regras de risco em condição normal.'
  };
}

/** Small stateful wrapper so manual checks can call methods instead of threading state. */
export class CircuitBreakerManager {
  private state: BreakerState;

  constructor(
    private readonly config: CircuitBreakerConfig,
    now = Date.now(),
    equity = 10_000
  ) {
    this.state = createBreaker(config, now, equity);
  }

  recordHeartbeat(now = Date.now()): void {
    this.state = noteHeartbeat(this.state, now);
  }

  recordEquity(equity: number, now = Date.now()): void {
    this.state = noteEquity(this.state, this.config, equity, now);
  }

  recordClosedTrade(realizedPnl: number, now = Date.now()): void {
    this.state = noteClosedTrade(this.state, this.config, realizedPnl, now);
  }

  evaluate(now = Date.now()): BreakerDecision {
    return evaluateBreaker(this.state, this.config, now);
  }

  getStatus(now = Date.now()) {
    return {
      ...this.state,
      dailyPnlPct: Number(dailyPnlPct(this.state).toFixed(4)),
      ...this.evaluate(now)
    };
  }
}
