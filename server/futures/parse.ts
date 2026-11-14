export interface FundingPrint {
  time: number;
  rate: number;
  intervalHours: number | null;
}

export interface MetricsPrint {
  time: number;
  openInterest: number;
  openInterestValue: number;
  longShortRatio: number;
  topAccountRatio: number;
  topPositionRatio: number;
  takerLongShortRatio: number;
}

export interface KlineBar {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  takerBuyVolume: number;
  quoteVolume: number;
  takerBuyQuoteVolume: number;
}

export interface AggTrade {
  id: number;
  price: number;
  quantity: number;
  time: number;
  buyerIsMaker: boolean;
}

export interface BookSnapshot {
  time: number;
  /** (bid notional − ask notional) / (bid + ask) inside 1% of mid. */
  imbalance: number;
}

export interface ForceOrder {
  symbol: string;
  time: number;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
}

const HOUR_MS = 3_600_000;

export function parseVisionTime(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) throw new Error(`data inválida: ${value}`);
    return numeric;
  }
  const iso = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  const parsed = Date.parse(zoned);
  if (!Number.isFinite(parsed)) throw new Error(`data inválida: ${value}`);
  return parsed;
}

function linesOf(text: string): string[][] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => line.split(','));
}

function headerIndex(header: string[] | undefined, names: readonly string[]): number {
  if (!header) return -1;
  const lowered = header.map(cell => cell.trim().toLowerCase());
  for (const name of names) {
    const index = lowered.indexOf(name);
    if (index >= 0) return index;
  }
  return -1;
}

function looksLikeHeader(row: string[]): boolean {
  return row.some(cell => /[A-Za-z_]/.test(cell));
}

function finite(value: string): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseFundingCsv(text: string): FundingPrint[] {
  const rows = linesOf(text);
  if (rows.length === 0) return [];
  const header = looksLikeHeader(rows[0]) ? rows[0] : undefined;
  const body = header ? rows.slice(1) : rows;
  const timeIndex = header ? headerIndex(header, ['calc_time', 'fundingtime', 'time']) : 0;
  const rateIndex = header ? headerIndex(header, ['last_funding_rate', 'funding_rate', 'fundingrate']) : 1;
  const intervalIndex = header ? headerIndex(header, ['funding_interval_hours']) : -1;
  const prints: FundingPrint[] = [];
  for (const row of body) {
    const time = finite(row[timeIndex]);
    const rateCell = rateIndex >= 0 ? row[rateIndex] : row[1];
    const rate = finite(rateCell ?? '');
    if (time === null || rate === null) continue;
    const intervalRaw = intervalIndex >= 0 ? finite(row[intervalIndex] ?? '') : null;
    prints.push({ time, rate, intervalHours: intervalRaw });
  }
  prints.sort((a, b) => a.time - b.time);
  return dedupeTime(prints);
}

export function parseMetricsCsv(text: string): MetricsPrint[] {
  const rows = linesOf(text);
  if (rows.length === 0) return [];
  if (!looksLikeHeader(rows[0])) throw new Error('métricas sem cabeçalho');
  const header = rows[0];
  const column = (name: string) => {
    const index = headerIndex(header, [name]);
    if (index < 0) throw new Error(`coluna ausente nas métricas: ${name}`);
    return index;
  };
  const timeIndex = column('create_time');
  const oi = column('sum_open_interest');
  const value = column('sum_open_interest_value');
  const accounts = column('count_long_short_ratio');
  const topAccounts = column('count_toptrader_long_short_ratio');
  const topPositions = column('sum_toptrader_long_short_ratio');
  const taker = column('sum_taker_long_short_vol_ratio');
  const prints: MetricsPrint[] = [];
  for (const row of rows.slice(1)) {
    const time = Number.isFinite(Number(row[timeIndex])) ? Number(row[timeIndex]) : parseVisionTime(row[timeIndex] ?? '');
    const openInterest = finite(row[oi] ?? '');
    const openInterestValue = finite(row[value] ?? '');
    const longShortRatio = finite(row[accounts] ?? '');
    const topAccountRatio = finite(row[topAccounts] ?? '');
    const topPositionRatio = finite(row[topPositions] ?? '');
    const takerLongShortRatio = finite(row[taker] ?? '');
    if (openInterest === null || openInterestValue === null || longShortRatio === null || takerLongShortRatio === null) continue;
    prints.push({
      time,
      openInterest,
      openInterestValue,
      longShortRatio,
      topAccountRatio: topAccountRatio ?? longShortRatio,
      topPositionRatio: topPositionRatio ?? longShortRatio,
      takerLongShortRatio
    });
  }
  prints.sort((a, b) => a.time - b.time);
  return dedupeTime(prints);
}

