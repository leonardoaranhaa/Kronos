import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { CanonicalCandle } from '../shared/types';
import { auditCandleSeries, validateCanonicalCandle } from './candle-validation';

type FeedMode = 'replay' | 'binance';
type BinanceKlineMessage = {
  e?: string; s?: string;
  k?: { t: number; T: number; s: string; i: string; o: string; h: string; l: string; c: string; v: string; q?: string; x: boolean };
};

export function parseBinanceKline(payload: unknown, ingestedAt = Date.now()): CanonicalCandle | null {
  const message = payload as BinanceKlineMessage;
  const kline = message?.k;
  if (message?.e !== 'kline' || !kline || kline.x !== true) return null;
  return {
    venue: 'binance', symbol: String(kline.s || message.s || '').toUpperCase(),
    interval: String(kline.i || ''), openTime: Number(kline.t), closeTime: Number(kline.T),
    open: Number(kline.o), high: Number(kline.h), low: Number(kline.l), close: Number(kline.c),
    volume: Number(kline.v), quoteVolume: kline.q === undefined ? undefined : Number(kline.q),
    source: 'websocket', ingestedAt
  };
}

/** Converts a validated historical snapshot into a stable, ordered replay sequence. */
export function createReplaySequence(candles: CanonicalCandle[]): CanonicalCandle[] {
  const quality = auditCandleSeries(candles);
  if (!quality.valid) throw new Error(`Cannot replay an invalid historical series: ${quality.errors.join('; ')}`);
  if (candles.some(candle => candle.venue !== 'binance' || candle.source !== 'historical')) {
    throw new Error('Replay accepts only historical Binance candles');
  }
  return [...candles].sort((a, b) => a.openTime - b.openTime)
    .map(candle => ({ ...candle, source: 'replay' as const }));
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
  private replayCandles: CanonicalCandle[] = [];
  private replayIndex = 0;

  constructor(mode: FeedMode = 'binance') {
    super();
    this.mode = mode;
    this.symbol = (process.env.SYMBOL || 'BTCUSDT').toUpperCase();
    this.interval = process.env.TIMEFRAME || '5m';
    this.wsBaseUrl = (process.env.BINANCE_WS_BASE_URL || 'wss://data-stream.binance.vision/ws').replace(/\/$/, '');
  }

  public setReplayCandles(candles: CanonicalCandle[]): void {
    if (this.mode !== 'replay') throw new Error('Historical replay data can only be configured in replay mode');
    if (candles.some(candle => candle.symbol !== this.symbol || candle.interval !== this.interval)) {
      throw new Error('Replay snapshot symbol or timeframe does not match feed configuration');
    }
    this.replayCandles = createReplaySequence(candles);
    this.replayIndex = 0;
  }

  public getStatus(): string { return this.status; }

  public start(): void {
    this.stopped = false;
    if (this.mode === 'replay') {
      if (this.replayCandles.length === 0) {
        this.status = 'error';
        this.emit('status', { status: this.status, source: 'historical-replay' });
        this.emit('feed-error', { message: 'Historical replay requires a validated HISTORICAL_DATA_PATH; synthetic random replay is disabled' });
        return;
      }
      this.status = 'replay';
      this.emit('status', { status: this.status, source: 'historical-replay', candleCount: this.replayCandles.length });
      this.timer = setInterval(() => this.emitReplayCandle(), 1000);
      return;
    }
    this.connectBinance();
  }

  private emitReplayCandle(): void {
    if (this.replayIndex >= this.replayCandles.length) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.status = 'replay-complete';
      this.emit('status', { status: this.status, source: 'historical-replay', replayedCount: this.replayIndex });
      return;
    }
    this.emit('candle', this.replayCandles[this.replayIndex]);
    this.replayIndex += 1;
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
    this.socket.on('message', raw => {
      try {
        const candle = parseBinanceKline(JSON.parse(raw.toString()));
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
    this.socket.on('error', error => this.emit('feed-error', { message: 'Binance WebSocket error', error: error.message }));
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
