import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CanonicalCandle } from '../shared/types';
import { calculateATR, calculateEMA, calculateRSI } from '../server/indicators';
import { atrSeries, buildAnalogIndex, emaSeries, rsiSeries, searchAnalogs, summarizeAnalogs } from '../server/aranha/analogs';

const START = 1_704_067_200_000;

function make(closes: number[]): CanonicalCandle[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    const openTime = START + index * 300_000;
    return {
      venue: 'binance',
      symbol: 'BTCUSDT',
      interval: '5m',
      openTime,
      closeTime: openTime + 299_999,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 10,
      quoteVolume: close * 10,
      source: 'historical',
      ingestedAt: openTime
    };
  });
}

const motif = [100, 108, 101, 112, 96, 107, 118, 99, 109, 95, 114, 103, 111, 98, 116, 105];

test('causal indicators match the existing EMA, RSI and ATR', () => {
  const closes = Array.from({ length: 40 }, (_, index) => 100 + Math.sin(index / 3) * 4 + index * 0.05);
  const candles = make(closes);
  assert.equal(emaSeries(closes, 9).at(-1)?.toFixed(4), String(calculateEMA(closes, 9)));
  assert.equal(rsiSeries(closes, 14).at(-1)?.toFixed(2), String(calculateRSI(closes, 14)));
  assert.equal(atrSeries(candles, 14).at(-1)?.toFixed(4), String(calculateATR(candles, 14)));
});

test('analog search is point-in-time and finds the repeated shape', () => {
  const closes = Array.from({ length: 130 }, () => 100);
  const paint = (end: number) => {
    for (let offset = 0; offset < motif.length; offset++) {
      closes[end - motif.length + 1 + offset] = motif[offset];
    }
  };
  paint(30);
  paint(100);
  const candles = make(closes);
  const config = { window: 16, horizon: 4, k: 3, separation: 4, candidateStride: 1 };
  const found = searchAnalogs(buildAnalogIndex(candles, 16), 100, config);
  assert.ok(found.length > 0);
  assert.equal(found[0].endIndex, 30);
  assert.ok(found.every(match => match.endIndex <= 100 - 16));
  assert.ok(found.every(match => match.endIndex + 4 <= 100));

  const future = closes.slice();
  future[120] = 500;
  const afterShock = searchAnalogs(buildAnalogIndex(make(future), 16), 100, config);
  assert.deepEqual(afterShock.map(match => match.endIndex), found.map(match => match.endIndex));

  const prefix = searchAnalogs(buildAnalogIndex(candles.slice(0, 101), 16), 100, config);
  assert.deepEqual(prefix.map(match => match.endIndex), found.map(match => match.endIndex));
});

test('a nearer copy whose outcome is still in the future is not an analog', () => {
  const closes = Array.from({ length: 130 }, () => 100);
  const paint = (end: number) => {
    for (let offset = 0; offset < motif.length; offset++) closes[end - motif.length + 1 + offset] = motif[offset];
  };
  paint(40);
  paint(100);
  const candles = make(closes);
  const found = searchAnalogs(buildAnalogIndex(candles, 16), 100, {
    window: 16,
    horizon: 20,
    k: 5,
    separation: 4,
    candidateStride: 1
  });
  assert.ok(found.every(match => match.endIndex + 20 <= 100));
  assert.ok(found.some(match => match.endIndex === 40));
});

test('analog summary counts ups and downs from the matches only', () => {
  const summary = summarizeAnalogs([
    { endIndex: 1, endOpenTime: 1, distance: 0.2, forwardReturnBps: 10, direction: 'up', spark: [0, 1], forward: [1, 0.8] },
    { endIndex: 2, endOpenTime: 2, distance: 0.4, forwardReturnBps: -5, direction: 'down', spark: [0, 1], forward: [1, 0.2] }
  ]);
  assert.equal(summary.count, 2);
  assert.equal(summary.hitRateUp, 0.5);
  assert.equal(summary.hitRateDown, 0.5);
  assert.equal(summary.medianForwardReturnBps, 2.5);
});

test('the analog module does not contain an API key', () => {
  const source = readFileSync(new URL('../server/aranha/analogs.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sk-ant-|sk-[A-Za-z0-9]{16,}/);
});
