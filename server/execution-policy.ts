import { BreakerDecision, BreakerState, CircuitBreakerConfig, evaluateBreaker, noteClosedTrade } from './circuit_breaker';
import { SignalAction } from './signals';
import { Account, CostConfig, Fill, PositionTarget, positionSide, rebalance } from './trading-math';

/**
 * Turns a research signal into a position change the simulator is allowed to make.
 * A daily-loss trip flattens. A cooldown allows a close and blocks a new entry.
 * A stale feed blocks every signal; the last mark is not treated as a fresh price.
 */
export function resolveTarget(
  qty: number,
  action: SignalAction,
  decision: BreakerDecision
): PositionTarget | null {
  if (decision.mustFlatten) return qty === 0 ? null : 'flat';
  const requested: PositionTarget | null = action === 'BUY' ? 'long' : action === 'SELL' ? 'short' : null;
  if (requested === null) return null;
  const current = positionSide(qty);
  if (requested === current) return null;
  if (!decision.canOpen) {
    if (decision.feedStale || current === 'flat') return null;
    return 'flat';
  }
  return requested;
}

function noteCloses(breaker: BreakerState, config: CircuitBreakerConfig, fills: readonly Fill[], now: number): BreakerState {
  let next = breaker;
  for (const fill of fills) {
    if (fill.purpose === 'close' && fill.realizedPnl !== null) {
      next = noteClosedTrade(next, config, fill.realizedPnl, now);
    }
  }
  return next;
}

/**
 * A flip closes first. If that close is the loss that arms the cooldown, the
 * opposite side is not opened in the same fill.
 */
export function rebalanceRespectingCooldown(
  account: Account,
  breaker: BreakerState,
  config: CircuitBreakerConfig,
  action: SignalAction,
  price: number,
  now: number,
  costs: CostConfig
): { account: Account; breaker: BreakerState; fills: Fill[] } {
  const target = resolveTarget(account.qty, action, evaluateBreaker(breaker, config, now));
  if (!target) return { account, breaker, fills: [] };
  const current = positionSide(account.qty);
  const flipping = current !== 'flat' && target !== 'flat' && target !== current;
  if (!flipping) {
    const changed = rebalance(account, target, price, costs);
    return {
      account: changed.account,
      breaker: noteCloses(breaker, config, changed.fills, now),
      fills: changed.fills
    };
  }
  const closed = rebalance(account, 'flat', price, costs);
  const afterClose = noteCloses(breaker, config, closed.fills, now);
  const decision = evaluateBreaker(afterClose, config, now);
  if (!decision.canOpen || decision.mustFlatten) {
    return { account: closed.account, breaker: afterClose, fills: closed.fills };
  }
  const opened = rebalance(closed.account, target, price, costs);
  return {
    account: opened.account,
    breaker: afterClose,
    fills: [...closed.fills, ...opened.fills]
  };
}
