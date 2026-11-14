import { EventEmitter } from 'events';
import { CanonicalCandle } from '../shared/types';
import { KronosProcess } from './kronos-process';

/** Starts the official Kronos worker and forwards one forecast at a time. */
export class KronosBridge extends EventEmitter {
  private readonly kronos = new KronosProcess();
  private workerReady = false;
  private inferenceInFlight = false;
  private status = 'starting';
  private readonly maxContext: number;
  private readonly horizon: number;
  private readonly sampleCount: number;

  constructor(options: { maxContext?: number; horizon?: number; sampleCount?: number } = {}) {
    super();
    this.maxContext = Math.min(512, Math.max(32, options.maxContext ?? Number(process.env.KRONOS_MAX_CONTEXT || 400)));
    this.horizon = Math.max(1, Math.min(64, options.horizon ?? Number(process.env.KRONOS_PREDICTION_HORIZON || 5)));
    const fromEnv = Number(process.env.KRONOS_SAMPLE_COUNT || 1);
    this.sampleCount = Math.max(1, Math.min(8, options.sampleCount ?? (Number.isFinite(fromEnv) ? fromEnv : 1)));
  }

  public getStatus(): string {
    return this.status;
  }

  public start(): void {
    this.kronos.on('model-status', (data: { status?: string; error?: string; exitCode?: number | null }) => {
      if (data.status === 'READY') {
        this.workerReady = true;
        this.status = 'ready';
      } else if (data.status === 'stopped') {
        this.workerReady = false;
        this.status = 'stopped';
      } else {
        this.workerReady = false;
        this.inferenceInFlight = false;
        this.status = 'error';
      }
      this.emit('model-status', data);
    });
    this.kronos.on('prediction', message => {
      this.inferenceInFlight = false;
      this.emit('prediction', message);
    });
    this.kronos.on('model-error', message => {
      this.inferenceInFlight = false;
      this.emit('model-error', message);
    });
    void this.kronos.start().catch(() => {
      // Status and error events are emitted by the process itself.
    });
  }

  public processTick(candle: CanonicalCandle, history: CanonicalCandle[]): boolean {
    if (!this.workerReady || this.inferenceInFlight) return false;
    if (history.length < 32) return false;
    if (!history.every(item => item.venue === 'binance' && item.source !== 'replay')) return false;

    this.inferenceInFlight = true;
    const accepted = this.kronos.submit({
      requestId: String(candle.openTime),
      timestamp: candle.openTime,
      interval: candle.interval,
      horizon: this.horizon,
      sampleCount: this.sampleCount,
      candles: history.slice(-this.maxContext)
    });
    if (!accepted) {
      this.inferenceInFlight = false;
      this.emit('model-error', { message: 'Kronos worker input buffer is full' });
      return false;
    }
    return true;
  }

  public stop(): void {
    this.workerReady = false;
    this.kronos.stop();
  }
}
