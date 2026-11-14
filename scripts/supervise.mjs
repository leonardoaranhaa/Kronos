/**
 * Keeps the research server, the Aranha collector and the crawler in one process.
 * Restarts that process if it exits, and if /api/health stops answering.
 * A degraded health JSON (feed or model still starting) is still a live process.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = process.env.PORT || '3000';
const missLimit = Number(process.env.WATCHDOG_MISSES || 3);
const intervalMs = Number(process.env.WATCHDOG_INTERVAL_MS || 30_000);
const graceMs = Number(process.env.WATCHDOG_GRACE_MS || 20_000);

export function watchdogShouldRestart(consecutiveMisses, limit = missLimit) {
  return consecutiveMisses >= limit;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let child = null;
let stopping = false;
let restartTimer = null;

function startServer() {
  if (stopping) return;
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    console.error(`[supervise] o servidor saiu (code=${code ?? 'null'} signal=${signal ?? 'null'}). Vou subir de novo.`);
    restartTimer = setTimeout(startServer, 2000);
  });
}

async function probeOnce() {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5000) });
  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`HTTP ${response.status}`);
  }
}

async function watch() {
  await sleep(graceMs);
  let misses = 0;
  while (!stopping) {
    if (child) {
      try {
        await probeOnce();
        misses = 0;
      } catch (error) {
        misses += 1;
        console.error(`[supervise] health sem resposta (${misses}/${missLimit}): ${error instanceof Error ? error.message : error}`);
        if (watchdogShouldRestart(misses, missLimit)) {
          misses = 0;
          console.error('[supervise] reiniciando o servidor depois de falhas seguidas do health.');
          child.kill('SIGTERM');
        }
      }
    }
    await sleep(intervalMs);
  }
}

function shutdown() {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  child?.kill('SIGTERM');
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  startServer();
  void watch();
}
