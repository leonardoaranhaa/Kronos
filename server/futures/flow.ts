import type { AggTrade } from './parse';

export interface TopOfBook {
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
}

export interface TradeFlow {
  buyQuantity: number;
  sellQuantity: number;
  buyNotional: number;
  sellNotional: number;
  /** Buy quantity minus sell quantity. Buyer-is-maker means the seller was the aggressor. */
  cvd: number;
  /** (buy − sell) / (buy + sell). Null when the hour has no trades. */
  imbalance: number | null;
}

/**
 * Cont, Kukanov and Stoikov order-flow imbalance from two top-of-book snapshots.
 * A higher bid price or a larger bid size pushes the value up. The ask side is subtracted.
 */
export function bookOrderFlowImbalance(previous: TopOfBook, next: TopOfBook): number {
  const bidUp = next.bidPrice >= previous.bidPrice ? next.bidQty : 0;
  const bidKept = next.bidPrice <= previous.bidPrice ? previous.bidQty : 0;
  const askDown = next.askPrice <= previous.askPrice ? next.askQty : 0;
  const askKept = next.askPrice >= previous.askPrice ? previous.askQty : 0;
  return (bidUp - bidKept) - (askDown - askKept);
}

export function emptyFlow(): TradeFlow {
  return { buyQuantity: 0, sellQuantity: 0, buyNotional: 0, sellNotional: 0, cvd: 0, imbalance: null };
}

export function addAggTrade(flow: TradeFlow, trade: Pick<AggTrade, 'price' | 'quantity' | 'buyerIsMaker'>): TradeFlow {
  const notional = trade.price * trade.quantity;
  const next = { ...flow };
  if (trade.buyerIsMaker) {
    next.sellQuantity += trade.quantity;
    next.sellNotional += notional;
    next.cvd -= trade.quantity;
  } else {
    next.buyQuantity += trade.quantity;
    next.buyNotional += notional;
    next.cvd += trade.quantity;
  }
  const total = next.buyQuantity + next.sellQuantity;
  next.imbalance = total > 0 ? (next.buyQuantity - next.sellQuantity) / total : null;
  return next;
}

export function aggregateAggTrades(trades: readonly AggTrade[]): TradeFlow {
  return trades.reduce(addAggTrade, emptyFlow());
}

export interface HourlyTradeFlow extends TradeFlow {
  openTime: number;
}

/** Buckets trades into the hour that contains their timestamp. */
export function hourlyAggFlow(trades: readonly AggTrade[], hourMs = 3_600_000): HourlyTradeFlow[] {
  const buckets = new Map<number, TradeFlow>();
  for (const trade of trades) {
    const openTime = Math.floor(trade.time / hourMs) * hourMs;
    buckets.set(openTime, addAggTrade(buckets.get(openTime) ?? emptyFlow(), trade));
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([openTime, flow]) => ({ openTime, ...flow }));
}

export function takerImbalance(takerBuy: number, volume: number): number | null {
  if (!(volume > 0) || takerBuy < 0 || takerBuy > volume + 1e-8) return null;
  return (2 * takerBuy - volume) / volume;
}
