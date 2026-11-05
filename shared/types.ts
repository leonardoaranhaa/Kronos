/**
 * Legacy candle shape retained for the existing indicator engine.
 */
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type CandleSource = 'historical' | 'websocket' | 'replay';

/** Canonical OHLCV record. Timestamps are Unix milliseconds. */
export interface CanonicalCandle {
  venue: string;
  symbol: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Binance quote-asset volume; maps to Kronos' optional amount feature. */
  quoteVolume?: number;
  source: CandleSource;
  ingestedAt: number;
}

export interface CandleValidationResult {
  valid: boolean;
  errors: string[];
}

export interface CandleSeriesQuality {
  valid: boolean;
  errors: string[];
  duplicateOpenTimes: number[];
  missingIntervals: number[];
  receivedCount: number;
  acceptedCount: number;
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
  candle: CanonicalCandle;
  indicators: TechnicalIndicators;
}
