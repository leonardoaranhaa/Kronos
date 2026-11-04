import { Candle } from '../shared/types';
import EventEmitter from 'events';

export class MarketFeed extends EventEmitter {
  private mode: 'replay' | 'binance';
  private timer: NodeJS.Timeout | null = null;
  private currentPrice = 65000.0;

  constructor(mode: 'replay' | 'binance' = 'replay') {
    super();
    this.mode = mode;
  }

  public start() {
    if (this.mode === 'replay') {
      this.timer = setInterval(() => {
        const change = (Math.random() - 0.49) * 45;
        this.currentPrice = parseFloat((this.currentPrice + change).toFixed(2));

        const candle: Candle = {
          timestamp: Date.now(),
          open: parseFloat((this.currentPrice - change * 0.5).toFixed(2)),
          high: parseFloat((this.currentPrice + Math.random() * 15).toFixed(2)),
          low: parseFloat((this.currentPrice - Math.random() * 15).toFixed(2)),
          close: this.currentPrice,
          volume: parseFloat((Math.random() * 2.5 + 0.5).toFixed(4))
        };

        this.emit('candle', candle);
      }, 1000);
    }
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
