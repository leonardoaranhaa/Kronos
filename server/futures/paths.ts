import { join } from 'node:path';

/** Root for collector files. Fly sets DATA_DIR=/data. An empty value stays on ./data. */
export function dataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.DATA_DIR?.trim();
  return root ? root : 'data';
}

/** Explicit FUTURES_DIR wins. Otherwise files land in <DATA_DIR>/futures. */
export function futuresRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.FUTURES_DIR?.trim();
  if (explicit) return explicit;
  return join(dataRoot(env), 'futures');
}

export function symbolDir(root: string, symbol: string): string {
  return join(root, symbol.toUpperCase());
}

export function liveSymbolDir(root: string, symbol: string): string {
  return join(root, 'live', symbol.toUpperCase());
}
