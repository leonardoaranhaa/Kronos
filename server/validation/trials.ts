import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface TrialEntry {
  id: string;
  family: string;
  strategy: string;
  recordedAt: string;
  /** How many variations this line stands for. A grid that was not stored row by row uses the grid size. */
  trials: number;
  sharpe: number | null;
  periods: number | null;
  source: string;
  params?: unknown;
}

export function trialId(family: string, strategy: string, params: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(params ?? null)).digest('hex').slice(0, 12);
  return `${family}:${strategy}:${digest}`;
}

export function readTrials(filePath: string): TrialEntry[] {
  if (!existsSync(filePath)) return [];
  const entries: TrialEntry[] = [];
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as TrialEntry;
    if (!row.id || !row.family || !Number.isInteger(row.trials) || row.trials < 1) {
      throw new Error(`invalid trial row in ${filePath}`);
    }
    entries.push(row);
  }
  return entries;
}

/** Insert or replace the row with the same id. Re-running the same variation does not inflate N. */
export function upsertTrial(filePath: string, entry: TrialEntry): TrialEntry[] {
  const entries = readTrials(filePath).filter(row => row.id !== entry.id);
  entries.push(entry);
  mkdirSync(dirname(filePath), { recursive: true });
  const body = entries.map(row => JSON.stringify(row)).join('\n');
  writeFileSync(filePath, body.length ? `${body}\n` : '', 'utf8');
  return entries;
}

export function appendTrial(filePath: string, entry: TrialEntry): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

export function trialsFor(entries: readonly TrialEntry[], family: string): TrialEntry[] {
  return entries.filter(entry => entry.family === family);
}

export function trialCount(entries: readonly TrialEntry[], family: string): number {
  return trialsFor(entries, family).reduce((sum, entry) => sum + entry.trials, 0);
}

export function recordedSharpes(entries: readonly TrialEntry[], family: string): number[] {
  return trialsFor(entries, family)
    .filter(entry => entry.trials === 1 && entry.sharpe !== null && Number.isFinite(entry.sharpe))
    .map(entry => entry.sharpe as number);
}
