import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoinView } from '../server/crawler/live';
import type { MarketBar } from '../server/crawler/types';

const START = 1_704_067_200_000;

function flat(index: number, close = 100): MarketBar {
  return {
    openTime: START + index * 300_000,
    open: close,
    high: close + 0.4,
    low: close - 0.4,
    close,
    volume: 10,
    quoteVolume: close * 10,
    takerBuyQuote: close * 4
  };
}

test('the live chart marks a breakout, a whale and a paper entry without using a later bar', () => {
  const series = Array.from({ length: 30 }, (_, index) => flat(index));
  series[29] = { ...flat(29, 110), high: 111, low: 109, volume: 80, quoteVolume: 8800, takerBuyQuote: 7000 };
  const view = buildCoinView({
    symbol: 'BTCUSDT',
    bars: series,
    whales: [{
      id: 'print-1',
      symbol: 'BTCUSDT',
      time: new Date(series[29].openTime).toISOString(),
      usd: 150_000,
      side: 'compra',
      price: 110
    }],
    walls: [{ symbol: 'BTCUSDT', side: 'compra', price: 100, usd: 400_000, distancePct: 0.2 }],
    paper: [{
      at: new Date(series[28].openTime).toISOString(),
      type: 'fill',
      purpose: 'open',
      side: 'buy',
      price: 100
    }],
    onchain: [{
      id: 'tx1',
      asset: 'BTC',
      time: new Date(series[29].openTime).toISOString(),
      amount: '12 BTC',
      txid: 'tx1',
      url: 'https://mempool.space/tx/tx1',
      direction: 'entrada na corretora',
      label: 'Binance',
      source: 'mempool.space'
    }]
  });
  assert.ok(view.annotations.some(item => item.kind === 'rompimento' && item.side === 'compra'));
  const whale = view.annotations.find(item => item.kind === 'baleia');
  assert.equal(whale?.usd, 150_000);
  assert.match(whale?.label ?? '', /dólares/);
  assert.ok(view.annotations.some(item => item.kind === 'entrada'));
  assert.ok(view.annotations.some(item => item.kind === 'cadeia' && item.label.includes('entrada na corretora')));
  assert.ok(view.walls.some(wall => wall.price === 100));
  assert.equal(view.candles.at(-1)?.c, 110);
  assert.ok(view.feed.some(item => item.text.includes('dólares')));
});