export function parseKlineCsv(text: string): KlineBar[] {
  const rows = linesOf(text);
  if (rows.length === 0) return [];
  const header = looksLikeHeader(rows[0]) ? rows[0] : undefined;
  const body = header ? rows.slice(1) : rows;
  const index = (names: readonly string[], fallback: number) => {
    const found = headerIndex(header, names);
    return found >= 0 ? found : fallback;
  };
  const openTime = index(['open_time'], 0);
  const open = index(['open'], 1);
  const high = index(['high'], 2);
  const low = index(['low'], 3);
  const close = index(['close'], 4);
  const volume = index(['volume'], 5);
  const closeTime = index(['close_time'], 6);
  const quote = index(['quote_volume'], 7);
  const taker = index(['taker_buy_volume'], 9);
  const takerQuote = index(['taker_buy_quote_volume'], 10);
  const bars: KlineBar[] = [];
  for (const row of body) {
    const bar: KlineBar = {
      openTime: Number(row[openTime]),
      closeTime: Number(row[closeTime]),
      open: Number(row[open]),
      high: Number(row[high]),
      low: Number(row[low]),
      close: Number(row[close]),
      volume: Number(row[volume]),
      takerBuyVolume: Number(row[taker]),
      quoteVolume: Number(row[quote]),
      takerBuyQuoteVolume: Number(row[takerQuote])
    };
    if (!Object.values(bar).every(Number.isFinite)) continue;
    if (!(bar.open > 0) || bar.high < bar.low || bar.volume < 0 || bar.takerBuyVolume < 0) continue;
    if (bar.takerBuyVolume > bar.volume + 1e-8) continue;
    bars.push(bar);
  }
  bars.sort((a, b) => a.openTime - b.openTime);
  const unique: KlineBar[] = [];
  for (const bar of bars) {
    const last = unique[unique.length - 1];
    if (last && last.openTime === bar.openTime) unique[unique.length - 1] = bar;
    else unique.push(bar);
  }
  return unique;
}

export function parseAggTradeCsv(text: string): AggTrade[] {
  const rows = linesOf(text);
  if (rows.length === 0) return [];
  const header = looksLikeHeader(rows[0]) ? rows[0] : undefined;
  const body = header ? rows.slice(1) : rows;
  const index = (names: readonly string[], fallback: number) => {
    const found = headerIndex(header, names);
    return found >= 0 ? found : fallback;
  };
  const id = index(['agg_trade_id'], 0);
  const price = index(['price'], 1);
  const quantity = index(['quantity'], 2);
  const time = index(['transact_time'], 5);
  const maker = index(['is_buyer_maker'], 6);
  const trades: AggTrade[] = [];
  for (const row of body) {
    const trade: AggTrade = {
      id: Number(row[id]),
      price: Number(row[price]),
      quantity: Number(row[quantity]),
      time: Number(row[time]),
      buyerIsMaker: String(row[maker]).trim().toLowerCase() === 'true'
    };
    if (!Number.isFinite(trade.price) || !Number.isFinite(trade.quantity) || !Number.isFinite(trade.time)) continue;
    if (!(trade.quantity > 0) || !(trade.price > 0)) continue;
    trades.push(trade);
  }
  trades.sort((a, b) => a.time - b.time || a.id - b.id);
  return trades;
}

