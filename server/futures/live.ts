import { join } from 'node:path';
import WebSocket from 'ws';
import { addAggTrade, bookOrderFlowImbalance, emptyFlow, type TopOfBook, type TradeFlow } from './flow';
import { parseAggTradeRest, parseForceOrder, type AggTrade, type ForceOrder } from './parse';
import { FUTURES_PROTOCOL } from './protocol';
import { futuresRoot, liveSymbolDir } from './paths';
import { appendJsonl } from './store';

export interface FuturesLiveConfig {
  enabled: boolean;
  symbols: string[];
  restBase: string;
  wsBase: string;
  refreshMs: number;
  root: string;
}

export interface FuturesLiveStatus {
  enabled: boolean;
  startedAt: string | null;
  lastCycleAt: string | null;
  lastOkAt: string | null;
  symbols: string[];
  tradesSeen: Record<string, number>;
  liquidationsSeen: number;
  liquidations: string;
  restBase: string;
  websocket: string;
  errors: string[];
}

interface SocketLike {
  on(event: 'message' | 'open' | 'close' | 'error', listener: (data?: unknown) => void): void;
  close(): void;
}

export function readFuturesLiveConfig(env: NodeJS.ProcessEnv = process.env): FuturesLiveConfig {
  const flag = (env.FUTURES_LIVE ?? '1').trim().toLowerCase();
  const symbols = (env.FUTURES_SYMBOLS || FUTURES_PROTOCOL.symbols.join(','))
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(item => /^[A-Z0-9]{5,20}$/.test(item));
  const refresh = Number(env.FUTURES_REFRESH_MS || 60_000);
  if (!Number.isFinite(refresh) || refresh < 5_000) throw new Error('FUTURES_REFRESH_MS must be a number >= 5000');
  return {
    enabled: !['0', 'false', 'off', 'no', 'nao', 'não'].includes(flag),
    symbols,
    restBase: (env.FUTURES_REST_BASE || 'https://fapi.binance.com').replace(/\/$/, ''),
    wsBase: (env.FUTURES_WS_BASE || 'wss://fstream.binance.com/ws').replace(/\/$/, ''),
    refreshMs: refresh,
    root: futuresRoot(env)
  };
}

/** Public paths only. No signature and no API key. */
export function publicFuturesPaths(symbol: string, fromTradeId?: number): { path: string; purpose: string }[] {
  const tradeQuery = fromTradeId === undefined
    ? `/fapi/v1/aggTrades?symbol=${symbol}&limit=1000`
    : `/fapi/v1/aggTrades?symbol=${symbol}&fromId=${fromTradeId}&limit=1000`;
  return [
    { path: `/fapi/v1/fundingRate?symbol=${symbol}&limit=1`, purpose: 'funding' },
    { path: `/fapi/v1/openInterest?symbol=${symbol}`, purpose: 'open-interest' },
    { path: `/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=1`, purpose: 'open-interest-hist' },
    { path: `/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`, purpose: 'long-short' },
    { path: `/futures/data/takerlongshortRatio?symbol=${symbol}&period=1h&limit=1`, purpose: 'taker' },
    { path: tradeQuery, purpose: 'aggTrades' },
    { path: `/fapi/v1/depth?symbol=${symbol}&limit=20`, purpose: 'book' },
    { path: `/fapi/v1/allForceOrders?symbol=${symbol}&limit=20`, purpose: 'liquidations' }
  ];
}

function numberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstObject(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) {
    const row = payload[0];
    return row && typeof row === 'object' ? row as Record<string, unknown> : null;
  }
  return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
}

