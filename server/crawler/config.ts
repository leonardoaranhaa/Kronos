export interface CrawlerConfig {
  enabled: boolean;
  universeSize: number;
  kronosTop: number;
  whaleUsd: number;
  btcWhale: number;
  ethWhaleUsd: number;
  restBase: string;
  wsBase: string;
  snapshotDir: string;
  reportPath: string;
  /** Explicit symbols. Empty means "top by 24h quote volume". */
  symbols: string[];
  refreshMs: number;
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

export function readCrawlerConfig(env: NodeJS.ProcessEnv = process.env): CrawlerConfig {
  const symbols = (env.CRAWLER_SYMBOLS || '')
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(Boolean);
  return {
    enabled: flag(env.CRAWLER_ENABLED, true),
    universeSize: integer(env, 'CRAWLER_UNIVERSE_SIZE', 40, 2),
    kronosTop: integer(env, 'CRAWLER_KRONOS_TOP', 3, 0),
    whaleUsd: integer(env, 'CRAWLER_WHALE_USD', 100_000, 1),
    btcWhale: integer(env, 'CRAWLER_BTC_WHALE', 10, 1),
    ethWhaleUsd: integer(env, 'CRAWLER_ETH_WHALE_USD', 500_000, 1),
    restBase: (env.BINANCE_REST_BASE_URL || 'https://data-api.binance.vision').replace(/\/$/, ''),
    wsBase: (env.BINANCE_WS_BASE_URL || 'wss://data-stream.binance.vision/ws').replace(/\/ws$/, ''),
    snapshotDir: env.CRAWLER_SNAPSHOT_DIR || 'data/crawler',
    reportPath: env.CRAWLER_REPORT_PATH || 'reports/crawler-latest.json',
    symbols,
    refreshMs: integer(env, 'CRAWLER_REFRESH_MS', 60_000, 5_000)
  };
}

/** Fixed list for the historical study. Chosen as large, old USDT pairs, not by today's ranking. */
export const BACKTEST_UNIVERSE = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'BCHUSDT'
] as const;
