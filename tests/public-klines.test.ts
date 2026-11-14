import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicInterval, mergePublicCandles, parsePublicKlines } from '../server/market/public-klines';

test('public klines keep a valid row, drop a broken one, and merge pages by time', () => {
  assert.equal(isPublicInterval('15m'), true);
  assert.equal(isPublicInterval('2h'), false);
  const parsed = parsePublicKlines([
    [1_700_000_000_000, '100', '110', '90', '105', '12'],
    [1_700_000_060_000, '105', '100', '90', '95', '4'],
    [1_700_000_000_000, '100', '112', '90', '108', '8'],
    'nope'
  ]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].close, 108);
  assert.equal(parsed[0].volume, 8);
  const older = parsePublicKlines([[1_699_999_940_000, '99', '101', '98', '100', '3']]);
  const merged = mergePublicCandles(older, parsed);
  assert.deepEqual(merged.map(candle => candle.time), [1_699_999_940_000, 1_700_000_000_000]);
});
