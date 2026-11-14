import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDecisions, buildHourFrames, featureVector } from '../server/futures/align';
import { bookOrderFlowImbalance, aggregateAggTrades, hourlyAggFlow } from '../server/futures/flow';
import { listDays, listMonths } from '../server/futures/import-vision';
import { FuturesLiveCollector, publicFuturesPaths } from '../server/futures/live';
import { fitFoldModel, fitLogistic, fitRidge, predictFold, solveLinear } from '../server/futures/model';
import { alignFuturesOverlay, sliceForChart } from '../server/futures/overlay';
import {
  parseAggTradeCsv,
  parseBookDepthCsv,
  parseForceOrder,
  parseFundingCsv,
  parseKlineCsv,
  parseMetricsCsv,
  type BookSnapshot,
  type FundingPrint,
  type KlineBar,
  type MetricsPrint
} from '../server/futures/parse';
import { futuresRoot } from '../server/futures/paths';
import { FUTURES_PROTOCOL, roundTripCost } from '../server/futures/protocol';
import { scoreDecisions } from '../server/futures/study';
import { readJsonl } from '../server/futures/store';
import { runFuturesValidation } from '../server/futures/validate';
import { readZipText } from '../server/futures/zip';
import type { FuturesDecision } from '../server/futures/align';

const HOUR = 3_600_000;

function zip(name: string, text: string): Buffer {
  const raw = Buffer.from(text);
  const compressed = deflateRawSync(raw);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(Buffer.byteLength(name), 26);
  return Buffer.concat([header, Buffer.from(name), compressed]);
}

function kline(index: number, close: number, takerShare = 0.6): KlineBar {
  const openTime = Date.UTC(2024, 10, 1) + index * HOUR;
  return {
    openTime,
    closeTime: openTime + HOUR - 1,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 10,
    takerBuyVolume: 10 * takerShare,
    quoteVolume: close * 10,
    takerBuyQuoteVolume: close * 10 * takerShare
  };
}

function frameInputs(count: number) {
  const klines = Array.from({ length: count }, (_, index) => kline(index, 100 + index));
  const funding: FundingPrint[] = [];
  for (let time = klines[0].openTime; time <= klines[count - 1].closeTime; time += 8 * HOUR) {
    funding.push({ time, rate: 0.0001, intervalHours: 8 });
  }
  const metrics: MetricsPrint[] = [];
  const book: BookSnapshot[] = [];
  for (const bar of klines) {
    const time = bar.closeTime - 60_000;
    metrics.push({
      time,
      openInterest: 1000 + bar.openTime / HOUR,
      openInterestValue: 1_000_000 + bar.openTime / 10,
      longShortRatio: 1.2,
      topAccountRatio: 1.1,
      topPositionRatio: 1.05,
      takerLongShortRatio: 0.9
    });
    book.push({ time, imbalance: 0.1 });
  }
  return { klines, funding, metrics, book };
}

test('DATA_DIR puts futures under /data and an explicit directory wins', () => {
  assert.equal(futuresRoot({}), join('data', 'futures'));
  assert.equal(futuresRoot({ DATA_DIR: '/data' }), join('/data', 'futures'));
  assert.equal(futuresRoot({ DATA_DIR: '/data', FUTURES_DIR: '/tmp/futures' }), '/tmp/futures');
});

