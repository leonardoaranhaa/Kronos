import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPair, isExchangePage, normalizePair } from '../extension/lib/pair.js';

test('binance spot and futures urls become a USDT pair', () => {
  assert.equal(isExchangePage('https://www.binance.com/pt-BR/trade/BTC_USDT'), true);
  assert.deepEqual(
    detectPair('https://www.binance.com/pt-BR/trade/BTC_USDT?type=spot'),
    { symbol: 'BTCUSDT', source: 'binance-spot' }
  );
  assert.deepEqual(
    detectPair('https://www.binance.com/en/futures/ETHUSDT'),
    { symbol: 'ETHUSDT', source: 'binance-futuros' }
  );
  assert.equal(detectPair('https://www.binance.com/en/markets/overview'), null);
});

test('tradingview symbol, percent-encoding and the page title', () => {
  assert.deepEqual(
    detectPair('https://www.tradingview.com/chart/abc/?symbol=BINANCE%3ABTCUSDT'),
    { symbol: 'BTCUSDT', source: 'tradingview' }
  );
  assert.deepEqual(
    detectPair('https://br.tradingview.com/chart/?symbol=BINANCE:ETHUSDT.P'),
    { symbol: 'ETHUSDT', source: 'tradingview' }
  );
  assert.equal(
    detectPair('https://www.tradingview.com/chart/abc/', 'ETHUSDT 3.200,00 Binance')?.symbol,
    'ETHUSDT'
  );
  assert.equal(detectPair('https://example.com/trade/BTC_USDT', 'BTCUSDT'), null);
  assert.equal(normalizePair('btc/usdt'), 'BTCUSDT');
});
