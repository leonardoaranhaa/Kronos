import test from 'node:test';
import assert from 'node:assert/strict';
import { getHealthSnapshot } from '../server/health';

test('reports ready only when Binance feed and model worker are healthy', () => {
  const health = getHealthSnapshot('binance', 'connected', 'ready');
  assert.equal(health.status, 'ok');
  assert.equal(health.ready, true);
});

test('reports degraded while feed reconnects or model is not ready', () => {
  assert.equal(getHealthSnapshot('binance', 'reconnecting', 'ready').status, 'degraded');
  assert.equal(getHealthSnapshot('binance', 'connected', 'starting').status, 'degraded');
  assert.equal(getHealthSnapshot('binance', 'error', 'error').ready, false);
});

test('treats a completed historical replay as a healthy feed state', () => {
  const health = getHealthSnapshot('replay', 'replay-complete', 'ready');
  assert.equal(health.status, 'ok');
  assert.equal(health.components.feed.healthy, true);
});