test('the frozen futures rule is the one the trial log will store', () => {
  assert.equal(FUTURES_PROTOCOL.registeredAt, '2026-11-14T14:30:00.000Z');
  assert.equal(FUTURES_PROTOCOL.horizonHours, 4);
  assert.equal(FUTURES_PROTOCOL.probabilityLong, 0.55);
  assert.equal(FUTURES_PROTOCOL.probabilityShort, 0.45);
  assert.equal(FUTURES_PROTOCOL.fundingShortAbove, 0.0003);
  assert.equal(FUTURES_PROTOCOL.fundingLongBelow, -0.0001);
  assert.ok(Math.abs(roundTripCost() - 0.0012) < 1e-12);
  assert.equal(FUTURES_PROTOCOL.features.length, 13);
  assert.deepEqual(FUTURES_PROTOCOL.symbols, ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
});

test('zip reader inflates a one-file archive', () => {
  const text = readZipText(zip('sample.csv', 'calc_time,last_funding_rate\n1000,0.0001\n'));
  assert.equal(text.name, 'sample.csv');
  assert.match(text.text, /0\.0001/);
});

test('parsers keep public futures rows and ignore a broken line', () => {
  const funding = parseFundingCsv('calc_time,funding_interval_hours,last_funding_rate\n1000,8,0.0002\nbad,8,nope\n');
  assert.equal(funding.length, 1);
  assert.equal(funding[0].rate, 0.0002);
  const metrics = parseMetricsCsv([
    'create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio',
    '2024-11-01 00:00:00,BTCUSDT,10,20,1.1,1.2,1.3,0.8'
  ].join('\n'));
  assert.equal(metrics[0].time, Date.parse('2024-11-01T00:00:00.000Z'));
  assert.equal(metrics[0].longShortRatio, 1.3);
  const bars = parseKlineCsv('open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore\n1000,1,2,1,1.5,10,1999,15,3,4,6,0\n');
  assert.equal(bars[0].takerBuyVolume, 4);
  const trades = parseAggTradeCsv('agg_trade_id,price,quantity,first_trade_id,last_trade_id,transact_time,is_buyer_maker\n7,100,2,1,1,5000,true\n8,100,1,2,2,6000,false\n');
  const flow = aggregateAggTrades(trades);
  assert.equal(flow.sellQuantity, 2);
  assert.equal(flow.buyQuantity, 1);
  assert.equal(flow.cvd, -1);
  const hours = hourlyAggFlow(trades, HOUR);
  assert.equal(hours.length, 1);
  const book = parseBookDepthCsv('timestamp,percentage,depth,notional\n2024-11-01 00:10:00,-1,1,30\n2024-11-01 00:10:00,1,1,10\n2024-11-01 00:40:00,-1,1,10\n2024-11-01 00:40:00,1,1,30\n');
  assert.equal(book.length, 1);
  assert.equal(book[0].time, Date.parse('2024-11-01T00:40:00.000Z'));
  assert.ok(book[0].imbalance < 0);
  const forced = parseForceOrder({ e: 'forceOrder', o: { s: 'BTCUSDT', S: 'SELL', z: '0.2', ap: '100', T: 50 } });
  assert.equal(forced?.side, 'SELL');
  assert.equal(parseForceOrder({ o: { s: 'NO', S: 'SELL', z: '1', ap: '1', T: 1 } }), null);
});

test('book imbalance adds size on the bid and subtracts size on the ask', () => {
  const previous = { bidPrice: 100, bidQty: 5, askPrice: 101, askQty: 4 };
  const samePrice = bookOrderFlowImbalance(previous, { ...previous, bidQty: 7 });
  assert.equal(samePrice, 2);
  const lifted = bookOrderFlowImbalance(previous, { bidPrice: 101, bidQty: 3, askPrice: 102, askQty: 4 });
  assert.equal(lifted, 7);
});

test('a print after the candle close is invisible to the feature row', () => {
  const { klines, funding, metrics, book } = frameInputs(30);
  const frames = buildHourFrames({ klines, funding, metrics, book });
  const before = featureVector(klines, frames, 24);
  assert.ok(before);
  assert.equal(before.length, FUTURES_PROTOCOL.features.length);
  assert.equal(before[3], 0.0001);
  const leaked = metrics.slice();
  leaked.push({ ...metrics[24], time: klines[24].closeTime + 1, longShortRatio: 9 });
  const afterLeak = featureVector(klines, buildHourFrames({ klines, funding, metrics: leaked, book }), 24);
  assert.deepEqual(afterLeak, before);
  const visible = metrics.map((row, index) => index === 24 ? { ...row, longShortRatio: 2.5 } : row);
  const changed = featureVector(klines, buildHourFrames({ klines, funding, metrics: visible, book }), 24);
  assert.notEqual(changed?.[7], before[7]);
  const staleFunding = funding.filter(print => print.time < klines[24].closeTime - 20 * HOUR);
  const stale = featureVector(klines, buildHourFrames({ klines, funding: staleFunding, metrics, book }), 24);
  assert.equal(stale, null);
  const futureBar = kline(30, 999);
  const extended = featureVector([...klines, futureBar], buildHourFrames({
    klines: [...klines, futureBar],
    funding,
    metrics,
    book
  }), 24);
  assert.deepEqual(extended, before);
});

test('decisions use a 4h label and stay on the UTC anchor', () => {
  const count = 48;
  const { klines, funding, metrics, book } = frameInputs(count);
  const decisions = buildDecisions({ klines, frames: buildHourFrames({ klines, funding, metrics, book }), funding });
  assert.ok(decisions.length >= 4);
  for (const row of decisions) {
    assert.equal(new Date(row.openTime).getUTCHours() % 4, 0);
    assert.equal(row.features.length, 13);
    assert.ok(row.priceReturn !== 0);
  }
  const overlay = alignFuturesOverlay({
    candleTimes: [klines[10].openTime],
    intervalMs: HOUR,
    funding: [{ time: klines[10].closeTime + 1, rate: 0.01 }],
    openInterest: [{ time: klines[10].closeTime - 1, value: 42 }]
  });
  assert.equal(overlay[0].fundingBps, null);
  assert.equal(overlay[0].openInterest, 42);
  const kept = sliceForChart([{ time: 10, rate: 0.0002 }, { time: 50, rate: 0.0003 }], 100, 200);
  assert.deepEqual(kept.map(row => row.time), [50]);
  const inside = sliceForChart([{ time: 10, rate: 0.0002 }, { time: 150, rate: 0.0004 }], 100, 200);
  assert.deepEqual(inside.map(row => row.time), [10, 150]);
});

test('logistic and ridge recover a separable line, and a test label does not move earlier forecasts', () => {
  const rows = [
    ...Array.from({ length: 20 }, () => [-2]),
    ...Array.from({ length: 20 }, () => [2])
  ];
  const labels = [...Array.from({ length: 20 }, () => 0), ...Array.from({ length: 20 }, () => 1)];
  const model = fitFoldModel(rows, labels, labels.map(label => label === 1 ? 0.02 : -0.02), 1, 1, 25);
  assert.ok(model);
  const up = predictFold(model, [2]);
  const down = predictFold(model, [-2]);
  assert.ok(up.probabilityUp > 0.8);
  assert.ok(down.probabilityUp < 0.2);
  assert.ok(up.expectedReturn > 0);
  assert.ok(down.expectedReturn < 0);
  const solved = solveLinear([[2, 0], [0, 4]], [2, 8]);
  assert.ok(solved);
  assert.ok(Math.abs(solved[0] - 1) < 1e-9);
  assert.ok(Math.abs(solved[1] - 2) < 1e-9);
  const direct = fitLogistic(rows.map(row => [1, row[0]]), labels, 1, 25);
  const ridge = fitRidge([[1, 1], [1, 2], [1, 3]], [2, 4, 6], 0.0001);
  assert.ok(direct && ridge);

  const decisions: FuturesDecision[] = Array.from({ length: 120 }, (_, index) => {
    const upMove = index % 2 === 0;
    const features = new Array<number>(13).fill(0);
    features[0] = upMove ? 2 : -2;
    features[3] = 0.0001;
    const openTime = Date.UTC(2024, 10, 1) + index * 4 * HOUR;
    return {
      openTime,
      closeTime: openTime + HOUR - 1,
      entry: 100,
      exit: upMove ? 101 : 99,
      priceReturn: upMove ? 0.01 : -0.01,
      fundingPaidByLong: 0.0001,
      features
    };
  });
  const first = scoreDecisions('BTCUSDT', decisions);
  assert.ok(first.scored.length >= 20);
  const original = first.scored.map(row => row.probabilityUp);
  const mutated = decisions.map((row, index) => index < decisions.length - 5
    ? row
    : { ...row, priceReturn: -row.priceReturn, exit: row.priceReturn > 0 ? 99 : 101 });
  const second = scoreDecisions('BTCUSDT', mutated);
  assert.deepEqual(second.scored.map(row => row.probabilityUp), original);
  assert.equal(first.strategies.length, 3);
  assert.ok(first.strategies.every(strategy => strategy.returns.length === first.scored.length));
  assert.equal(first.strategies[0].family, 'futuros-btcusdt');
  assert.equal(first.strategies[2].hasProbability, false);
  assert.ok(first.strategies[0].returns.some(value => value !== 0));
});

test('public futures requests carry no credential', () => {
  const paths = publicFuturesPaths('BTCUSDT', 10);
  assert.ok(paths.length >= 8);
  for (const item of paths) {
    assert.equal(/apiKey|signature|secret|BINANCE_/i.test(item.path), false);
    assert.match(item.path, /^\/(fapi\/v1|futures\/data)\//);
  }
});

test('the live collector stores public prints and records a closed liquidation endpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'futures-live-'));
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    assert.equal(/apiKey|signature|secret/i.test(url), false);
    const body = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status });
    if (url.includes('allForceOrders')) return body({ code: 0, msg: 'restricted' }, 451);
    if (url.includes('fundingRate')) return body([{ symbol: 'BTCUSDT', fundingTime: 1_700_000_000_000, fundingRate: '0.0001' }]);
    if (url.includes('openInterestHist')) return body([{ symbol: 'BTCUSDT', sumOpenInterest: '12', sumOpenInterestValue: '99', timestamp: 1_700_000_000_000 }]);
    if (url.includes('/openInterest')) return body({ symbol: 'BTCUSDT', openInterest: '12', time: 1_700_000_000_000 });
    if (url.includes('globalLongShort')) return body([{ longShortRatio: '1.4', timestamp: 1_700_000_000_000 }]);
    if (url.includes('takerlongshort')) return body([{ buySellRatio: '0.8', timestamp: 1_700_000_000_000 }]);
    if (url.includes('aggTrades')) return body([{ a: 10, p: '100', q: '0.5', T: 1_700_000_000_000, m: false }]);
    if (url.includes('/depth')) return body({ bids: [['100', '2']], asks: [['101', '1']] });
    return body({}, 404);
  };
  const collector = new FuturesLiveCollector({
    enabled: true,
    symbols: ['BTCUSDT'],
    restBase: 'https://fapi.binance.com',
    wsBase: '',
    refreshMs: 60_000,
    root
  }, { fetchImpl });
  await collector.cycle();
  await collector.cycle();
  const funding = readJsonl<{ rate: number }>(join(root, 'live', 'BTCUSDT', 'funding.jsonl'));
  assert.equal(funding.length, 1);
  assert.equal(funding[0].rate, 0.0001);
  const interest = readJsonl<{ openInterest: number }>(join(root, 'live', 'BTCUSDT', 'open-interest.jsonl'));
  assert.equal(interest.length, 1);
  assert.equal(interest[0].openInterest, 12);
  const status = collector.status();
  assert.equal(status.tradesSeen.BTCUSDT, 1);
  assert.match(status.liquidations, /451/);
  assert.equal(status.lastOkAt !== null, true);
  assert.ok(calls.some(url => url.includes('/fapi/v1/fundingRate')));
  collector.stop();
});