export class FuturesLiveCollector {
  private readonly config: FuturesLiveConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly socketFactory: (url: string) => SocketLike;
  private timer: NodeJS.Timeout | null = null;
  private socket: SocketLike | null = null;
  private socketOpen = false;
  private running = false;
  private readonly seen = new Set<string>();
  private readonly tradesSeen: Record<string, number> = {};
  private readonly flow = new Map<string, { hour: number; flow: TradeFlow; lastId: number }>();
  private readonly books = new Map<string, TopOfBook>();
  private liquidationsSeen = 0;
  private liquidations = 'ainda não consultado';
  private liquidationRestDisabled = false;
  private startedAt: string | null = null;
  private lastCycleAt: string | null = null;
  private lastOkAt: string | null = null;
  private websocket = 'desligado';
  private readonly errors: string[] = [];

  constructor(
    config: FuturesLiveConfig = readFuturesLiveConfig(),
    deps: { fetchImpl?: typeof fetch; socketFactory?: (url: string) => SocketLike } = {}
  ) {
    this.config = config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.socketFactory = deps.socketFactory ?? (url => new WebSocket(url) as unknown as SocketLike);
  }

  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.startedAt = new Date().toISOString();
    this.openSocket();
    void this.cycle();
    this.timer = setInterval(() => { void this.cycle(); }, this.config.refreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.flushFlows();
    this.socketOpen = false;
    this.socket?.close();
    this.socket = null;
  }

  status(): FuturesLiveStatus {
    return {
      enabled: this.config.enabled,
      startedAt: this.startedAt,
      lastCycleAt: this.lastCycleAt,
      lastOkAt: this.lastOkAt,
      symbols: this.config.symbols,
      tradesSeen: { ...this.tradesSeen },
      liquidationsSeen: this.liquidationsSeen,
      liquidations: this.liquidations,
      restBase: this.config.restBase,
      websocket: this.websocket,
      errors: this.errors.slice(-8)
    };
  }

  async cycle(): Promise<void> {
    if (this.running || !this.config.enabled) return;
    this.running = true;
    this.lastCycleAt = new Date().toISOString();
    try {
      for (const symbol of this.config.symbols) {
        await this.pollSymbol(symbol);
      }
    } catch (error) {
      this.noteError(error instanceof Error ? error.message : String(error));
    } finally {
      this.running = false;
    }
  }

  private openSocket(): void {
    if (!this.config.wsBase || this.config.symbols.length === 0) {
      this.websocket = 'sem endereço';
      return;
    }
    const streams = this.config.symbols.flatMap(symbol => {
      const lower = symbol.toLowerCase();
      return [`${lower}@aggTrade`, `${lower}@forceOrder`];
    }).join('/');
    const url = `${this.config.wsBase.replace(/\/ws$/, '')}/stream?streams=${streams}`;
    try {
      const socket = this.socketFactory(url);
      this.socket = socket;
      this.websocket = 'conectando';
      socket.on('open', () => {
        this.socketOpen = true;
        this.websocket = 'conectado';
      });
      socket.on('close', () => {
        this.socketOpen = false;
        this.websocket = 'fechado';
      });
      socket.on('error', () => {
        this.socketOpen = false;
        this.websocket = 'erro';
        this.noteError('websocket de futuros público sem conexão');
      });
      socket.on('message', data => {
        this.onSocketMessage(typeof data === 'string' ? data : String(data));
      });
    } catch (error) {
      this.websocket = 'erro';
      this.noteError(error instanceof Error ? error.message : String(error));
    }
  }

