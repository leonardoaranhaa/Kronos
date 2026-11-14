import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalCandle } from '../shared/types';
import { createReplaySequence } from '../server/market-feed';

const candle = (openTime: number): CanonicalCandle => ({
  venue: 'binance', symbol: 'BTCUSDT', interval: '1m',
  openTime, closeTime: openTime + 59_999,
  open: 100, high: 102, low: 99, close: 101, volume: 2,
  quoteVolume: 202, source: 'historical', ingestedAt: openTime + 60_000
});

test('replay sequence is chronological and preserves source candle values', () => {
  const sequence = createReplaySequence([candle(120_000), candle(0), candle(60_000)]);
  assert.deepEqual(sequence.map(item => item.openTime), [0, 60_000, 120_000]);
  assert.ok(sequence.every(item => item.source === 'replay'));
  assert.equal(sequence[0].close, 101);
  assert.equal(sequence[0].quoteVolume, 202);
});

test('replaying the same snapshot twice produces identical sequences', () => {
  const snapshot = [candle(0), candle(60_000), candle(120_000)];
  assert.deepEqual(createReplaySequence(snapshot), createReplaySequence(snapshot));
});

test('refuses empty, gapped, duplicated or non-historical snapshots', () => {
  assert.throws(() => createReplaySequence([]), /invalid historical series/);
  assert.throws(() => createReplaySequence([candle(0), candle(120_000)]), /invalid historical series/);
  assert.throws(() => createReplaySequence([candle(0), candle(0)]), /invalid historical series/);
  assert.throws(() => createReplaySequence([{ ...candle(0), source: 'websocket' }]), /only historical Binance candles/);
});
