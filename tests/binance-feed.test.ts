import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBinanceKline } from '../server/market-feed';

const closed = {
  e: 'kline',
  s: 'BTCUSDT',
  k: {
    t: 1_700_000_000_000,
    T: 1_700_000_299_999,
    s: 'BTCUSDT',
    i: '5m',
    o: '35000.00',
    h: '35100.00',
    l: '34900.00',
    c: '35050.00',
    v: '12.5',
    q: '438000.0',
    x: true
  }
};

test('maps a closed Binance kline to the canonical candle contract', () => {
  const candle = parseBinanceKline(closed, 1_700_000_300_100);
  assert.ok(candle);
  assert.equal(candle.venue, 'binance');
  assert.equal(candle.symbol, 'BTCUSDT');
  assert.equal(candle.interval, '5m');
  assert.equal(candle.openTime, 1_700_000_000_000);
  assert.equal(candle.closeTime, 1_700_000_299_999);
  assert.equal(candle.volume, 12.5);
  assert.equal(candle.quoteVolume, 438000);
  assert.equal(candle.source, 'websocket');
});

test('ignores an open Binance kline update', () => {
  const open = { ...closed, k: { ...closed.k, x: false } };
  assert.equal(parseBinanceKline(open), null);
});

test('ignores non-kline messages', () => {
  assert.equal(parseBinanceKline({ e: '24hrTicker' }), null);
});
