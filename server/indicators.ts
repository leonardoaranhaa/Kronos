import { Candle, TechnicalIndicators } from '../shared/types';

/** Seeded SMA then standard EMA. Returns null until `period` closes exist. */
export function calculateEMA(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(4));
}

/** Wilder RSI. Returns null until there are `period` price changes. */
export function calculateRSI(data: number[], period = 14): number | null {
  if (data.length <= period) return null;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    const gain = change >= 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
}

/**
 * Simple average of the last `period` true ranges, not Wilder smoothing.
 * Returns null until there are enough ranges.
 */
export function calculateATR(candles: readonly { high: number; low: number; close: number }[], period = 14): number | null {
  if (candles.length <= period) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    trs.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  const recent = trs.slice(-period);
  const atr = recent.reduce((sum, value) => sum + value, 0) / period;
  return parseFloat(atr.toFixed(4));
}

export function computeIndicators(candles: readonly Candle[]): TechnicalIndicators {
  const closes = candles.map(candle => candle.close);
  return {
    ema9: calculateEMA(closes, 9),
    ema20: calculateEMA(closes, 20),
    ema50: calculateEMA(closes, 50),
    rsi14: calculateRSI(closes, 14),
    atr14: calculateATR(candles, 14)
  };
}

/** Incremental wrapper around the pure indicator functions. */
export class IndicatorEngine {
  private candles: Candle[] = [];
  private maxHistory = 300;

  public updateCandle(candle: Candle): TechnicalIndicators {
    this.candles.push(candle);
    if (this.candles.length > this.maxHistory) this.candles.shift();
    return computeIndicators(this.candles);
  }
}
