import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeJsonl(file: string, rows: readonly object[]): void {
  mkdirSync(dirname(file), { recursive: true });
  const body = rows.map(row => JSON.stringify(row)).join('\n');
  writeFileSync(file, body.length ? `${body}\n` : '', 'utf8');
}

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const rows: T[] = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line) as T);
  }
  return rows;
}

export function appendJsonl(file: string, row: object): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
}
