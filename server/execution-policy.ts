import { BreakerDecision } from './circuit_breaker';
import { SignalAction } from './signals';
import { PositionTarget, positionSide } from './trading-math';

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
