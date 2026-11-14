import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalCandle } from '../shared/types';
import { renderChartPng } from '../server/aranha/chart-png';
import { resampleCompleted } from '../server/aranha/resample';
import { evaluatePatterns } from '../server/aranha/structures';

const START = 1_704_067_200_000;

function candle(index: number, open: number, high: number, low: number, close: number, volume = 10): CanonicalCandle {
  const openTime = START + index * 300_000;
  return {
    venue: 'binance',
    symbol: 'BTCUSDT',
    interval: '5m',
    openTime,
    closeTime: openTime + 299_999,
    open,
    high,
    low,
    close,
    volume,
    quoteVolume: close * volume,
    source: 'historical',
    ingestedAt: openTime
  };
}

test('resample keeps only a finished hour and drops a gap or a partial bucket', () => {
  const hour = Array.from({ length: 12 }, (_, index) => candle(index, 100 + index, 102 + index, 99, 101 + index, 2));
  const asOf = hour[11].closeTime;
  const bars = resampleCompleted(hour, 3_600_000, 300_000, asOf);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].open, 100);
  assert.equal(bars[0].close, 112);
  assert.equal(bars[0].high, 113);
  assert.equal(bars[0].low, 99);
  assert.equal(bars[0].volume, 24);
  assert.equal(resampleCompleted(hour.slice(0, 11), 3_600_000, 300_000, hour[10].closeTime).length, 0);
  const gapped = hour.filter((_, index) => index !== 4);
  assert.equal(resampleCompleted(gapped, 3_600_000, 300_000, asOf).length, 0);
  const next = candle(12, 120, 121, 119, 120);
  assert.equal(resampleCompleted([...hour, next], 3_600_000, 300_000, asOf).length, 1);
});

test('four-hour bars need 48 complete 5-minute candles', () => {
  const candles = Array.from({ length: 48 }, (_, index) => candle(index, 100, 101, 99, 100));
  const bars = resampleCompleted(candles, 14_400_000, 300_000, candles[47].closeTime);
  assert.equal(bars.length, 1);
  assert.equal(resampleCompleted(candles.slice(0, 47), 14_400_000, 300_000, candles[46].closeTime).length, 0);
});

test('a hammer on the current bar is active and is not counted as a finished sample', () => {
  const candles: CanonicalCandle[] = [];
  for (let index = 0; index < 36; index++) candles.push(candle(index, 100, 100.4, 99.8, 100.1));
  candles.push(candle(36, 100, 100.2, 98.8, 99));
  candles.push(candle(37, 99, 99.2, 97.8, 98));
  candles.push(candle(38, 98, 98.2, 96.8, 97));
  candles.push(candle(39, 96, 96.5, 92, 96.4));
  const patterns = evaluatePatterns(candles, candles.length - 1);
  const hammer = patterns.find(pattern => pattern.timeframe === '5m' && pattern.id === 'hammer');
  assert.ok(hammer);
  assert.equal(hammer.activeNow, true);
  assert.equal(hammer.sampleCount, 0);
});

test('breakout hit rate uses only outcomes already known, and ignores a later shock', () => {
  const candles: CanonicalCandle[] = [];
  for (let index = 0; index < 25; index++) candles.push(candle(index, 100, 101, 99, 100));
  candles.push(candle(25, 100, 112, 100, 110));
  for (let index = 26; index <= 40; index++) candles.push(candle(index, 100, 101, 99, 100));
  const patterns = evaluatePatterns(candles, 40);
  const breakout = patterns.find(pattern => pattern.timeframe === '5m' && pattern.id === 'breakout-up');
  assert.ok(breakout);
  assert.equal(breakout.sampleCount, 1);
  assert.equal(breakout.hitRateUp, 0);
  assert.equal(breakout.activeNow, false);
  assert.ok((breakout.medianForwardReturnBps ?? 0) < 0);

  const future = candle(41, 100, 400, 100, 380);
  const withFuture = evaluatePatterns([...candles, future], 40);
  assert.deepEqual(
    withFuture.filter(pattern => pattern.timeframe === '5m').map(pattern => [pattern.id, pattern.sampleCount, pattern.hitRateUp, pattern.activeNow]),
    patterns.filter(pattern => pattern.timeframe === '5m').map(pattern => [pattern.id, pattern.sampleCount, pattern.hitRateUp, pattern.activeNow])
  );
});

test('chart png is a real PNG and does not need a key', () => {
  const png = renderChartPng([
    { t: 1, o: 10, h: 12, l: 9, c: 11 },
    { t: 2, o: 11, h: 13, l: 10, c: 10 }
  ], [{ timeframe: '1h', kind: 'support', low: 9.5, high: 10, touches: 2 }]);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
});
