import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { watchdogShouldRestart } from '../scripts/supervise.mjs';
import { researchSocketUrl } from '../src/client/socket-url';
import {
  applyDataDir,
  dropExchangeCredentials,
  healthHttpStatus,
  isPublicReadonly,
  publicReadonlyMiddleware,
  readonlyDecision
} from '../server/public-readonly';

test('public mode blocks writes and closed routes, and still allows GET and HEAD', async () => {
  const app = express();
  let wrote = false;
  app.use(publicReadonlyMiddleware);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/teia', (_req, res) => {
    wrote = true;
    res.json({ wrote: true });
  });
  app.get('/api/admin/keys', (_req, res) => res.json({ secret: true }));
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(ok.status, 200);
    const head = await fetch(`http://127.0.0.1:${port}/api/health`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/teia`, { method });
      assert.equal(response.status, 405);
      const body = await response.json() as { readonly: boolean };
      assert.equal(body.readonly, true);
    }
    assert.equal(wrote, false);
    const admin = await fetch(`http://127.0.0.1:${port}/api/admin/keys`);
    assert.equal(admin.status, 403);
    const order = await fetch(`http://127.0.0.1:${port}/api/order`, { method: 'POST' });
    assert.equal(order.status, 403);
    assert.equal(readonlyDecision('GET', '/ws').allow, true);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('DATA_DIR fills empty paths, keeps an explicit path, and exchange keys are dropped', () => {
  const env = {
    DATA_DIR: '/data',
    CRAWLER_SNAPSHOT_DIR: 'keep-me',
    BINANCE_API_KEY: 'should-go',
    BINANCE_API_SECRET: 'should-go',
    ANTHROPIC_API_KEY: 'not-an-exchange-key'
  } as NodeJS.ProcessEnv;
  applyDataDir(env);
  assert.equal(env.CRAWLER_SNAPSHOT_DIR, 'keep-me');
  assert.equal(env.ARANHA_SNAPSHOT_DIR, join('/data', 'aranha', 'snapshots'));
  assert.equal(env.AUDIT_LOG_PATH, join('/data', 'audit', 'paper.jsonl'));
  assert.equal(env.PAPER_STATE_PATH, join('/data', 'paper', 'state.json'));
  assert.equal(env.HF_HOME, join('/data', 'huggingface'));
  assert.equal(env.BACKTEST_REPORT_PATH, undefined);
  assert.equal(env.ARANHA_REPORT_PATH, undefined);
  assert.equal(env.CRAWLER_REPORT_PATH, undefined);
  const dropped = dropExchangeCredentials(env);
  assert.deepEqual(dropped.sort(), ['BINANCE_API_KEY', 'BINANCE_API_SECRET']);
  assert.equal(env.BINANCE_API_KEY, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, 'not-an-exchange-key');
  assert.equal(isPublicReadonly({ PUBLIC_READONLY: '1' } as NodeJS.ProcessEnv), true);
  assert.equal(isPublicReadonly({} as NodeJS.ProcessEnv), false);
});

test('a public health check stays HTTP 200 while the JSON can still say not ready', () => {
  assert.equal(healthHttpStatus(true, false), 200);
  assert.equal(healthHttpStatus(false, false), 503);
  assert.equal(healthHttpStatus(false, true), 200);
  assert.equal(healthHttpStatus(true, true), 200);
});

test('the browser socket uses port 3000 only for the Vite dev server', () => {
  assert.equal(researchSocketUrl({ protocol: 'http:', hostname: 'localhost', port: '5173' }), 'ws://localhost:3000/ws');
  assert.equal(researchSocketUrl({ protocol: 'https:', hostname: 'crypto-crawling.fly.dev', port: '' }), 'wss://crypto-crawling.fly.dev/ws');
});

test('the watchdog restarts only after repeated missed health checks', () => {
  assert.equal(watchdogShouldRestart(2, 3), false);
  assert.equal(watchdogShouldRestart(3, 3), true);
});

test('the Fly file and the image stay read-only, in gru, with the rope patch', () => {
  const fly = readFileSync(new URL('../fly.toml', import.meta.url), 'utf8');
  assert.match(fly, /app = "crypto-crawling"/);
  assert.match(fly, /primary_region = "gru"/);
  assert.match(fly, /internal_port = 3000/);
  assert.match(fly, /auto_stop_machines = false/);
  assert.match(fly, /min_machines_running = 1/);
  assert.match(fly, /memory = "2gb"/);
  assert.match(fly, /path = "\/api\/health"/);
  assert.match(fly, /destination = "\/data"/);
  assert.match(fly, /PUBLIC_READONLY = "1"/);
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(docker, /download\.pytorch\.org\/whl\/cpu/);
  assert.match(docker, /kronos-rope-425\.patch/);
  assert.match(docker, /PUBLIC_READONLY=1/);
  assert.match(docker, /supervise\.mjs/);
  assert.match(docker, /COPY reports \.\/reports/);
  const ignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
  assert.equal(ignore.split('\n').includes('reports'), false);
  assert.match(docker, /KRONOS_DEVICE=cpu/);
  const index = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  assert.equal(index.includes('order_execution'), false);
});
