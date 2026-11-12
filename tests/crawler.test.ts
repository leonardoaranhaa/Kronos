import test from 'node:test';
import assert from 'node:assert/strict';
import { selectUniverse, isLeveragedBase, parseTickerPayload } from '../server/crawler/universe';
import { scoreCoin, rankScores } from '../server/crawler/score';
import { runCrawlerBacktest } from '../server/crawler/backtest';
import {
  findWalls,
  parseAggTrade,
  parseDepth,
  parseMempoolRecent,
  parseMempoolTransaction,
  tagTransfer,
  toWhalePrint,
  whalePressure
} from '../server/crawler/whales';
import { CrawlerRuntime } from '../server/crawler/runtime';
import { readCrawlerConfig } from '../server/crawler/config';
import type { MarketBar } from '../server/crawler/types';

const START = 1_704_067_200_000;

function bars(count: number, seed: number): MarketBar[] {
  let price = 100 + seed;
  return Array.from({ length: count }, (_, index) => {
    price *= 1 + Math.sin((index + seed) / 4) * 0.003;
    const volume = 8 + ((index + seed) % 13);
    return {
      openTime: START + index * 300_000,
      open: price / (1 + Math.sin((index + seed) / 4) * 0.003),
      high: price * 1.002,
      low: price * 0.998,
      close: price,
      volume,
      quoteVolume: price * volume,
      takerBuyQuote: price * volume * (0.35 + ((index + seed) % 7) * 0.05)
    };
  });
}

test('the universe drops stables and leveraged tokens and keeps the largest USDT pairs', () => {
  assert.equal(isLeveragedBase('BTCUP'), true);
  assert.equal(isLeveragedBase('BTC'), false);
  const tickers = parseTickerPayload([
    { symbol: 'BTCUSDT', lastPrice: '100', priceChangePercent: '1', quoteVolume: '50' },
    { symbol: 'USDCUSDT', lastPrice: '1', priceChangePercent: '0', quoteVolume: '999' },
    { symbol: 'RLUSDUSDT', lastPrice: '1', priceChangePercent: '0', quoteVolume: '700' },
    { symbol: 'BTCUPUSDT', lastPrice: '2', priceChangePercent: '3', quoteVolume: '800' },
    { symbol: 'ETHUSDT', lastPrice: '10', priceChangePercent: '-1', quoteVolume: '40' },
    { symbol: 'SOLUSDT', lastPrice: '5', priceChangePercent: '2', quoteVolume: '10' },
    { symbol: 'ETHBTC', lastPrice: '0.05', priceChangePercent: '1', quoteVolume: '1000' }
  ]);
  const selected = selectUniverse(tickers, 2).map(item => item.symbol);
  assert.deepEqual(selected, ['BTCUSDT', 'ETHUSDT']);
});

test('a score at time t ignores candles after t', () => {
  const eth = bars(180, 2);
  const btc = bars(180, 1);
  const before = scoreCoin({ symbol: 'ETHUSDT', bars: eth, btcBars: btc, endIndex: 100 });
  const sliced = scoreCoin({ symbol: 'ETHUSDT', bars: eth.slice(0, 101), btcBars: btc.slice(0, 101) });
  assert.equal(before.score, sliced.score);
  assert.equal(before.reason, sliced.reason);
  const shocked = eth.slice();
  shocked[140] = { ...shocked[140], close: shocked[140].close * 3, high: shocked[140].close * 3 };
  const after = scoreCoin({ symbol: 'ETHUSDT', bars: shocked, btcBars: btc, endIndex: 100 });
  assert.equal(after.score, before.score);
});

test('ranking is deterministic and puts the higher score first', () => {
  const low = scoreCoin({ symbol: 'ADAUSDT', bars: bars(80, 1), btcBars: bars(80, 1) });
  const high = { ...low, symbol: 'SOLUSDT', score: low.score + 5 };
  assert.deepEqual(rankScores([low, high]).map(item => item.symbol), ['SOLUSDT', 'ADAUSDT']);
});

