import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBreaker,
  evaluateBreaker,
  noteClosedTrade,
  noteEquity,
  noteHeartbeat,
  CircuitBreakerConfig
} from '../server/circuit_breaker';

const config: CircuitBreakerConfig = {
  maxDailyDrawdownPct: 2,
  maxConsecutiveLosses: 3,
  cooldownPeriodMs: 30 * 60 * 1000,
  feedTimeoutMs: 30_000
};

const start = Date.parse('2026-11-12T15:00:00.000Z');

test('a 2% daily drawdown trips and a smaller drawdown does not', () => {
  const fresh = createBreaker(config, start, 10_000);
  const inside = noteEquity(fresh, config, 9_801, start);
  assert.equal(evaluateBreaker(inside, config, start).tripped, false);

  const breached = noteEquity(fresh, config, 9_800, start);
  const decision = evaluateBreaker(breached, config, start);
  assert.equal(decision.tripped, true);
  assert.equal(decision.mustFlatten, true);
  assert.equal(decision.canOpen, false);
});

test('three losing round trips start a cooldown and the next win clears the streak', () => {
  let state = createBreaker(config, start, 10_000);
  state = noteClosedTrade(state, config, -1, start);
  state = noteClosedTrade(state, config, -1, start + 1);
  assert.equal(evaluateBreaker(state, config, start + 1).inCooldown, false);
  state = noteClosedTrade(state, config, -1, start + 2);
  const paused = evaluateBreaker(state, config, start + 2);
  assert.equal(paused.inCooldown, true);
  assert.equal(paused.canOpen, false);
  assert.equal(paused.mustFlatten, false);

  const resumed = noteHeartbeat(state, state.cooldownUntil);
  const after = evaluateBreaker(resumed, config, resumed.cooldownUntil);
  assert.equal(after.inCooldown, false);
  assert.equal(after.canOpen, true);
});

test('a silent feed blocks new entries until a heartbeat arrives', () => {
  const state = noteHeartbeat(createBreaker(config, start, 10_000), start);
  assert.equal(evaluateBreaker(state, config, start + 30_000).feedStale, false);
  const stale = evaluateBreaker(state, config, start + 30_001);
  assert.equal(stale.feedStale, true);
  assert.equal(stale.canOpen, false);
  const restored = noteHeartbeat(state, start + 31_000);
  assert.equal(evaluateBreaker(restored, config, start + 31_000).canOpen, true);
});

test('the daily trip resets on the next UTC day', () => {
  let state = noteEquity(createBreaker(config, start, 10_000), config, 9_700, start);
  assert.equal(state.tripped, true);
  const nextDay = Date.parse('2026-11-13T00:00:00.000Z');
  state = noteHeartbeat(noteEquity(state, config, 9_700, nextDay), nextDay);
  assert.equal(state.tripped, false);
  assert.equal(state.dayStartEquity, 9_700);
  assert.equal(evaluateBreaker(state, config, nextDay).canOpen, true);
});
