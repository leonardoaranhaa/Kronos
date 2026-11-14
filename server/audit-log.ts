import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AuditEvent {
  at: string;
  type: string;
  [key: string]: unknown;
}

/** Appends one JSON object per line. This is a local research log, not an exchange record. */
export function appendAuditEvent(filePath: string, event: AuditEvent): void {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
}