test('aggTrade, depth and mempool fixtures stay point-in-time parsers', () => {
  const trade = parseAggTrade({ stream: 'btcusdt@aggTrade', data: { e: 'aggTrade', s: 'BTCUSDT', p: '100000', q: '2', T: 1_700_000_000_000, m: false } });
  assert.ok(trade);
  const print = toWhalePrint(trade!, 100_000);
  assert.equal(print?.side, 'compra');
  assert.equal(print?.usd, 200_000);
  const sell = toWhalePrint({ ...trade!, buyerIsMaker: true }, 100_000);
  assert.equal(whalePressure([print!, sell!]), 0);

  const walls = findWalls('BTCUSDT', parseDepth({
    bids: [['100', '40'], ['99.9', '1'], ['99.8', '1']],
    asks: [['101', '1'], ['101.2', '1']]
  })!);
  assert.ok(walls.some(wall => wall.side === 'compra' && wall.usd === 4000));

  const recent = parseMempoolRecent([{ txid: 'abc', value: 20e8 }, { txid: 'small', value: 1e8 }], 10);
  assert.deepEqual(recent.map(item => item.txid), ['abc']);
  const detail = parseMempoolTransaction({
    status: { block_time: 1_700_000_000 },
    vin: [{ prevout: { scriptpubkey_address: 'from-wallet', value: 20e8 } }],
    vout: [{ scriptpubkey_address: '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo', value: 20e8 }]
  });
  const tagged = tagTransfer('BTC', detail?.from ?? null, detail?.to ?? null);
  assert.equal(tagged.direction, 'entrada na corretora');
  assert.equal(tagged.label, 'Binance');
});

test('the forecaster is asked only for the top N coins', async () => {
  const seen: string[] = [];
  const config = readCrawlerConfig({ CRAWLER_ENABLED: '0', CRAWLER_KRONOS_TOP: '2' } as NodeJS.ProcessEnv);
  const app = new CrawlerRuntime(config, {
    forecaster: {
      ready: () => true,
      predict: async symbol => {
        seen.push(symbol);
        const barsFor = app['bars'].get(symbol);
        const close = barsFor?.[barsFor.length - 1].close ?? 100;
        return [close * 1.01];
      }
    }
  });
  for (const [seed, symbol] of [[1, 'BTCUSDT'], [2, 'ETHUSDT'], [3, 'SOLUSDT'], [4, 'ADAUSDT']] as const) {
    app.setBars(symbol, bars(80, seed));
  }
  const rows = await app.refreshRanks();
  assert.equal(seen.length, 2);
  assert.deepEqual(seen, rows.slice(0, 2).map(row => row.symbol));
  assert.equal(rows[2].kronos, 'fora');
  assert.equal(rows[0].kronos, 'rodou');
});

test('the walk-forward compares three rankings and does not read the future', () => {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'];
  const series = Object.fromEntries(symbols.map((symbol, index) => [symbol, bars(420, index + 1)]));
  const result = runCrawlerBacktest(series, symbols);
  assert.equal(result.variantsTried, 3);
  assert.ok(result.decisions > 0);
  for (const variant of result.variants) {
    for (const horizon of variant.horizons) {
      assert.equal(horizon.decisions, result.decisions);
      assert.ok(horizon.topNetPct !== null);
      assert.ok(horizon.excessPct !== null);
    }
  }
  const cut = series.BTCUSDT[200].openTime;
  const prefix = Object.fromEntries(symbols.map(symbol => [symbol, series[symbol].filter(bar => bar.openTime <= cut)]));
  const fullScore = scoreCoin({
    symbol: 'ETHUSDT',
    bars: series.ETHUSDT,
    btcBars: series.BTCUSDT,
    endIndex: series.ETHUSDT.findIndex(bar => bar.openTime === cut)
  });
  const prefixScore = scoreCoin({
    symbol: 'ETHUSDT',
    bars: prefix.ETHUSDT,
    btcBars: prefix.BTCUSDT
  });
  assert.equal(fullScore.score, prefixScore.score);
});
