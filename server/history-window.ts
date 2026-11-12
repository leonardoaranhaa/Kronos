import { CanonicalCandle } from '../shared/types';

/**
 * In-memory candle window.
 *
 * `retained` is capped for the model context. `acceptedCount` counts every
 * candle that passed the integrity checks, including ones already dropped
 * from the window, so a full buffer does not look frozen.
 */
export interface HistoryWindow {
  retained: CanonicalCandle[];
  acceptedCount: number;
  cap: number;
  latestOpenTime: number | null;
}

export interface HistoryView {
  /** Candles accepted since startup, including those evicted from the window. */
  historyCount: number;
  /** Candles currently kept for inference and the chart. */
  retainedHistoryCount: number;
  historyCap: number;
  historyCapped: boolean;
  latestOpenTime: number | null;
}

export function createHistoryWindow(cap: number): HistoryWindow {
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error('history cap must be a positive integer');
  }
  return { retained: [], acceptedCount: 0, cap, latestOpenTime: null };
}

export function acceptCandle(
  window: HistoryWindow,
  candle: CanonicalCandle
): { window: HistoryWindow; evicted: CanonicalCandle | null } {
  const retained = window.retained.slice();
  retained.push(candle);
  const evicted = retained.length > window.cap ? retained.shift() ?? null : null;
  return {
    window: {
      retained,
      acceptedCount: window.acceptedCount + 1,
      cap: window.cap,
      latestOpenTime: candle.openTime
    },
    evicted
  };
}

/** Counts every preloaded candle. Only the last `cap` rows stay in memory. */
export function preloadHistory(window: HistoryWindow, candles: readonly CanonicalCandle[]): HistoryWindow {
  let next = window;
  for (const candle of candles) next = acceptCandle(next, candle).window;
  return next;
}

export function describeHistory(window: HistoryWindow): HistoryView {
  return {
    historyCount: window.acceptedCount,
    retainedHistoryCount: window.retained.length,
    historyCap: window.cap,
    historyCapped: window.acceptedCount > window.retained.length,
    latestOpenTime: window.latestOpenTime
  };
}
