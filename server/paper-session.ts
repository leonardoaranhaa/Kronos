import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { CanonicalCandle } from '../shared/types';
import { appendAuditEvent, AuditEvent } from './audit-log';
import {
  BreakerState,
  CircuitBreakerConfig,
  createBreaker,
  dailyPnlPct,
  evaluateBreaker,
  noteClosedTrade,
  noteEquity,
  noteHeartbeat
} from './circuit_breaker';
import { resolveTarget } from './execution-policy';
import { ResearchSignal } from './signals';
import { Account, CostConfig, Fill, createAccount, markToMarket, positionSide, rebalance } from './trading-math';

export interface PaperSnapshot {
  equity: number;
  cash: number;
  qty: number;
  side: 'long' | 'short' | 'flat';
  realizedPnl: number;
  feesPaid: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  lastPrice: number | null;
  signal: ResearchSignal | null;
  signalPending: boolean;
  equityCurve: { t: number; equity: number }[];
  recentEvents: AuditEvent[];
  breaker: {
    canOpen: boolean;
    mustFlatten: boolean;
    tripped: boolean;
    inCooldown: boolean;
    feedStale: boolean;
    consecutiveLosses: number;
    dailyPnlPct: number;
    cooldownUntil: number;
    reason: string;
  };
}

interface PersistedPaper {
  account: Account;
  breaker: BreakerState;
  pending: { signal: ResearchSignal; decisionOpenTime: number } | null;
  lastSignal: ResearchSignal | null;
  lastPrice: number | null;
  equityCurve: { t: number; equity: number }[];
}

export interface PaperStep {
  fills: Fill[];
  flattened: boolean;
  snapshot: PaperSnapshot;
}

/**
 * Simulated broker. A signal queued from a forecast is filled on the next
 * candle's open, never on the candle that produced the forecast.
 */
export class PaperSession {
  private account: Account;
  private breaker: BreakerState;
  private pending: { signal: ResearchSignal; decisionOpenTime: number } | null = null;
  private lastSignal: ResearchSignal | null = null;
  private lastPrice: number | null = null;
  private equityCurve: { t: number; equity: number }[] = [];
  private recentEvents: AuditEvent[] = [];

  constructor(
    private readonly costs: CostConfig,
    private readonly breakerConfig: CircuitBreakerConfig,
    startingEquity: number,
    private readonly auditPath?: string,
    private readonly statePath?: string,
    now = Date.now()
  ) {
    const loaded = statePath ? readPersisted(statePath) : null;
    if (loaded) {
      this.account = loaded.account;
      this.breaker = loaded.breaker;
      this.pending = loaded.pending;
      this.lastSignal = loaded.lastSignal;
      this.lastPrice = loaded.lastPrice;
      this.equityCurve = loaded.equityCurve;
    } else {
      this.account = createAccount(startingEquity);
      this.breaker = createBreaker(breakerConfig, now, startingEquity);
    }
  }

  noteFeedHeartbeat(now: number): void {
    this.breaker = noteHeartbeat(this.breaker, now);
  }

  queueSignal(signal: ResearchSignal, decisionOpenTime: number, now: number): void {
    this.pending = { signal, decisionOpenTime };
    this.lastSignal = signal;
    this.record({
      at: new Date(now).toISOString(),
      type: 'signal',
      action: signal.action,
      reason: signal.reason,
      forecastReturnBps: signal.forecastReturnBps,
      decisionOpenTime
    });
  }

