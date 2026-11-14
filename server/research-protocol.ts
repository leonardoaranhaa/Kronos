import { CostConfig } from './trading-math';

/**
 * Frozen on 2026-11-12 before any forecast in this study was scored.
 * Do not move the cut, the grid, or the promotion rule after seeing results.
 * Strides exist to keep CPU time bounded. They were not chosen by return.
 */
export const STUDY_START_ISO = '2025-11-12T00:00:00.000Z';
export const OOS_START_ISO = '2026-08-12T00:00:00.000Z';
export const STUDY_START_MS = Date.parse(STUDY_START_ISO);
export const OOS_START_MS = Date.parse(OOS_START_ISO);

export const RESEARCH_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;

export interface SeriesSpec {
  interval: '5m' | '1h' | '4h';
  horizon: number;
  stride: number;
  context: number;
  intervalMs: number;
}

export const SERIES_SPECS: readonly SeriesSpec[] = [
  { interval: '5m', horizon: 12, stride: 144, context: 256, intervalMs: 300_000 },
  { interval: '1h', horizon: 6, stride: 12, context: 256, intervalMs: 3_600_000 },
  { interval: '4h', horizon: 6, stride: 2, context: 256, intervalMs: 14_400_000 }
];

export const SAMPLE_COUNT = 4;
export const PRIMARY_SERIES = { symbol: 'BTCUSDT', interval: '1h' as const };
export const MIN_IN_SAMPLE_TRADES = 20;
export const MIN_OOS_TRADES = 15;
export const PRIMARY_ALPHA = 0.05;
export const STARTING_EQUITY = 10_000;

export const RESEARCH_COSTS: CostConfig = {
  feeRate: 0.001,
  slippageRate: 0.0005,
  positionFraction: 1
};

export type ResearchMode = 'long_short' | 'long_only';

export interface ResearchParams {
  id: string;
  mode: ResearchMode;
  trendFilter: boolean;
  minMoveBps: number;
  atrMultiple: number;
  maxDispersionBps: number;
}

export const CURRENT_RULE: ResearchParams = {
  id: 'regra-atual',
  mode: 'long_short',
  trendFilter: true,
  minMoveBps: 30,
  atrMultiple: 0,
  maxDispersionBps: 10_000
};

export const CURRENT_RULE_LONG_ONLY: ResearchParams = {
  ...CURRENT_RULE,
  id: 'regra-atual-so-compra',
  mode: 'long_only'
};

export const TUNE_GRID = {
  modes: ['long_short', 'long_only'] as const,
  trendFilter: [true, false],
  minMoveBps: [30, 50, 80],
  atrMultiple: [0, 0.75, 1.5],
  maxDispersionBps: [25, 60, 10_000]
};

export function tuneGridSize(): number {
  return TUNE_GRID.modes.length
    * TUNE_GRID.trendFilter.length
    * TUNE_GRID.minMoveBps.length
    * TUNE_GRID.atrMultiple.length
    * TUNE_GRID.maxDispersionBps.length;
}

export function eachTunedParams(): ResearchParams[] {
  const params: ResearchParams[] = [];
  for (const mode of TUNE_GRID.modes) {
    for (const trendFilter of TUNE_GRID.trendFilter) {
      for (const minMoveBps of TUNE_GRID.minMoveBps) {
        for (const atrMultiple of TUNE_GRID.atrMultiple) {
          for (const maxDispersionBps of TUNE_GRID.maxDispersionBps) {
            params.push({
              id: 'escolhida-na-amostra',
              mode,
              trendFilter,
              minMoveBps,
              atrMultiple,
              maxDispersionBps
            });
          }
        }
      }
    }
  }
  return params;
}

/** A decision whose outcome lands on or after the cut is not used for tuning. */
export function embargoSplit(
  decisionOpenTime: number,
  outcomeOpenTime: number,
  oosStart = OOS_START_MS
): 'in_sample' | 'out_of_sample' | 'embargo' {
  if (outcomeOpenTime < oosStart) return 'in_sample';
  if (decisionOpenTime >= oosStart) return 'out_of_sample';
  return 'embargo';
}