  private onSocketMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const envelope = parsed && typeof parsed === 'object' ? parsed as { data?: unknown; stream?: string } : null;
    const data = envelope?.data ?? parsed;
    const stream = envelope?.stream ?? '';
    if (stream.endsWith('@forceOrder') || (data && typeof data === 'object' && (data as { e?: string }).e === 'forceOrder')) {
      const order = parseForceOrder(data);
      if (order) this.rememberLiquidation(order);
      return;
    }
    const trades = parseAggTradeRest(Array.isArray(data) ? data : [data]);
    for (const trade of trades) {
      const symbol = stream.split('@')[0]?.toUpperCase();
      if (symbol) this.rememberTrade(symbol, trade);
    }
  }

  private async pollSymbol(symbol: string): Promise<void> {
    const directory = liveSymbolDir(this.config.root, symbol);
    const funding = await this.getJson(symbol, 'funding');
    const fundingRow = firstObject(funding);
    if (fundingRow) {
      const time = numberOrNull(fundingRow.fundingTime);
      const rate = numberOrNull(fundingRow.fundingRate);
      if (time !== null && rate !== null) {
        this.once(directory, 'funding.jsonl', time, { time, rate, intervalHours: null, symbol });
      }
    }
    const interest = await this.getJson(symbol, 'open-interest');
    const interestRow = firstObject(interest);
    const hist = firstObject(await this.getJson(symbol, 'open-interest-hist'));
    const interestTime = numberOrNull(interestRow?.time) ?? numberOrNull(hist?.timestamp);
    const contracts = numberOrNull(interestRow?.openInterest) ?? numberOrNull(hist?.sumOpenInterest);
    if (interestTime !== null && contracts !== null) {
      this.once(directory, 'open-interest.jsonl', interestTime, {
        time: interestTime,
        openInterest: contracts,
        openInterestValue: numberOrNull(hist?.sumOpenInterestValue),
        symbol
      });
    }
    const ratio = firstObject(await this.getJson(symbol, 'long-short'));
    const taker = firstObject(await this.getJson(symbol, 'taker'));
    const ratioTime = numberOrNull(ratio?.timestamp);
    if (ratio && ratioTime !== null) {
      this.once(directory, 'ratios.jsonl', ratioTime, {
        time: ratioTime,
        longShortRatio: numberOrNull(ratio.longShortRatio),
        takerLongShortRatio: numberOrNull(taker?.buySellRatio),
        symbol
      });
    }
    await this.pollAggTrades(symbol);
    await this.pollBook(symbol, directory);
    if (!this.liquidationRestDisabled) await this.pollLiquidations(symbol);
  }

  private async pollAggTrades(symbol: string): Promise<void> {
    const state = this.flow.get(symbol);
    let fromId = state ? state.lastId + 1 : undefined;
    for (let page = 0; page < 5; page++) {
      const payload = await this.getJson(symbol, 'aggTrades', fromId);
      const trades = parseAggTradeRest(payload);
      if (trades.length === 0) return;
      for (const trade of trades) this.rememberTrade(symbol, trade);
      fromId = trades[trades.length - 1].id + 1;
      if (trades.length < 1000) return;
    }
  }

  private async pollBook(symbol: string, directory: string): Promise<void> {
    const payload = await this.getJson(symbol, 'book');
    const book = payload && typeof payload === 'object' ? payload as { bids?: unknown; asks?: unknown } : null;
    const bid = Array.isArray(book?.bids) ? book.bids[0] : null;
    const ask = Array.isArray(book?.asks) ? book.asks[0] : null;
    if (!Array.isArray(bid) || !Array.isArray(ask)) return;
    const next: TopOfBook = {
      bidPrice: Number(bid[0]),
      bidQty: Number(bid[1]),
      askPrice: Number(ask[0]),
      askQty: Number(ask[1])
    };
    if (![next.bidPrice, next.bidQty, next.askPrice, next.askQty].every(value => Number.isFinite(value) && value >= 0)) return;
    const previous = this.books.get(symbol);
    this.books.set(symbol, next);
    const total = next.bidQty + next.askQty;
    this.lastOkAt = new Date().toISOString();
    appendJsonl(join(directory, 'book.jsonl'), {
      time: Date.now(),
      symbol,
      bidPrice: next.bidPrice,
      bidQty: next.bidQty,
      askPrice: next.askPrice,
      askQty: next.askQty,
      topImbalance: total > 0 ? (next.bidQty - next.askQty) / total : null,
      ofi: previous ? bookOrderFlowImbalance(previous, next) : null
    });
  }

  private async pollLiquidations(symbol: string): Promise<void> {
    const response = await this.get(symbol, 'liquidations');
    if (!response) return;
    if ([400, 401, 403, 404, 410, 451].includes(response.status)) {
      this.liquidationRestDisabled = true;
      this.liquidations = `REST público respondeu HTTP ${response.status}. O arquivo histórico também não está em data.binance.vision. Liquidações ficam só no websocket, se ele conectar.`;
      return;
    }
    if (!response.ok) {
      this.noteError(`${symbol} liquidações HTTP ${response.status}`);
      return;
    }
    const payload = await response.json() as unknown;
    const rows = Array.isArray(payload) ? payload : [];
    for (const row of rows) {
      const order = parseForceOrder(row);
      if (order) this.rememberLiquidation(order);
    }
    if (this.liquidations === 'ainda não consultado') this.liquidations = 'REST público respondeu';
  }

  private rememberTrade(symbol: string, trade: AggTrade): void {
    const hour = Math.floor(trade.time / 3_600_000) * 3_600_000;
    const current = this.flow.get(symbol);
    if (current && hour !== current.hour) this.flushSymbol(symbol, current);
    const base = this.flow.get(symbol) ?? { hour, flow: emptyFlow(), lastId: trade.id - 1 };
    if (trade.id <= base.lastId) return;
    base.flow = addAggTrade(base.flow, trade);
    base.lastId = trade.id;
    base.hour = hour;
    this.flow.set(symbol, base);
    this.tradesSeen[symbol] = (this.tradesSeen[symbol] ?? 0) + 1;
    this.lastOkAt = new Date().toISOString();
  }

  private flushFlows(): void {
    for (const [symbol, state] of this.flow) this.flushSymbol(symbol, state);
  }

  private flushSymbol(symbol: string, state: { hour: number; flow: TradeFlow; lastId: number }): void {
    appendJsonl(join(liveSymbolDir(this.config.root, symbol), 'flow-1h.jsonl'), {
      openTime: state.hour,
      symbol,
      ...state.flow
    });
    this.flow.set(symbol, { hour: state.hour, flow: emptyFlow(), lastId: state.lastId });
  }

  private rememberLiquidation(order: ForceOrder): void {
    const key = `${order.symbol}:${order.time}:${order.side}:${order.quantity}:${order.price}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.liquidationsSeen += 1;
    appendJsonl(join(liveSymbolDir(this.config.root, order.symbol), 'liquidations.jsonl'), order);
    this.liquidations = 'eventos gravados a partir do feed público';
    this.lastOkAt = new Date().toISOString();
  }

  private once(directory: string, file: string, time: number, row: object): void {
    const key = `${directory}/${file}:${time}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    appendJsonl(join(directory, file), row);
    this.lastOkAt = new Date().toISOString();
  }

  private async getJson(symbol: string, purpose: string, fromTradeId?: number): Promise<unknown> {
    const response = await this.get(symbol, purpose, fromTradeId);
    if (!response) return null;
    if (!response.ok) {
      this.noteError(`${symbol} ${purpose} HTTP ${response.status}`);
      return null;
    }
    return response.json();
  }

  private async get(symbol: string, purpose: string, fromTradeId?: number): Promise<Response | null> {
    const path = publicFuturesPaths(symbol, fromTradeId).find(item => item.purpose === purpose)?.path;
    if (!path) return null;
    const url = `${this.config.restBase}${path}`;
    if (/apiKey|signature|secret/i.test(url)) throw new Error('pedido de futuros não pode levar credencial');
    try {
      return await this.fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
    } catch (error) {
      this.noteError(`${symbol} ${purpose}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  private noteError(message: string): void {
    if (this.errors[this.errors.length - 1] === message) return;
    if (this.errors.length === 0) console.error(`[futuros] ${message}`);
    this.errors.push(message);
    if (this.errors.length > 20) this.errors.shift();
  }
}
