import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCandleSeries, validateCanonicalCandle } from '../server/candle-validation';
import { CanonicalCandle } from '../shared/types';

const intervalMs = 60_000;
const candle = (openTime: number): CanonicalCandle => ({
  venue: 'binance', symbol: 'BTCUSDT', interval: '1m',
  openTime, closeTime: openTime + intervalMs - 1,
  open: 100, high: 105, low: 98, close: 102, volume: 1.25,
  source: 'historical', ingestedAt: openTime + intervalMs
});

test('accepts a structurally valid canonical candle', () => {
  assert.deepEqual(validateCanonicalCandle(candle(intervalMs)), { valid: true, errors: [] });
});

test('rejects impossible OHLC relationships and negative volume', () => {
  const result = validateCanonicalCandle({ ...candle(intervalMs), high: 99, low: 101, volume: -1 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('high')));
  assert.ok(result.errors.some(error => error.includes('low')));
  assert.ok(result.errors.some(error => error.includes('volume')));
});

test('reports duplicate timestamps', () => {
  const result = auditCandleSeries([candle(intervalMs), candle(intervalMs)]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.duplicateOpenTimes, [intervalMs]);
  assert.equal(result.receivedCount, 2);
});

test('reports missing intervals', () => {
  const result = auditCandleSeries([candle(intervalMs), candle(intervalMs * 3)]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingIntervals, [intervalMs * 2]);
});

test('rejects close time inconsistent with interval semantics', () => {
  const result = validateCanonicalCandle({ ...candle(intervalMs), closeTime: intervalMs * 2 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes('inclusive interval boundary')));
});
