import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaperSession } from '../server/paper-session';
import { ResearchSignal } from '../server/signals';
import { candleAt } from './fixtures';

const costs = { feeRate: 0.001, slippageRate: 0, positionFraction: 1 };
const breaker = {
  maxDailyDrawdownPct: 2,
  maxConsecutiveLosses: 3,
  cooldownPeriodMs: 30 * 60 * 1000,
  feedTimeoutMs: 60_000
};
const signal: ResearchSignal = {
  action: 'BUY',
  reason: 'teste',
  forecastReturnBps: 40,
  heuristicScore: 0.4,
  indicators: { ema9: 1, ema20: 0, ema50: null, rsi14: 50, atr14: 1 }
};

test('a signal fills on the next candle open and is written to the audit log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kronos-paper-'));
  const auditPath = join(dir, 'audit.jsonl');
  const start = candleAt(0, 100).openTime;
  const session = new PaperSession(costs, breaker, 10_000, auditPath, undefined, start);
  session.queueSignal(signal, start, start);

  const sameCandle = session.onCandle(candleAt(0, 100), start);
  assert.equal(sameCandle.fills.length, 0);

  const next = candleAt(1, 101, 100);
  const filled = session.onCandle(next, next.closeTime);
  assert.equal(filled.fills.length, 1);
  assert.equal(filled.fills[0].purpose, 'open');
  assert.equal(filled.fills[0].price, next.open);
  assert.ok(filled.fills[0].fillPrice > 0);
  assert.equal(filled.snapshot.side, 'long');

  const lines = readFileSync(auditPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(lines.some(line => line.type === 'fill' && line.simulated === true));
  assert.equal(lines.some(line => line.type === 'order'), false);
});

test('a 2% adverse move flattens the paper position and blocks a new entry', () => {
  const start = candleAt(0, 100).closeTime;
  const session = new PaperSession(costs, breaker, 10_000, undefined, undefined, start);
  session.queueSignal(signal, candleAt(0, 100).openTime, start);
  const entry = candleAt(1, 100, 100);
  session.onCandle(entry, entry.closeTime);
  assert.equal(session.getSnapshot(entry.closeTime).side, 'long');

  const crash = candleAt(2, 96, 100);
  const step = session.onCandle(crash, crash.closeTime);
  assert.equal(step.flattened, true);
  assert.equal(step.snapshot.side, 'flat');
  assert.equal(step.snapshot.breaker.tripped, true);

  session.queueSignal(signal, crash.openTime, crash.closeTime);
  const later = candleAt(3, 97, 96);
  const blocked = session.onCandle(later, later.closeTime);
  assert.equal(blocked.snapshot.side, 'flat');
  assert.equal(blocked.fills.some(fill => fill.purpose === 'open'), false);
});

test('paper state reloads from the local snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kronos-state-'));
  const statePath = join(dir, 'state.json');
  const start = candleAt(0, 100).closeTime;
  const first = new PaperSession(costs, breaker, 10_000, undefined, statePath, start);
  first.queueSignal(signal, candleAt(0, 100).openTime, start);
  const entry = candleAt(1, 100, 100);
  first.onCandle(entry, entry.closeTime);

  const second = new PaperSession(costs, breaker, 10_000, undefined, statePath, entry.closeTime);
  assert.equal(second.getSnapshot(entry.closeTime).side, 'long');
  assert.ok(second.getSnapshot(entry.closeTime).feesPaid > 0);
});
