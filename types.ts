export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  atr14: number | null;
}

export interface AggressiveSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  targetPrice: number;
  stopLoss: number;
  kellyLot: number;
  isFadingTrade: boolean;
  reason: string;
  indicators: TechnicalIndicators;
}

export interface KronosPrediction {
  timestamp: number;
  predictedCloses: number[];
}

export interface MarketTickPayload {
  candle: Candle;
  indicators: TechnicalIndicators;
  signal: AggressiveSignal;
  vpin: number;
  ofi: number;
}