test('futures routes are GET and the legacy execution module stays out of the server', () => {
  const source = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/futures\/overlay'/);
  assert.match(source, /app\.get\('\/api\/futures\/status'/);
  assert.equal(source.includes("app.post('/api/futures"), false);
  assert.equal(source.includes('order_execution'), false);
  assert.match(source, /futuresLive\.start\(\)/);
});

test('validation of an empty futures folder stays inconclusive and does not invent a return', () => {
  const root = mkdtempSync(join(tmpdir(), 'futures-empty-'));
  const reportDir = mkdtempSync(join(tmpdir(), 'futures-report-'));
  const trialLog = join(reportDir, 'trial-log.jsonl');
  const report = runFuturesValidation({
    root,
    trialLog,
    reportDirectory: reportDir,
    symbols: ['BTCUSDT']
  });
  const rows = report.strategies.filter(strategy => strategy.id.startsWith('futuros-btcusdt'));
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.verdict === 'inconclusiva' && row.metrics === null));
  const trials = readFileSync(trialLog, 'utf8').trim().split('\n');
  assert.equal(trials.length, 3);
  assert.ok(trials.every(line => JSON.parse(line).sharpe === null));
  assert.equal(listMonths(Date.parse('2024-11-01T00:00:00.000Z'), Date.parse('2026-11-01T00:00:00.000Z'))[0], '2024-11');
  assert.equal(listDays(Date.parse('2024-11-01T00:00:00.000Z'), Date.parse('2024-11-03T00:00:00.000Z')).join(','), '2024-11-01,2024-11-02');
});
