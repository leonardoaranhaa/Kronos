import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal .env loader for local development. Existing process environment
 * variables take precedence. This is intentionally limited to KEY=VALUE lines.
 */
export function loadEnvFile(filePath = resolve(process.cwd(), '.env')): void {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) process.env[key] = value;
  }
}