  onCandle(candle: CanonicalCandle, now = Date.now()): PaperStep {
    let flattened = false;
    const fills: Fill[] = [];
    // Heartbeat uses wall time. Candle timestamps are 5 minutes apart and
    // would look like a dead feed against the 30-second socket timeout.
    this.breaker = noteHeartbeat(this.breaker, now);

    if (this.pending && candle.openTime > this.pending.decisionOpenTime) {
      const decision = evaluateBreaker(this.breaker, this.breakerConfig, now);
      const target = resolveTarget(this.account.qty, this.pending.signal.action, decision);
      if (target) {
        const changed = rebalance(this.account, target, candle.open, this.costs);
        this.account = changed.account;
        fills.push(...changed.fills);
        for (const fill of changed.fills) {
          if (fill.purpose === 'close' && fill.realizedPnl !== null) {
            this.breaker = noteClosedTrade(this.breaker, this.breakerConfig, fill.realizedPnl, now);
          }
          this.record({
            at: new Date(candle.openTime).toISOString(),
            type: 'fill',
            purpose: fill.purpose,
            side: fill.side,
            qty: fill.qty,
            price: fill.price,
            fillPrice: fill.fillPrice,
            fee: fill.fee,
            realizedPnl: fill.realizedPnl,
            simulated: true,
            reason: fill.purpose === 'open' ? 'Abertura simulada' : 'Fechamento simulado'
          });
        }
      } else if (this.pending.signal.action !== 'HOLD' && (!decision.canOpen || decision.mustFlatten)) {
        this.record({
          at: new Date(candle.openTime).toISOString(),
          type: 'signal_blocked',
          action: this.pending.signal.action,
          reason: decision.reason
        });
      }
      this.pending = null;
    }

    const equity = markToMarket(this.account, candle.close);
    this.lastPrice = candle.close;
    this.breaker = noteEquity(this.breaker, this.breakerConfig, equity, candle.closeTime);
    const afterMark = evaluateBreaker(this.breaker, this.breakerConfig, now);
    if (afterMark.mustFlatten && this.account.qty !== 0) {
      const closed = rebalance(this.account, 'flat', candle.close, this.costs);
      this.account = closed.account;
      fills.push(...closed.fills);
      flattened = true;
      for (const fill of closed.fills) {
        if (fill.realizedPnl !== null) {
          this.breaker = noteClosedTrade(this.breaker, this.breakerConfig, fill.realizedPnl, now);
        }
      }
      const marked = markToMarket(this.account, candle.close);
      this.breaker = noteEquity(this.breaker, this.breakerConfig, marked, candle.closeTime);
      this.record({
        at: new Date(candle.closeTime).toISOString(),
        type: 'circuit_flatten',
        reason: afterMark.reason,
        equity: marked
      });
    }

    this.equityCurve.push({ t: candle.closeTime, equity: markToMarket(this.account, candle.close) });
    if (this.equityCurve.length > 300) this.equityCurve.splice(0, this.equityCurve.length - 300);
    this.persist();
    return { fills, flattened, snapshot: this.getSnapshot(now) };
  }

  getSnapshot(now = Date.now()): PaperSnapshot {
    const price = this.lastPrice ?? this.breaker.dayStartEquity;
    const equity = this.lastPrice === null ? this.account.cash : markToMarket(this.account, this.lastPrice);
    const decision = evaluateBreaker(this.breaker, this.breakerConfig, now);
    const winRate = this.account.closedTrades > 0 ? this.account.wins / this.account.closedTrades : null;
    return {
      equity,
      cash: this.account.cash,
      qty: this.account.qty,
      side: positionSide(this.account.qty),
      realizedPnl: this.account.realizedPnl,
      feesPaid: this.account.feesPaid,
      closedTrades: this.account.closedTrades,
      wins: this.account.wins,
      losses: this.account.losses,
      winRate,
      lastPrice: this.lastPrice,
      signal: this.lastSignal,
      signalPending: this.pending !== null,
      equityCurve: this.equityCurve.slice(),
      recentEvents: this.recentEvents.slice(),
      breaker: {
        canOpen: decision.canOpen,
        mustFlatten: decision.mustFlatten,
        tripped: decision.tripped,
        inCooldown: decision.inCooldown,
        feedStale: decision.feedStale,
        consecutiveLosses: this.breaker.consecutiveLosses,
        dailyPnlPct: dailyPnlPct({ ...this.breaker, equity }),
        cooldownUntil: this.breaker.cooldownUntil,
        reason: decision.reason
      }
    };
  }

  private record(event: AuditEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > 40) this.recentEvents.shift();
    if (this.auditPath) appendAuditEvent(this.auditPath, event);
  }

  private persist(): void {
    if (!this.statePath) return;
    const payload: PersistedPaper = {
      account: this.account,
      breaker: this.breaker,
      pending: this.pending,
      lastSignal: this.lastSignal,
      lastPrice: this.lastPrice,
      equityCurve: this.equityCurve
    };
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(payload));
  }
}

function readPersisted(filePath: string): PersistedPaper | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as PersistedPaper;
  } catch {
    return null;
  }
}
