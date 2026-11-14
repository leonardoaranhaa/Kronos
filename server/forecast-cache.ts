import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CachedForecast } from './research-eval';

export function loadForecastCache(filePath: string, datasetSha256?: string): Map<number, CachedForecast> {
  const cache = new Map<number, CachedForecast>();
  if (!existsSync(filePath)) return cache;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as CachedForecast;
    if (!Number.isFinite(row.openTime) || !Array.isArray(row.meanCloses) || !Array.isArray(row.sampleEnds)) continue;
    if (datasetSha256 && row.datasetSha256 !== datasetSha256) continue;
    cache.set(row.openTime, row);
  }
  return cache;
}

export function appendForecastCache(filePath: string, rows: readonly CachedForecast[]): void {
  if (rows.length === 0) return;
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
}
