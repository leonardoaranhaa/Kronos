import { SignalAction } from '../signals';
import { CostConfig, PositionTarget, createAccount, markToMarket, rebalance } from '../trading-math';

export interface PricedBar {
  open: number;
  close: number;
}

function targetFor(action: SignalAction, mode: 'long_short' | 'long_only', qty: number): PositionTarget | null {
  if (action === 'HOLD') return null;
  if (action === 'BUY') return qty > 0 ? null : 'long';
  if (mode === 'long_only') return qty > 0 ? 'flat' : null;
  return qty < 0 ? null : 'short';
}

/**
 * Mark-to-market equity at each bar close. A repeated signal on the same side
 * does not pay the fee again. The last bar is flattened so the exit cost is
 * inside the path.
 */
export function equityPath(
  bars: readonly PricedBar[],
  schedule: ReadonlyMap<number, SignalAction>,
  mode: 'long_short' | 'long_only',
  costs: CostConfig,
  startingEquity = 10_000
): number[] {
  let account = createAccount(startingEquity);
  const equity: number[] = [];
  for (let index = 0; index < bars.length; index++) {
    const action = schedule.get(index);
    if (action) {
      const target = targetFor(action, mode, account.qty);
      if (target) account = rebalance(account, target, bars[index].open, costs).account;
    }
    equity.push(markToMarket(account, bars[index].close));
  }
  if (account.qty !== 0 && bars.length > 0) {
    const last = bars.length - 1;
    account = rebalance(account, 'flat', bars[last].close, costs).account;
    equity[last] = markToMarket(account, bars[last].close);
  }
  return equity;
}

export function barReturns(equity: readonly number[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < equity.length; index++) {
    if (!(equity[index - 1] > 0)) throw new Error('equity must stay positive');
    returns.push(equity[index] / equity[index - 1] - 1);
  }
  return returns;
}

/**
 * One compounded return per completed hold. The hold runs from the bar before
 * `start` (so the fill cost at `start` is inside the return) through `end`.
 * Adjacent holds share the boundary and do not double-count it.
 */
export function holdReturns(equity: readonly number[], holds: readonly { start: number; end: number }[]): number[] {
  return holds.map(hold => {
    if (hold.start <= 0 || hold.end < hold.start || hold.end >= equity.length) {
      throw new Error('hold bounds must sit inside the equity path');
    }
    const base = equity[hold.start - 1];
    if (!(base > 0)) throw new Error('hold base equity must be positive');
    return equity[hold.end] / base - 1;
  });
}
