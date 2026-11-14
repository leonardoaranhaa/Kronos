import { appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** One day's file stays under this size. The next lines go to a numbered part. */
export const JOURNAL_MAX_BYTES = 8 * 1024 * 1024;
/** Daily files older than this are deleted on the next append. */
export const JOURNAL_KEEP_DAYS = 45;

export function journalPath(dir: string, stem: string, day: string, part: number): string {
  const suffix = part === 0 ? '' : `.${part}`;
  return join(dir, `${stem}-${day}${suffix}.jsonl`);
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

/** Drops `stem-YYYY-MM-DD` files whose day is more than `keepDays` before `now`. */
export function pruneJournals(dir: string, stem: string, now: Date, keepDays: number): void {
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const pattern = new RegExp(`^${stem}-(\\d{4}-\\d{2}-\\d{2})(?:\\.\\d+)?\\.jsonl$`);
  for (const name of names) {
    const match = name.match(pattern);
    if (!match) continue;
    const day = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isNaN(day) || day >= cutoff) continue;
    try {
      unlinkSync(join(dir, name));
    } catch {
      // A file that disappears between listing and delete is already gone.
    }
  }
}

/**
 * Appends complete lines (each already ending in a newline) to the day's journal.
 * Returns the file that received them.
 */
export function appendJournalLines(
  dir: string,
  stem: string,
  lines: string,
  now = new Date(),
  maxBytes = JOURNAL_MAX_BYTES,
  keepDays = JOURNAL_KEEP_DAYS
): string {
  mkdirSync(dir, { recursive: true });
  pruneJournals(dir, stem, now, keepDays);
  const day = now.toISOString().slice(0, 10);
  const bytes = Buffer.byteLength(lines);
  let part = 0;
  let path = journalPath(dir, stem, day, part);
  while (fileSize(path) > 0 && fileSize(path) + bytes > maxBytes) {
    part += 1;
    path = journalPath(dir, stem, day, part);
  }
  appendFileSync(path, lines, 'utf8');
  return path;
}
