import { closeSync, openSync, readdirSync, readSync } from 'node:fs';
import { join } from 'node:path';

function firstLine(filePath: string): string {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString('utf8').split(/\r?\n/, 1)[0] ?? '';
  } finally {
    closeSync(fd);
  }
}

/**
 * Pick the newest normalized snapshot for the configured symbol and interval.
 * A directory that also holds other markets must not win just because its
 * filename sorts last.
 */
export function selectNormalizedSnapshot(options: {
  dir: string;
  symbol: string;
  interval: string;
  configuredPath?: string;
}): string {
  if (options.configuredPath) return options.configuredPath;
  const symbol = options.symbol.toUpperCase();
  const names = readdirSync(options.dir).filter(name => name.endsWith('.jsonl')).sort();
  const matches: string[] = [];
  for (const name of names) {
    const line = firstLine(join(options.dir, name));
    if (!line.trim()) continue;
    const candle = JSON.parse(line) as { symbol?: string; interval?: string };
    if (candle.symbol === symbol && candle.interval === options.interval) matches.push(name);
  }
  if (matches.length === 0) {
    throw new Error(`No ${symbol} ${options.interval} snapshot in ${options.dir}. Set HISTORICAL_DATA_PATH or import that market.`);
  }
  return join(options.dir, matches[matches.length - 1]);
}
