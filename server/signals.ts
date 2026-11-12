import { TechnicalIndicators } from '../shared/types';

export type SignalAction = 'BUY' | 'SELL' | 'HOLD';

export interface SignalConfig {
  /** Minimum |forecast move| in basis points before a BUY or SELL is allowed. */
  minMoveBps: number;
  /** BUY is blocked when RSI is at or above this level. */
  rsiBuyMax: number;
  /** SELL is blocked when RSI is at or below this level. */
  rsiSellMin: number;
}

export interface SignalInput {
  close: number;
  predictedCloses: number[];
  ema9: number | null;
  ema20: number | null;
  rsi14: number | null;
  atr14?: number | null;
}

/**
 * Research signal. `heuristicScore` is a bounded display score, not a
 * probability and not a win rate.
 */
export interface ResearchSignal {
  action: SignalAction;
  reason: string;
  forecastReturnBps: number | null;
  heuristicScore: number;
  indicators: TechnicalIndicators;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  minMoveBps: 30,
  rsiBuyMax: 70,
  rsiSellMin: 30
};

function indicatorsOf(input: SignalInput): TechnicalIndicators {
  return {
    ema9: input.ema9,
    ema20: input.ema20,
    ema50: null,
    rsi14: input.rsi14,
    atr14: input.atr14 ?? null
  };
}

function hold(input: SignalInput, reason: string, forecastReturnBps: number | null): ResearchSignal {
  return {
    action: 'HOLD',
    reason,
    forecastReturnBps,
    heuristicScore: 0,
    indicators: indicatorsOf(input)
  };
}

/**
 * BUY when the model's last predicted close clears the minimum move, EMA9 is
 * above EMA20, and RSI is not overbought. SELL is the mirror. Anything else
 * is HOLD. The minimum move defaults to the estimated round trip of 0.1%
 * fees and 0.05% slippage on each side (30 bps). It is a gate, not a fitted
 * parameter.
 */
export function decideSignal(input: SignalInput, config: SignalConfig = DEFAULT_SIGNAL_CONFIG): ResearchSignal {
  if (!Number.isFinite(input.close) || input.close <= 0) {
    return hold(input, 'Preço atual inválido. Nenhum sinal.', null);
  }
  if (!Array.isArray(input.predictedCloses) || input.predictedCloses.length === 0) {
    return hold(input, 'Sem previsão do modelo. Nenhum sinal.', null);
  }
  const predicted = input.predictedCloses[input.predictedCloses.length - 1];
  if (!Number.isFinite(predicted)) {
    return hold(input, 'Previsão do modelo inválida. Nenhum sinal.', null);
  }
  const rawBps = ((predicted - input.close) / input.close) * 10_000;
  const forecastReturnBps = Math.round(rawBps * 10) / 10;
  if (input.ema9 === null || input.ema20 === null) {
    return hold(input, 'EMA9 e EMA20 ainda não têm candles suficientes.', forecastReturnBps);
  }

  const score = Math.max(0, Math.min(1, Math.abs(forecastReturnBps) / (config.minMoveBps * 3 || 1)));
  const bpsText = `${forecastReturnBps >= 0 ? '+' : ''}${forecastReturnBps.toFixed(1)} bps`;

  if (forecastReturnBps >= config.minMoveBps && input.ema9 > input.ema20) {
    if (input.rsi14 !== null && input.rsi14 >= config.rsiBuyMax) {
      return hold(
        input,
        `Previsão de alta (${bpsText}), mas o RSI ${input.rsi14.toFixed(1)} está acima de ${config.rsiBuyMax}.`,
        forecastReturnBps
      );
    }
    return {
      action: 'BUY',
      reason: `Previsão de alta (${bpsText}), acima do mínimo de ${config.minMoveBps} bps, com EMA9 acima da EMA20.`,
      forecastReturnBps,
      heuristicScore: score,
      indicators: indicatorsOf(input)
    };
  }

  if (forecastReturnBps <= -config.minMoveBps && input.ema9 < input.ema20) {
    if (input.rsi14 !== null && input.rsi14 <= config.rsiSellMin) {
      return hold(
        input,
        `Previsão de baixa (${bpsText}), mas o RSI ${input.rsi14.toFixed(1)} está abaixo de ${config.rsiSellMin}.`,
        forecastReturnBps
      );
    }
    return {
      action: 'SELL',
      reason: `Previsão de baixa (${bpsText}), além do mínimo de ${config.minMoveBps} bps, com EMA9 abaixo da EMA20.`,
      forecastReturnBps,
      heuristicScore: score,
      indicators: indicatorsOf(input)
    };
  }

  if (Math.abs(forecastReturnBps) < config.minMoveBps) {
    return hold(
      input,
      `Movimento previsto (${bpsText}) não alcança o mínimo de ${config.minMoveBps} bps.`,
      forecastReturnBps
    );
  }
  return hold(
    input,
    `Movimento previsto (${bpsText}) não concorda com a tendência das médias (EMA9 ${input.ema9 > input.ema20 ? 'acima' : 'abaixo'} da EMA20).`,
    forecastReturnBps
  );
}
