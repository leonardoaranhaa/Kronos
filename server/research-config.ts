import { CostConfig } from './trading-math';
import { SignalConfig } from './signals';
import { CircuitBreakerConfig } from './circuit_breaker';

export interface ResearchConfig {
  costs: CostConfig;
  signal: SignalConfig;
  breaker: CircuitBreakerConfig;
  startingEquity: number;
  backtest: {
    context: number;
    horizon: number;
    stride: number;
    randomSeed: number;
  };
  auditPath: string;
  statePath: string;
  reportPath: string;
}

function numberFrom(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}

export function readResearchConfig(env: NodeJS.ProcessEnv = process.env): ResearchConfig {
  const costs: CostConfig = {
    feeRate: numberFrom(env, 'PAPER_FEE_RATE', 0.001),
    slippageRate: numberFrom(env, 'PAPER_SLIPPAGE_RATE', 0.0005),
    positionFraction: numberFrom(env, 'PAPER_POSITION_FRACTION', 1)
  };
  const signal: SignalConfig = {
    minMoveBps: numberFrom(env, 'PAPER_MIN_MOVE_BPS', 30),
    rsiBuyMax: numberFrom(env, 'PAPER_RSI_BUY_MAX', 70),
    rsiSellMin: numberFrom(env, 'PAPER_RSI_SELL_MIN', 30)
  };
  const breaker: CircuitBreakerConfig = {
    maxDailyDrawdownPct: numberFrom(env, 'BREAKER_MAX_DAILY_DRAWDOWN_PCT', 2),
    maxConsecutiveLosses: numberFrom(env, 'BREAKER_MAX_CONSECUTIVE_LOSSES', 3),
    cooldownPeriodMs: numberFrom(env, 'BREAKER_COOLDOWN_MS', 1_800_000),
    feedTimeoutMs: numberFrom(env, 'BREAKER_FEED_TIMEOUT_MS', 30_000)
  };
  const config: ResearchConfig = {
    costs,
    signal,
    breaker,
    startingEquity: numberFrom(env, 'PAPER_STARTING_EQUITY', 10_000),
    backtest: {
      context: numberFrom(env, 'BACKTEST_CONTEXT', 400),
      horizon: numberFrom(env, 'BACKTEST_HORIZON', 5),
      stride: numberFrom(env, 'BACKTEST_STRIDE', 12),
      randomSeed: numberFrom(env, 'BACKTEST_RANDOM_SEED', 42)
    },
    auditPath: env.AUDIT_LOG_PATH || 'data/audit/paper.jsonl',
    statePath: env.PAPER_STATE_PATH || 'data/paper/state.json',
    reportPath: env.BACKTEST_REPORT_PATH || 'reports/backtest-latest.json'
  };
  if (costs.feeRate < 0 || costs.slippageRate < 0) throw new Error('fees and slippage cannot be negative');
  if (!(costs.positionFraction > 0 && costs.positionFraction <= 1)) {
    throw new Error('PAPER_POSITION_FRACTION must be inside (0, 1]');
  }
  if (config.backtest.context < 32 || config.backtest.horizon < 1 || config.backtest.stride < 1) {
    throw new Error('BACKTEST_CONTEXT must be >= 32 and horizon/stride must be >= 1');
  }
  if (config.startingEquity <= 0) throw new Error('PAPER_STARTING_EQUITY must be positive');
  return config;
}
