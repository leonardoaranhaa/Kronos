import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSignal, SignalInput } from '../server/signals';

const config = { minMoveBps: 30, rsiBuyMax: 70, rsiSellMin: 30 };

function input(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    close: 100,
    predictedCloses: [100.3],
    ema9: 11,
    ema20: 10,
    rsi14: 55,
    atr14: 1,
    ...overrides
  };
}

test('BUY requires the forecast to clear the minimum move and agree with the EMAs', () => {
  const signal = decideSignal(input(), config);
  assert.equal(signal.action, 'BUY');
  assert.ok(signal.forecastReturnBps !== null && signal.forecastReturnBps >= 30);
  assert.ok(signal.heuristicScore > 0 && signal.heuristicScore <= 1);
});

test('a forecast just below the minimum move stays HOLD', () => {
  const signal = decideSignal(input({ predictedCloses: [100.29] }), config);
  assert.equal(signal.action, 'HOLD');
  assert.match(signal.reason, /não alcança o mínimo/);
});

test('an up forecast is HOLD when EMA9 is not above EMA20', () => {
  const signal = decideSignal(input({ ema9: 9, ema20: 10 }), config);
  assert.equal(signal.action, 'HOLD');
});

test('RSI at the buy ceiling blocks an otherwise valid BUY', () => {
  const signal = decideSignal(input({ rsi14: 70 }), config);
  assert.equal(signal.action, 'HOLD');
  assert.match(signal.reason, /RSI/);
});

test('SELL is the mirror of the buy rule', () => {
  const signal = decideSignal(input({
    predictedCloses: [99.7],
    ema9: 9,
    ema20: 10,
    rsi14: 45
  }), config);
  assert.equal(signal.action, 'SELL');
});

test('RSI at the sell floor blocks an otherwise valid SELL', () => {
  const signal = decideSignal(input({
    predictedCloses: [99.7],
    ema9: 9,
    ema20: 10,
    rsi14: 30
  }), config);
  assert.equal(signal.action, 'HOLD');
});

test('missing indicators or a missing forecast do not invent a side', () => {
  assert.equal(decideSignal(input({ ema9: null }), config).action, 'HOLD');
  assert.equal(decideSignal(input({ predictedCloses: [] }), config).action, 'HOLD');
});
