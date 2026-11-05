import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { CanonicalCandle } from '../shared/types';
import { validateCanonicalCandle } from './candle-validation';

type FeedMode = 'replay' | 'binance';

type BinanceKlineMessage = {
  e?: string;
  s?: string;
  k?: {
    t: number;
    T: number;
    s: string;
    i: string;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
    q?: string;
    x: boolean;
  };
};

export function parseBinanceKline(
  payload: unknown,
  ingestedAt = Date.now()
): CanonicalCandle | null {
  const message = payload as BinanceKlineMessage;
  const kline = message?.k;
  if (message?.e !== 'kline' || !kline || kline.x !== true) return null;

  return {
    venue: 'binance',
    symbol: String(kline.s || message.s || '').toUpperCase(),
    interval: String(kline.i || ''),
    openTime: Number(kline.t),
    closeTime: Number(kline.T),
    open: Number(kline.o),
    high: Number(kline.h),
    low: Number(kline.l),
    close: Number(kline.c),
    volume: Number(kline.v),
    quoteVolume: kline.q === undefined ? undefined : Number(kline.q),
    source: 'websocket',
    ingestedAt
  };
}

export class MarketFeed extends EventEmitter {
  private readonly mode: FeedMode;
  private readonly symbol: string;
  private readonly interval: string;
  private readonly wsBaseUrl: string;
  private socket: WebSocket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = true;
  private status = 'stopped';
  private currentPrice = 65000;

  constructor(mode: FeedMode = 'binance') {
    super();
    this.mode = mode;
    this.symbol = (process.env.SYMBOL || 'BTCUSDT').toUpperCase();
    this.interval = process.env.TIMEFRAME || '5m';
    this.wsBaseUrl = (process.env.BINANCE_WS_BASE_URL || 'wss://data-stream.binance.vision/ws').replace(/\/$/, '');
  }

  public getStatus(): string {
    return this.status;
  }

  public start(): void {
    this.stopped = false;
    if (this.mode === 'replay') {
      this.status = 'replay';
      this.emit('status', { status: this.status, source: 'synthetic' });
      this.timer = setInterval(() => this.emitReplayCandle(), 1000);
      return;
    }
    this.connectBinance();
  }

  private emitReplayCandle(): void {
    const change = (Math.random() - 0.49) * 45;
    const open = this.currentPrice;
    this.currentPrice = Math.max(1, this.currentPrice + change);
    const close = this.currentPrice;
    const candle: CanonicalCandle = {
      venue: 'synthetic',
      symbol: this.symbol,
      interval: '1s',
      openTime: Math.floor(Date.now() / 1000) * 1000,
      closeTime: Math.floor(Date.now() / 1000) * 1000 + 999,
      open,
      high: Math.max(open, close) + Math.random() * 15,
      low: Math.max(0.01, Math.min(open, close) - Math.random() * 15),
      close,
      volume: Math.random() * 2.5 + 0.5,
      source: 'replay',
      ingestedAt: Date.now()
    };
    this.emit('candle', candle);
  }

  private connectBinance(): void {
    if (this.stopped) return;
    this.status = 'connecting';
    this.emit('status', { status: this.status, source: 'binance' });
    const stream = `${this.symbol.toLowerCase()}@kline_${this.interval}`;
    this.socket = new WebSocket(`${this.wsBaseUrl}/${stream}`);

    this.socket.on('open', () => {
      this.reconnectAttempt = 0;
      this.status = 'connected';
      this.emit('status', { status: this.status, source: 'binance', symbol: this.symbol, interval: this.interval });
    });

    this.socket.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        const candle = parseBinanceKline(parsed);
        if (!candle) return;
        const validation = validateCanonicalCandle(candle);
        if (!validation.valid) {
          this.emit('feed-error', { message: 'Rejected invalid Binance candle', errors: validation.errors });
          return;
        }
        this.emit('candle', candle);
      } catch (error) {
        this.emit('feed-error', { message: 'Could not parse Binance stream message', error: String(error) });
      }
    });

    this.socket.on('error', (error) => {
      this.emit('feed-error', { message: 'Binance WebSocket error', error: error.message });
    });

    this.socket.on('close', () => {
      this.socket = null;
      if (this.stopped) return;
      this.status = 'reconnecting';
      this.emit('status', { status: this.status, source: 'binance' });
      const delay = Math.min(30_000, 1_000 * (2 ** this.reconnectAttempt));
      this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5);
      this.reconnectTimer = setTimeout(() => this.connectBinance(), delay);
    });
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.timer = null;
    this.reconnectTimer = null;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.removeAllListeners('close');
      socket.close();
    }
    this.status = 'stopped';
    this.emit('status', { status: this.status });
  }
}
