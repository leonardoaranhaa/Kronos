export interface CostConfig {
  /** Fee charged on notional, each fill. 0.001 = 0.1%. */
  feeRate: number;
  /** Adverse price move applied to each fill. 0.0005 = 0.05%. */
  slippageRate: number;
  /** Fraction of available cash used as the order budget. */
  positionFraction: number;
}

export interface Account {
  cash: number;
  /** Positive long, negative short, zero flat. Shorts are simulated. */
  qty: number;
  entryFill: number;
  entryFee: number;
  feesPaid: number;
  realizedPnl: number;
  closedTrades: number;
  wins: number;
  losses: number;
}

export interface Fill {
  side: 'buy' | 'sell';
  qty: number;
  /** Reference price before slippage. */
  price: number;
  fillPrice: number;
  fee: number;
  purpose: 'open' | 'close';
  realizedPnl: number | null;
}

export type PositionTarget = 'long' | 'short' | 'flat';

export function createAccount(cash: number): Account {
  if (!Number.isFinite(cash) || cash < 0) throw new Error('starting cash must be a non-negative finite number');
  return {
    cash,
    qty: 0,
    entryFill: 0,
    entryFee: 0,
    feesPaid: 0,
    realizedPnl: 0,
    closedTrades: 0,
    wins: 0,
    losses: 0
  };
}

/** Cash plus signed inventory marked at `price`. */
export function markToMarket(account: Account, price: number): number {
  if (!Number.isFinite(price) || price <= 0) throw new Error('mark price must be positive');
  return account.cash + account.qty * price;
}

export function positionSide(qty: number): PositionTarget {
  if (qty > 0) return 'long';
  if (qty < 0) return 'short';
  return 'flat';
}

function assertPrice(price: number): void {
  if (!Number.isFinite(price) || price <= 0) throw new Error('fill price must be positive');
}

function withOutcome(account: Account, realized: number): Pick<Account, 'wins' | 'losses' | 'closedTrades' | 'realizedPnl'> {
  return {
    realizedPnl: account.realizedPnl + realized,
    closedTrades: account.closedTrades + 1,
    wins: account.wins + (realized > 0 ? 1 : 0),
    losses: account.losses + (realized < 0 ? 1 : 0)
  };
}

function closePosition(account: Account, price: number, costs: CostConfig): { account: Account; fill: Fill } {
  const qtyAbs = Math.abs(account.qty);
  const isLong = account.qty > 0;
  const fillPrice = isLong ? price * (1 - costs.slippageRate) : price * (1 + costs.slippageRate);
  const fee = qtyAbs * fillPrice * costs.feeRate;
  const cash = isLong
    ? account.cash + qtyAbs * fillPrice - fee
    : account.cash - qtyAbs * fillPrice - fee;
  const realized = isLong
    ? (fillPrice - account.entryFill) * qtyAbs - account.entryFee - fee
    : (account.entryFill - fillPrice) * qtyAbs - account.entryFee - fee;
  return {
    account: {
      ...account,
      cash,
      qty: 0,
      entryFill: 0,
      entryFee: 0,
      feesPaid: account.feesPaid + fee,
      ...withOutcome(account, realized)
    },
    fill: {
      side: isLong ? 'sell' : 'buy',
      qty: qtyAbs,
      price,
      fillPrice,
      fee,
      purpose: 'close',
      realizedPnl: realized
    }
  };
}

function openPosition(account: Account, target: 'long' | 'short', price: number, costs: CostConfig): { account: Account; fill: Fill | null } {
  const fillPrice = target === 'long' ? price * (1 + costs.slippageRate) : price * (1 - costs.slippageRate);
  const budget = account.cash * costs.positionFraction;
  if (!(fillPrice > 0) || !(budget > 0) || !(costs.feeRate >= 0)) {
    return { account, fill: null };
  }
  const qty = budget / (fillPrice * (1 + costs.feeRate));
  const notional = qty * fillPrice;
  const fee = notional * costs.feeRate;
  const cash = target === 'long'
    ? account.cash - notional - fee
    : account.cash + notional - fee;
  return {
    account: {
      ...account,
      cash,
      qty: target === 'long' ? qty : -qty,
      entryFill: fillPrice,
      entryFee: fee,
      feesPaid: account.feesPaid + fee
    },
    fill: {
      side: target === 'long' ? 'buy' : 'sell',
      qty,
      price,
      fillPrice,
      fee,
      purpose: 'open',
      realizedPnl: null
    }
  };
}

/**
 * Moves the account to `target`. An unchanged side produces no fill, so a
 * repeated BUY does not pay the fee again. A flip closes first, then opens.
 */
export function rebalance(account: Account, target: PositionTarget, price: number, costs: CostConfig): { account: Account; fills: Fill[] } {
  assertPrice(price);
  if (positionSide(account.qty) === target) return { account, fills: [] };
  const fills: Fill[] = [];
  let next = account;
  if (next.qty !== 0) {
    const closed = closePosition(next, price, costs);
    next = closed.account;
    fills.push(closed.fill);
  }
  if (target !== 'flat') {
    const opened = openPosition(next, target, price, costs);
    next = opened.account;
    if (opened.fill) fills.push(opened.fill);
  }
  return { account: next, fills };
}
