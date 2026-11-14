import { ARANHA_GATES } from './gates';

export interface AranhaConfig {
  filterEnabled: boolean;
  symbol: string;
  window: number;
  horizon: number;
  neighbors: number;
  stride: number;
  cacheDir: string;
  snapshotDir: string;
  reportPath: string;
  webEnabled: boolean;
  chartImage: boolean;
  llmMinIntervalMs: number;
  webMinRefreshMs: number;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'sim'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no', 'nao', 'não'].includes(normalized)) return false;
  throw new Error(`invalid boolean flag: ${value}`);
}

function integer(env: NodeJS.ProcessEnv, key: string, fallback: number, minimum: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${key} must be an integer >= ${minimum}`);
  return value;
}

export function readAranhaConfig(env: NodeJS.ProcessEnv = process.env): AranhaConfig {
  return {
    filterEnabled: flag(env.ARANHA_FILTER, false),
    symbol: (env.SYMBOL || 'BTCUSDT').toUpperCase(),
    window: integer(env, 'ARANHA_ANALOG_WINDOW', ARANHA_GATES.window, 8),
    horizon: integer(env, 'ARANHA_ANALOG_HORIZON', ARANHA_GATES.horizonBars, 1),
    neighbors: integer(env, 'ARANHA_ANALOG_K', ARANHA_GATES.neighbors, 1),
    stride: integer(env, 'ARANHA_STRIDE', ARANHA_GATES.decisionStride, 1),
    cacheDir: env.ARANHA_CACHE_DIR || 'data/aranha/cache',
    snapshotDir: env.ARANHA_SNAPSHOT_DIR || 'data/aranha/snapshots',
    reportPath: env.ARANHA_REPORT_PATH || 'reports/aranha-latest.json',
    webEnabled: flag(env.ARANHA_WEB, true),
    chartImage: flag(env.ARANHA_CHART_IMAGE, true),
    llmMinIntervalMs: integer(env, 'ARANHA_LLM_MIN_INTERVAL_MS', 600_000, 0),
    webMinRefreshMs: integer(env, 'ARANHA_WEB_MIN_REFRESH_MS', 600_000, 0)
  };
}
