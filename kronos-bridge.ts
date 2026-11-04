import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { IndicatorEngine } from './indicators';
import { Candle, TechnicalIndicators, AggressiveSignal } from '../shared/types';

export class KronosBridge extends EventEmitter {
  private pythonProcess: ChildProcess | null = null;
  private indicatorEngine: IndicatorEngine;

  constructor() {
    super();
    this.indicatorEngine = new IndicatorEngine();
  }

  public start(): void {
    const pythonCmd = process.env.KRONOS_PYTHON_PATH || 'python3';
    this.pythonProcess = spawn(pythonCmd, ['./server/kronos_worker.py']);

    this.pythonProcess.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'PREDICTION_RESULT') {
            this.emit('prediction', parsed);
          }
        } catch (e) {
          // Ignora mensagens fora do padrão
        }
      }
    });

    this.pythonProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[Kronos Python Error]: ${data.toString()}`);
    });
  }

  public processTick(candle: Candle, history: Candle[], isSpoofing: boolean = false, vpin: number = 0.3): { indicators: TechnicalIndicators; signal: AggressiveSignal } {
    const indicators = this.indicatorEngine.updateCandle(candle);
    const signal = this.indicatorEngine.generateAggressiveSignal(candle.close, isSpoofing, vpin);

    if (this.pythonProcess && this.pythonProcess.stdin?.writable) {
      const payload = JSON.stringify({
        type: 'INFER',
        timestamp: candle.timestamp,
        horizon: 5,
        candles: history.slice(-50)
      }) + '\n';
      
      this.pythonProcess.stdin.write(payload);
    }

    return { indicators, signal };
  }

  public stop(): void {
    if (this.pythonProcess) {
      this.pythonProcess.kill();
    }
  }
}
