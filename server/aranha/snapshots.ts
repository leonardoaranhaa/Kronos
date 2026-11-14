import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WebContext } from './types';

/** Live web snapshots for a later, honest evaluation. This is not a backtest. */
export async function writeWebSnapshot(dir: string, context: WebContext): Promise<string> {
  await mkdir(dir, { recursive: true });
  const name = `web-${context.asOf.replace(/[:.]/g, '-')}.json`;
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(context, null, 2)}\n`);
  return path;
}
