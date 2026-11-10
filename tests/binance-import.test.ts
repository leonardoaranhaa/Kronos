import test from 'node:test';
import assert from 'node:assert/strict';
import { getNextBinanceCursor, normalizeBinanceKlineRow, sha256Content } from '../server/binance-import-core';

const validRow = [
  0, '100', '102', '99', '101', '2',
  59_999, '202', 10, '1', '101'
];

test('normalizes a valid completed Binance kline row', () => {
  const candle = normalizeBinanceKlineRow(validRow, 'btcusdt', '1m', 60_000, 120_000);
  assert.ok(candle);
  assert.equal(candle.symbol, 'BTCUSDT');
  assert.equal(candle.source, 'historical');
  assert.equal(candle.openTime, 0);
  assert.equal(candle.closeTime, 59_999);
  assert.equal(candle.quoteVolume, 202);
});

test('skips a candle that has not closed yet', () => {
  const row = [...validRow];
  row[6] = 119_999;
  assert.equal(normalizeBinanceKlineRow(row, 'BTCUSDT', '1m', 120_000, 120_000), null);
});

test('rejects malformed rows and invalid numeric candle values', () => {
  assert.throws(() => normalizeBinanceKlineRow([0, '100'], 'BTCUSDT', '1m', 60_000, 120_000), /Malformed Binance kline row/);
  const invalid = [...validRow];
  invalid[4] = 'not-a-price';
  assert.throws(() => normalizeBinanceKlineRow(invalid, 'BTCUSDT', '1m', 60_000, 120_000), /Invalid Binance candle/);
});

test('pagination cursor advances from the last row open time', () => {
  assert.equal(getNextBinanceCursor([validRow], 0, 60_000), 60_000);
});

test('pagination rejects malformed and non-advancing pages', () => {
  assert.throws(() => getNextBinanceCursor([], 0, 60_000), /invalid final row/);
  assert.throws(() => getNextBinanceCursor([[0]], 60_000, 60_000), /did not advance/);
});

test('snapshot hashes are stable and content-sensitive', () => {
  assert.equal(sha256Content('snapshot'), sha256Content('snapshot'));
  assert.notEqual(sha256Content('snapshot'), sha256Content('snapshot-2'));
});
