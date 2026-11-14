import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { CanonicalCandle } from '../shared/types';

export interface KronosReady {
  status: 'READY';
  device: string;
  modelId: string;
  tokenizerId: string;
  upstreamCommit: string;
}

export interface KronosInferenceRequest {
  requestId: string;
  timestamp: number;
  interval: string;
  horizon: number;
  candles: CanonicalCandle[];
  sampleCount?: number;
}

export function toWorkerCandles(candles: readonly CanonicalCandle[]) {
  return candles.map(item => ({
    timestamp: item.openTime,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    volume: item.volume,
    quoteVolume: item.quoteVolume
  }));
}

/** Line-delimited JSON client for server/kronos_worker.py. No synthetic fallback. */
export class KronosProcess extends EventEmitter {
  private child: ChildProcess | null = null;
  private buffer = '';
  private settled = false;
  private readonly readyPromise: Promise<KronosReady>;
  private resolveReady!: (value: KronosReady) => void;
  private rejectReady!: (error: Error) => void;

  constructor(private readonly pythonCommand = process.env.KRONOS_PYTHON_PATH || 'python3') {
    super();
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
  }

  start(): Promise<KronosReady> {
    this.child = spawn(this.pythonCommand, ['./server/kronos_worker.py'], {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child.stdout?.on('data', (data: Buffer) => this.consume(data.toString()));
    this.child.stderr?.on('data', (data: Buffer) => {
      console.error(`[Kronos Python]: ${data.toString()}`);
    });
    this.child.on('error', error => {
      this.fail(error);
      this.emit('model-status', { status: 'error', error: error.message });
    });
    this.child.on('exit', code => {
      this.fail(new Error(`Kronos worker exited (${code ?? 'null'})`));
      this.emit('model-status', { status: code === 0 ? 'stopped' : 'error', exitCode: code });
    });
    return this.readyPromise;
  }

  submit(request: KronosInferenceRequest): boolean {
    if (!this.child?.stdin?.writable) return false;
    const payload = {
      type: 'INFER',
      requestId: request.requestId,
      timestamp: request.timestamp,
      interval: request.interval,
      horizon: request.horizon,
      sampleCount: request.sampleCount ?? 1,
      candles: toWorkerCandles(request.candles)
    };
    return this.child.stdin.write(JSON.stringify(payload) + '\n');
  }

  infer(request: KronosInferenceRequest): Promise<{ predictions: number[]; [key: string]: unknown }> {
    return new Promise((resolve, reject) => {
      const onPrediction = (message: { requestId?: string; predictions?: number[] }) => {
        if (String(message.requestId) !== request.requestId) return;
        cleanup();
        resolve(message as { predictions: number[] });
      };
      const onError = (message: { requestId?: string; error?: string; message?: string }) => {
        if (message.requestId && String(message.requestId) !== request.requestId) return;
        cleanup();
        reject(new Error(message.error || message.message || 'Kronos inference failed'));
      };
      const cleanup = () => {
        this.off('prediction', onPrediction);
        this.off('model-error', onError);
      };
      this.on('prediction', onPrediction);
      this.on('model-error', onError);
      if (!this.submit(request)) {
        cleanup();
        reject(new Error('Kronos worker input buffer is full'));
      }
    });
  }

  stop(): void {
    this.child?.kill();
  }

  private fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectReady(error);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handle(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handle(line: string): void {
    let parsed: { type?: string; status?: string; error?: string };
    try {
      parsed = JSON.parse(line) as { type?: string; status?: string; error?: string };
    } catch {
      this.emit('model-error', { message: 'Invalid JSON message from Kronos worker' });
      return;
    }
    if (parsed.type === 'STATUS') {
      if (parsed.status === 'READY') {
        this.settled = true;
        this.resolveReady(parsed as KronosReady);
      } else {
        this.fail(new Error(parsed.error || 'Kronos worker failed to start'));
      }
      this.emit('model-status', parsed);
      return;
    }
    if (parsed.type === 'PREDICTION_RESULT') {
      this.emit('prediction', parsed);
      return;
    }
    if (parsed.type === 'ERROR') this.emit('model-error', parsed);
  }
}
