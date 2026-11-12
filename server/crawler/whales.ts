import book from './exchange-addresses.json';
import type { BookWall, OnchainEvent, WhalePrint } from './types';

export interface ExchangeBook {
  btc: Record<string, string>;
  eth: Record<string, string>;
}

export const EXCHANGE_BOOK = book as ExchangeBook;

export interface AggTrade {
  symbol: string;
  price: number;
  quantity: number;
  time: number;
  /** True when the buyer is the maker, so the taker sold. */
  buyerIsMaker: boolean;
}

export function parseAggTrade(message: unknown): AggTrade | null {
  const data = unwrap(message);
  if (!data || data.e !== 'aggTrade') return null;
  const price = Number(data.p);
  const quantity = Number(data.q);
  const time = Number(data.T);
  const symbol = String(data.s || '');
  if (!symbol || !(price > 0) || !(quantity > 0) || !Number.isFinite(time)) return null;
  return { symbol, price, quantity, time, buyerIsMaker: Boolean(data.m) };
}

export function toWhalePrint(trade: AggTrade, minimumUsd: number): WhalePrint | null {
  const usd = trade.price * trade.quantity;
  if (!(usd >= minimumUsd)) return null;
  return {
    id: `${trade.symbol}-${trade.time}-${trade.price}-${trade.quantity}`,
    symbol: trade.symbol,
    time: new Date(trade.time).toISOString(),
    usd,
    side: trade.buyerIsMaker ? 'venda' : 'compra',
    price: trade.price
  };
}

/** Buy notional minus sell notional, divided by the total. Null when there is no print. */
export function whalePressure(prints: readonly WhalePrint[]): number | null {
  let buy = 0;
  let sell = 0;
  for (const print of prints) {
    if (print.side === 'compra') buy += print.usd;
    else sell += print.usd;
  }
  const total = buy + sell;
  if (!(total > 0)) return null;
  return (buy - sell) / total;
}

export interface DepthLevel {
  price: number;
  quantity: number;
}

export function parseDepth(payload: unknown): { bids: DepthLevel[]; asks: DepthLevel[] } | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as { bids?: unknown; asks?: unknown };
  const side = (value: unknown): DepthLevel[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap(level => {
      if (!Array.isArray(level) || level.length < 2) return [];
      const price = Number(level[0]);
      const quantity = Number(level[1]);
      if (!(price > 0) || !(quantity >= 0)) return [];
      return [{ price, quantity }];
    });
  };
  return { bids: side(row.bids), asks: side(row.asks) };
}

/** A wall is a level at least 3x the median notional on its side, within 1% of the mid. */
export function findWalls(symbol: string, bookSide: { bids: DepthLevel[]; asks: DepthLevel[] }): BookWall[] {
  const bestBid = bookSide.bids[0]?.price ?? 0;
  const bestAsk = bookSide.asks[0]?.price ?? 0;
  if (!(bestBid > 0) || !(bestAsk > 0)) return [];
  const mid = (bestBid + bestAsk) / 2;
  const walls: BookWall[] = [];
  for (const [side, levels] of [['compra', bookSide.bids], ['venda', bookSide.asks]] as const) {
    const notionals = levels.map(level => level.price * level.quantity).filter(value => value > 0).sort((a, b) => a - b);
    const median = notionals[Math.floor(notionals.length / 2)] ?? 0;
    if (!(median > 0)) continue;
    for (const level of levels) {
      const usd = level.price * level.quantity;
      const distancePct = Math.abs(level.price - mid) / mid * 100;
      if (usd >= median * 3 && distancePct <= 1) {
        walls.push({ symbol, side, price: level.price, usd, distancePct });
      }
    }
  }
  return walls.sort((a, b) => b.usd - a.usd).slice(0, 4);
}

export interface ChainAddress {
  address: string;
  amount: number;
}

export function tagTransfer(asset: 'BTC' | 'ETH', from: string | null, to: string | null, labels: ExchangeBook = EXCHANGE_BOOK): { direction: OnchainEvent['direction']; label: string | null } {
  const table = asset === 'BTC' ? labels.btc : labels.eth;
  const fromLabel = from ? table[from] ?? table[from.toLowerCase()] ?? null : null;
  const toLabel = to ? table[to] ?? table[to.toLowerCase()] ?? null : null;
  if (toLabel && !fromLabel) return { direction: 'entrada na corretora', label: toLabel };
  if (fromLabel && !toLabel) return { direction: 'saída da corretora', label: fromLabel };
  if (fromLabel && toLabel) return { direction: 'entre carteiras', label: `${fromLabel} → ${toLabel}` };
  return { direction: 'desconhecido', label: null };
}

export function parseMempoolRecent(payload: unknown, minimumBtc: number): { txid: string; btc: number }[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { txid?: unknown; value?: unknown };
    const txid = String(row.txid || '');
    const sats = Number(row.value);
    if (!txid || !Number.isFinite(sats)) return [];
    const btc = sats / 1e8;
    if (btc < minimumBtc) return [];
    return [{ txid, btc }];
  });
}

export function parseMempoolTransaction(payload: unknown): { from: string | null; to: string | null; time: string | null } | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as {
    status?: { block_time?: number };
    vin?: { prevout?: { scriptpubkey_address?: string; value?: number } }[];
    vout?: { scriptpubkey_address?: string; value?: number }[];
  };
  let from: string | null = null;
  let fromValue = -1;
  for (const input of row.vin ?? []) {
    const address = input.prevout?.scriptpubkey_address;
    const value = input.prevout?.value ?? 0;
    if (address && value >= fromValue) {
      from = address;
      fromValue = value;
    }
  }
  let to: string | null = null;
  let toValue = -1;
  for (const output of row.vout ?? []) {
    const address = output.scriptpubkey_address;
    const value = output.value ?? 0;
    if (address && value >= toValue) {
      to = address;
      toValue = value;
    }
  }
  const blockTime = row.status?.block_time;
  return { from, to, time: blockTime ? new Date(blockTime * 1000).toISOString() : null };
}

/** Blockscout-style list. Unknown shapes return an empty list instead of throwing. */
export function parseBlockscoutTransfers(payload: unknown, minimumUsd: number, ethPriceUsd: number): { hash: string; eth: number; from: string | null; to: string | null; time: string | null }[] {
  const record = payload && typeof payload === 'object' ? payload as { items?: unknown } : null;
  const items = Array.isArray(record?.items) ? record.items : [];
  return items.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as { hash?: unknown; value?: unknown; from?: { hash?: string }; to?: { hash?: string }; timestamp?: unknown };
    const hash = String(row.hash || '');
    const wei = Number(row.value);
    if (!hash || !Number.isFinite(wei) || !(ethPriceUsd > 0)) return [];
    const eth = wei / 1e18;
    const usd = eth * ethPriceUsd;
    if (usd < minimumUsd) return [];
    const timestamp = typeof row.timestamp === 'string' ? row.timestamp : null;
    return [{ hash, eth, from: row.from?.hash ?? null, to: row.to?.hash ?? null, time: timestamp }];
  });
}

function unwrap(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object') return null;
  const row = message as { data?: unknown; e?: unknown };
  if (row.data && typeof row.data === 'object') return row.data as Record<string, unknown>;
  if (typeof row.e === 'string') return row as Record<string, unknown>;
  return null;
}
