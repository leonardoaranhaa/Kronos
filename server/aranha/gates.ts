import type { SignalAction } from '../signals';
import type { AnalogSummary, Bias, PatternHit } from './types';

/**
 * Round gates written down before the backtest was run.
 * They were not searched or adjusted to improve a result.
 */
export const ARANHA_GATES = Object.freeze({
  window: 48,
  horizonBars: 12,
  neighbors: 8,
  separation: 12,
  minAnalogs: 8,
  entryMedianBps: 10,
  entryHitRate: 0.55,
  disagreeHitRate: 0.4,
  sentimentDisagree: 0.35,
  decisionStride: 12,
  trendLookback: 20,
  trendAtrFactor: 0.25
});

export function analogAction(summary: AnalogSummary): SignalAction {
  if (summary.count < ARANHA_GATES.minAnalogs) return 'HOLD';
  const median = summary.medianForwardReturnBps;
  if (median === null || summary.hitRateUp === null || summary.hitRateDown === null) return 'HOLD';
  if (median >= ARANHA_GATES.entryMedianBps && summary.hitRateUp >= ARANHA_GATES.entryHitRate) return 'BUY';
  if (median <= -ARANHA_GATES.entryMedianBps && summary.hitRateDown >= ARANHA_GATES.entryHitRate) return 'SELL';
  return 'HOLD';
}

export function analogBias(summary: AnalogSummary): Bias {
  const action = analogAction(summary);
  if (action === 'BUY') return 'alta';
  if (action === 'SELL') return 'baixa';
  return 'neutro';
}

/** Strong analog disagreement. Sentiment is a separate check. */
export function analogsDisagree(summary: AnalogSummary, action: 'BUY' | 'SELL'): boolean {
  if (summary.count < ARANHA_GATES.minAnalogs) return false;
  const median = summary.medianForwardReturnBps;
  if (median === null) return false;
  if (action === 'BUY') {
    return summary.hitRateUp !== null
      && summary.hitRateUp <= ARANHA_GATES.disagreeHitRate
      && median < 0;
  }
  return summary.hitRateDown !== null
    && summary.hitRateDown <= ARANHA_GATES.disagreeHitRate
    && median > 0;
}

export function sentimentDisagrees(sentiment: number | null, action: 'BUY' | 'SELL'): boolean {
  if (sentiment === null || !Number.isFinite(sentiment)) return false;
  if (action === 'BUY') return sentiment <= -ARANHA_GATES.sentimentDisagree;
  return sentiment >= ARANHA_GATES.sentimentDisagree;
}

/**
 * Fixed structure rule: follow the 1h regime unless the 5m chart just broke
 * the other way. Hit rates are reported beside the pattern; they are not used
 * to pick the pattern after the fact.
 */
export function structureAction(patterns: readonly PatternHit[]): SignalAction {
  const regime = patterns.find(pattern => pattern.timeframe === '1h' && pattern.id.startsWith('regime-') && pattern.activeNow);
  if (!regime || regime.id === 'regime-range') return 'HOLD';
  const breakdown = patterns.some(pattern => pattern.timeframe === '5m' && pattern.id === 'breakout-down' && pattern.activeNow);
  const breakup = patterns.some(pattern => pattern.timeframe === '5m' && pattern.id === 'breakout-up' && pattern.activeNow);
  if (regime.id === 'regime-up' && !breakdown) return 'BUY';
  if (regime.id === 'regime-down' && !breakup) return 'SELL';
  return 'HOLD';
}
