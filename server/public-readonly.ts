import { join } from 'node:path';
import type { Request, Response, NextFunction } from 'express';

/** Exchange credentials are dropped in public mode. They are never used to send an order. */
export const EXCHANGE_CREDENTIAL_KEYS = [
  'BINANCE_API_KEY',
  'BINANCE_API_SECRET',
  'BINANCE_SECRET_KEY',
  'BINANCE_SECRET'
] as const;

const WRITING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CLOSED_PATH = /^\/api\/(admin|order|orders|execute|execution)(\/|$)/i;

export function isPublicReadonly(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.PUBLIC_READONLY || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on' || value === 'yes' || value === 'sim';
}

/**
 * Points collector files at DATA_DIR when a path was left empty.
 * An explicit path in the environment wins, so local runs stay where they are.
 */
export function applyDataDir(env: NodeJS.ProcessEnv, dataDir = env.DATA_DIR): void {
  const root = dataDir?.trim();
  if (!root) return;
  const fill = (key: string, relative: string) => {
    if (env[key] === undefined || env[key].trim() === '') env[key] = join(root, relative);
  };
  fill('CRAWLER_SNAPSHOT_DIR', 'crawler');
  fill('ARANHA_SNAPSHOT_DIR', 'aranha/snapshots');
  fill('ARANHA_CACHE_DIR', 'aranha/cache');
  fill('AUDIT_LOG_PATH', 'audit/paper.jsonl');
  fill('PAPER_STATE_PATH', 'paper/state.json');
  fill('BACKTEST_REPORT_PATH', 'reports/backtest-latest.json');
  fill('ARANHA_REPORT_PATH', 'reports/aranha-latest.json');
  fill('CRAWLER_REPORT_PATH', 'reports/crawler-latest.json');
  if (env.HF_HOME === undefined || env.HF_HOME.trim() === '') env.HF_HOME = join(root, 'huggingface');
  if (env.HUGGINGFACE_HUB_CACHE === undefined || env.HUGGINGFACE_HUB_CACHE.trim() === '') {
    env.HUGGINGFACE_HUB_CACHE = join(root, 'huggingface', 'hub');
  }
  if (env.TRANSFORMERS_CACHE === undefined || env.TRANSFORMERS_CACHE.trim() === '') {
    env.TRANSFORMERS_CACHE = join(root, 'huggingface', 'transformers');
  }
}

/** Removes exchange secrets from the process so a later import cannot see them. */
export function dropExchangeCredentials(env: NodeJS.ProcessEnv): string[] {
  const dropped: string[] = [];
  for (const key of EXCHANGE_CREDENTIAL_KEYS) {
    if (env[key] && env[key].trim() !== '') {
      delete env[key];
      dropped.push(key);
    }
  }
  return dropped;
}

export function readonlyDecision(method: string, path: string): { allow: boolean; status: number; error: string } {
  const pathname = path.split('?')[0] || '/';
  if (CLOSED_PATH.test(pathname)) {
    return { allow: false, status: 403, error: 'Rota fechada no modo público somente leitura.' };
  }
  const verb = method.toUpperCase();
  if (verb === 'GET' || verb === 'HEAD') return { allow: true, status: 200, error: '' };
  if (WRITING_METHODS.has(verb)) {
    return {
      allow: false,
      status: 405,
      error: 'Modo público somente leitura. Este servidor aceita GET, HEAD e o WebSocket /ws.'
    };
  }
  return {
    allow: false,
    status: 405,
    error: 'Modo público somente leitura. Este servidor aceita GET, HEAD e o WebSocket /ws.'
  };
}

export function publicReadonlyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const decision = readonlyDecision(req.method, req.path);
  if (decision.allow) {
    next();
    return;
  }
  res.status(decision.status).json({ error: decision.error, readonly: true });
}

/**
 * Fly restarts a machine when the HTTP check is not 2xx.
 * In public mode the process answers 200 as soon as it can speak.
 * The JSON field `ready` stays false until the feed and the model are up.
 */
export function healthHttpStatus(ready: boolean, publicReadOnly: boolean): number {
  if (ready) return 200;
  return publicReadOnly ? 200 : 503;
}