/**
 * Last 1% depth snapshot inside each hour.
 * The stored time is the snapshot time, which has to be <= the candle close before a decision may use it.
 */
export function parseBookDepthCsv(text: string): BookSnapshot[] {
  const rows = linesOf(text);
  if (rows.length === 0) return [];
  const header = looksLikeHeader(rows[0]) ? rows[0] : undefined;
  const body = header ? rows.slice(1) : rows;
  const index = (names: readonly string[], fallback: number) => {
    const found = headerIndex(header, names);
    return found >= 0 ? found : fallback;
  };
  const timeIndex = index(['timestamp', 'time'], 0);
  const percentageIndex = index(['percentage'], 1);
  const notionalIndex = index(['notional'], 3);
  const byTime = new Map<number, { bid: number | null; ask: number | null }>();
  for (const row of body) {
    const time = Number.isFinite(Number(row[timeIndex])) ? Number(row[timeIndex]) : parseVisionTime(row[timeIndex] ?? '');
    const percentage = Number(row[percentageIndex]);
    const notional = Number(row[notionalIndex]);
    if (!Number.isFinite(time) || !Number.isFinite(percentage) || !(notional >= 0)) continue;
    if (percentage !== -1 && percentage !== 1) continue;
    const slot = byTime.get(time) ?? { bid: null, ask: null };
    if (percentage === -1) slot.bid = notional;
    else slot.ask = notional;
    byTime.set(time, slot);
  }
  const snapshots: BookSnapshot[] = [];
  for (const [time, slot] of byTime) {
    if (slot.bid === null || slot.ask === null) continue;
    const total = slot.bid + slot.ask;
    if (!(total > 0)) continue;
    snapshots.push({ time, imbalance: (slot.bid - slot.ask) / total });
  }
  snapshots.sort((a, b) => a.time - b.time);
  const hourly = new Map<number, BookSnapshot>();
  for (const snapshot of snapshots) {
    const hour = Math.floor(snapshot.time / HOUR_MS) * HOUR_MS;
    const current = hourly.get(hour);
    if (!current || snapshot.time >= current.time) hourly.set(hour, snapshot);
  }
  return [...hourly.values()].sort((a, b) => a.time - b.time);
}

export function parseAggTradeRest(payload: unknown): AggTrade[] {
  if (!Array.isArray(payload)) return [];
  const trades: AggTrade[] = [];
  for (const row of payload) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const trade: AggTrade = {
      id: Number(record.a),
      price: Number(record.p),
      quantity: Number(record.q),
      time: Number(record.T),
      buyerIsMaker: record.m === true
    };
    if (!Number.isFinite(trade.id) || !(trade.price > 0) || !(trade.quantity > 0) || !Number.isFinite(trade.time)) continue;
    trades.push(trade);
  }
  trades.sort((a, b) => a.time - b.time || a.id - b.id);
  return trades;
}

export function parseForceOrder(payload: unknown): ForceOrder | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const order = (root.o && typeof root.o === 'object' ? root.o : root) as Record<string, unknown>;
  const symbol = String(order.s || order.symbol || '').toUpperCase();
  const sideRaw = String(order.S || order.side || '').toUpperCase();
  const time = Number(order.T ?? order.time ?? root.E);
  const quantity = Number(order.z ?? order.q ?? order.quantity);
  const price = Number(order.ap ?? order.p ?? order.price);
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return null;
  if (sideRaw !== 'BUY' && sideRaw !== 'SELL') return null;
  if (!Number.isFinite(time) || !(quantity > 0) || !(price > 0)) return null;
  return { symbol, time, side: sideRaw, quantity, price };
}

function dedupeTime<T extends { time: number }>(rows: T[]): T[] {
  const unique: T[] = [];
  for (const row of rows) {
    const last = unique[unique.length - 1];
    if (last && last.time === row.time) unique[unique.length - 1] = row;
    else unique.push(row);
  }
  return unique;
}
