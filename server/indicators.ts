import { Candle, TechnicalIndicators, AggressiveSignal } from '../shared/types';

export class IndicatorEngine {
  private candles: Candle[] = [];
  private maxHistory = 300;

  public updateCandle(candle: Candle): TechnicalIndicators {
    this.candles.push(candle);
    if (this.candles.length > this.maxHistory) {
      this.candles.shift();
    }

    const closes = this.candles.map(c => c.close);
    const ema9 = this.calculateEMA(closes, 9);
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const rsi14 = this.calculateRSI(closes, 14);
    const atr14 = this.calculateATR(14);

    return { ema9, ema20, ema50, rsi14, atr14 };
  }

  private calculateEMA(data: number[], period: number): number | null {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    let ema = data.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

    for (let i = period; i < data.length; i++) {
      ema = data[i] * k + ema * (1 - k);
    }
    return parseFloat(ema.toFixed(4));
  }

  private calculateRSI(data: number[], period: number = 14): number | null {
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
    const rsi = 100 - (100 / (1 + rs));
    return parseFloat(rsi.toFixed(2));
  }

  private calculateATR(period: number = 14): number | null {
    if (this.candles.length <= period) return null;
    const trs: number[] = [];
    for (let i = 1; i < this.candles.length; i++) {
      const cur = this.candles[i];
      const prev = this.candles[i - 1];
      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      );
      trs.push(tr);
    }
    const recent = trs.slice(-period);
    const atr = recent.reduce((a, b) => a + b, 0) / period;
    return parseFloat(atr.toFixed(4));
  }

  public generateAggressiveSignal(currentPrice: number, isSpoofingDetected: boolean = false, vpin: number = 0.3): AggressiveSignal {
    const closes = this.candles.map(c => c.close);
    const indicators: TechnicalIndicators = {
      ema9: this.calculateEMA(closes, 9),
      ema20: this.calculateEMA(closes, 20),
      ema50: this.calculateEMA(closes, 50),
      rsi14: this.calculateRSI(closes, 14),
      atr14: this.calculateATR(14)
    };

    const { ema9, ema20, rsi14, atr14 } = indicators;
    const effectiveATR = atr14 || (currentPrice * 0.003);

    const stopDistance = 1.5 * effectiveATR;
    const targetDistance = 2.5 * effectiveATR;

    if (vpin > 0.75) {
      return {
        action: 'HOLD',
        confidence: 0.10,
        targetPrice: currentPrice,
        stopLoss: currentPrice,
        kellyLot: 0,
        isFadingTrade: false,
        reason: `Veto por Toxicidade Alta (VPIN ${vpin.toFixed(2)} > 0.75)`,
        indicators
      };
    }

    if (isSpoofingDetected) {
      const isBuyFade = (ema9 || currentPrice) >= (ema20 || currentPrice);
      const action = isBuyFade ? 'BUY' : 'SELL';
      const confidence = 0.94;

      const p = confidence;
      const r = targetDistance / stopDistance;
      const kellyFraction = Math.max(0.02, Math.min(0.15, 0.3 * (p - (1 - p) / r)));
      const kellyLot = parseFloat((kellyFraction * 3.5).toFixed(2));

      return {
        action,
        confidence,
        targetPrice: parseFloat((currentPrice + (isBuyFade ? targetDistance : -targetDistance)).toFixed(2)),
        stopLoss: parseFloat((currentPrice + (isBuyFade ? -stopDistance : stopDistance)).toFixed(2)),
        kellyLot,
        isFadingTrade: true,
        reason: `Aranha Digital: Fading de Parede Falsa Detectado | Confiança: 94%`,
        indicators
      };
    }

    if (!ema9 || !ema20 || !rsi14) {
      return {
        action: 'HOLD',
        confidence: 0,
        targetPrice: currentPrice,
        stopLoss: currentPrice,
        kellyLot: 0,
        isFadingTrade: false,
        reason: 'Aguardando histórico mínimo de candles',
        indicators
      };
    }

    if (ema9 > ema20 && rsi14 > 48 && rsi14 < 72) {
      const confidence = Math.min(0.96, parseFloat((0.65 + (rsi14 / 200)).toFixed(2)));
      const p = confidence;
      const r = targetDistance / stopDistance;
      const kellyFraction = Math.max(0.02, Math.min(0.15, 0.3 * (p - (1 - p) / r)));
      const kellyLot = parseFloat((kellyFraction * 3.5).toFixed(2));

      return {
        action: 'BUY',
        confidence,
        targetPrice: parseFloat((currentPrice + targetDistance).toFixed(2)),
        stopLoss: parseFloat((currentPrice - stopDistance).toFixed(2)),
        kellyLot,
        isFadingTrade: false,
        reason: `Tendência de alta | EMA9 > EMA20 | RSI: ${rsi14} | ATR: ${effectiveATR.toFixed(2)}`,
        indicators
      };
    }

    if (ema9 < ema20 && rsi14 < 52 && rsi14 > 28) {
      const confidence = Math.min(0.96, parseFloat((0.65 + ((100 - rsi14) / 200)).toFixed(2)));
      const p = confidence;
      const r = targetDistance / stopDistance;
      const kellyFraction = Math.max(0.02, Math.min(0.15, 0.3 * (p - (1 - p) / r)));
      const kellyLot = parseFloat((kellyFraction * 3.5).toFixed(2));

      return {
        action: 'SELL',
        confidence,
        targetPrice: parseFloat((currentPrice - targetDistance).toFixed(2)),
        stopLoss: parseFloat((currentPrice + stopDistance).toFixed(2)),
        kellyLot,
        isFadingTrade: false,
        reason: `Pressão vendedora | EMA9 < EMA20 | RSI: ${rsi14} | ATR: ${effectiveATR.toFixed(2)}`,
        indicators
      };
    }

    return {
      action: 'HOLD',
      confidence: 0.35,
      targetPrice: currentPrice,
      stopLoss: currentPrice,
      kellyLot: 0,
      isFadingTrade: false,
      reason: 'Mercado em consolidação lateral',
      indicators
    };
  }
}
