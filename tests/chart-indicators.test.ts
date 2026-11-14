import test from 'node:test';
import assert from 'node:assert/strict';
import { atr, bollinger, ema, macd, parsePeriods, rsi, sma, vwap } from '../src/client/chart/indicators';
import { depthSteps } from '../src/client/chart/depth';

test('sma and ema use only the bars already seen', () => {
  assert.deepEqual(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  const line = ema([1, 2, 3, 4, 5], 3);
  assert.equal(line[1], null);
  assert.equal(line[2], 2);
  assert.equal(line[3], 3);
  assert.equal(line[4], 4);
  const longer = ema([1, 2, 3, 4, 5, 100], 3);
  assert.equal(longer[4], line[4]);
});

test('rsi is 100 on a climb and bollinger middle is the sma', () => {
  const climb = Array.from({ length: 20 }, (_, index) => index + 1);
  const strength = rsi(climb, 14);
  assert.equal(strength[14], 100);
  assert.equal(strength[13], null);
  const bands = bollinger([1, 2, 3, 4, 5, 6], 3, 2);
  assert.equal(bands.middle[2], 2);
  assert.ok((bands.upper[2] ?? 0) > 2);
  assert.ok((bands.lower[2] ?? 0) < 2);
});

test('vwap, atr and macd stay defined only after their warmup', () => {
  assert.deepEqual(vwap([
    { high: 3, low: 1, close: 2, volume: 10 },
    { high: 4, low: 2, close: 3, volume: 0 }
  ]), [2, 2]);
  const flat = Array.from({ length: 16 }, () => ({ high: 11, low: 9, close: 10 }));
  const range = atr(flat, 14);
  assert.equal(range[13], null);
  assert.equal(range[14], 2);
  const quiet = macd(Array.from({ length: 40 }, () => 50));
  const last = quiet.macd[39];
  assert.equal(last, 0);
  assert.equal(quiet.histogram[39], 0);
});

test('five thousand candles stay inside a short budget', () => {
  const closes = Array.from({ length: 5000 }, (_, index) => 100 + Math.sin(index / 9));
  const bars = closes.map(close => ({ high: close + 1, low: close - 1, close, volume: 10 }));
  const start = performance.now();
  rsi(closes, 14);
  macd(closes);
  bollinger(closes, 20, 2);
  atr(bars, 14);
  vwap(bars);
  assert.ok(performance.now() - start < 250);
});

test('period text keeps a few sane numbers and depth accumulates from the inside', () => {
  assert.deepEqual(parsePeriods('9, 20, 1, 900, 20'), [9, 20]);
  const book = depthSteps([{ price: 100, quantity: 2 }, { price: 99, quantity: 1 }], 'compra');
  assert.deepEqual(book, [{ price: 100, usd: 200 }, { price: 99, usd: 299 }]);
  assert.deepEqual(depthSteps([], 'venda'), []);
});
