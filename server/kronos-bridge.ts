import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { IndicatorEngine } from './indicators';
import { Candle, CanonicalCandle, TechnicalIndicators } from '../shared/types';

export class KronosBridge extends EventEmitter {
  private pythonProcess: ChildProcess | null = null;
  private indicatorEngine: IndicatorEngine;
  private stdoutBuffer = '';
  private workerReady = false;
  private inferenceInFlight = false;
  private status = 'starting';
  private readonly maxContext = Math.min(512, Math.max(32, Number(process.env.KRONOS_MAX_CONTEXT || 400)));
  private readonly horizon = Math.max(1, Math.min(64, Number(process.env.KRONOS_PREDICTION_HORIZON || 5)));

  constructor() {
    super();
    this.indicatorEngine = new IndicatorEngine();
  }

  public getStatus(): string {
    return this.status;
  }

  public start(): void {
    const pythonCmd = process.env.KRONOS_PYTHON_PATH || 'python3';
    this.pythonProcess = spawn(pythonCmd, ['./server/kronos_worker.py'], { env: process.env });

    this.pythonProcess.stdout?.on('data', (data: Buffer) => {
      this.stdoutBuffer += data.toString();
      let newlineIndex = this.stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        if (line) this.handleWorkerMessage(line);
        newlineIndex = this.stdoutBuffer.indexOf('\n');
      }
    });

    this.pythonProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[Kronos Python]: ${data.toString()}`);
    });

    this.pythonProcess.on('error', (error) => {
      this.workerReady = false;
      this.status = 'error';
      this.emit('model-status', { status: this.status, error: error.message });
    });

    this.pythonProcess.on('exit', (code) => {
      this.workerReady = false;
      this.inferenceInFlight = false;
      this.status = code === 0 ? 'stopped' : 'error';
      this.emit('model-status', { status: this.status, exitCode: code });
    });
  }

  private handleWorkerMessage(line: string): void {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'STATUS') {
        this.status = parsed.status === 'READY' ? 'ready' : 'error';
        this.workerReady = parsed.status === 'READY';
        this.emit('model-status', parsed);
      } else if (parsed.type === 'PREDICTION_RESULT') {
        this.inferenceInFlight = false;
        this.emit('prediction', parsed);
      } else if (parsed.type === 'ERROR') {
        this.inferenceInFlight = false;
        this.emit('model-error', parsed);
      }
    } catch {
      this.emit('model-error', { message: 'Invalid JSON message from Kronos worker' });
    }
  }

  public processTick(candle: CanonicalCandle, history: CanonicalCandle[]): TechnicalIndicators {
    const legacyCandle: Candle = {
      timestamp: candle.openTime,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    };
    const indicators = this.indicatorEngine.updateCandle(legacyCandle);

    if (!this.workerReady || this.inferenceInFlight || !this.pythonProcess?.stdin?.writable) {
      return indicators;
    }
    if (history.length < 32) return indicators;

    const payload = JSON.stringify({
      type: 'INFER',
      requestId: String(candle.openTime),
      timestamp: candle.openTime,
      interval: candle.interval,
      horizon: this.horizon,
      candles: history.slice(-this.maxContext).map(item => ({
        timestamp: item.openTime,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
        quoteVolume: item.quoteVolume
      }))
    }) + '\n';

    this.inferenceInFlight = true;
    const accepted = this.pythonProcess.stdin.write(payload);
    if (!accepted) {
      this.inferenceInFlight = false;
      this.emit('model-error', { message: 'Kronos worker input buffer is full' });
    }
    return indicators;
  }

  public stop(): void {
    this.workerReady = false;
    if (this.pythonProcess) this.pythonProcess.kill();
  }
}
