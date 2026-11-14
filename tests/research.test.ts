import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalCandle } from '../shared/types';
import { paperDecisionDue, selectPaperStrategy } from '../server/paper-strategy';
import { buildStudyRecords, directionStats, promotionDecision, researchAction, simulateDecisions, tuneInSample } from '../server/research-eval';
import { CURRENT_RULE, OOS_START_MS, embargoSplit, tuneGridSize } from '../server/research-protocol';
import { buildSummary, renderResearchMarkdown, ResearchReport } from '../server/research-report';
import { binomialSurvivalHalf } from '../server/research-stats';

test('binomial survival matches the exact coin-flip tail', () => {
  assert.ok(Math.abs(binomialSurvivalHalf(8, 10) - 56 / 1024) < 1e-10);
  assert.ok(Math.abs(binomialSurvivalHalf(10, 10) - 1 / 1024) < 1e-12);
  assert.equal(binomialSurvivalHalf(0, 10), 1);
  assert.ok(binomialSurvivalHalf(50, 100) > 0.5);
});

test('the promoted paper rule decides on the study stride, not on every candle', () => {
  const promoted = { id: 'pesquisa' as const };
  assert.equal(paperDecisionDue({ id: 'atual' }, 1, 12), true);
  assert.equal(paperDecisionDue(promoted, 11, 12), false);
  assert.equal(paperDecisionDue(promoted, 12, 12), true);
  assert.equal(paperDecisionDue(promoted, 24, 12), true);
});

test('overlapping direction records do not use a coin-flip tail on every row', () => {
  const records = Array.from({ length: 12 }, (_, index) => ({ index, directionHit: true }));
  const naive = binomialSurvivalHalf(12, 12);
  const aware = directionStats(records, { horizon: 6, stride: 2 });
  assert.ok(naive < 0.01);
  assert.equal(aware.independentCompared, 2);
  assert.ok((aware.pValue ?? 0) >= 0.25);
  assert.equal(aware.pValueMethod, 'binomial-and-block-bootstrap');
});

test('the embargo keeps tuning outcomes on the in-sample side of the cut', () => {
  const cut = OOS_START_MS;
  assert.equal(embargoSplit(cut - 10_000, cut - 1, cut), 'in_sample');
  assert.equal(embargoSplit(cut, cut + 10_000, cut), 'out_of_sample');
  assert.equal(embargoSplit(cut - 10_000, cut + 1, cut), 'embargo');
});

test('a forecast is held when the samples disagree or the move does not clear the gate', () => {
  const base = {
    close: 100,
    predictedReturnBps: 80,
    dispersionBps: 10,
    atr: 0.2,
    ema9: 11,
    ema20: 10
  };
  assert.equal(researchAction(base, CURRENT_RULE), 'BUY');
  assert.equal(researchAction({ ...base, dispersionBps: 40 }, { ...CURRENT_RULE, maxDispersionBps: 25 }), 'HOLD');
  assert.equal(researchAction({ ...base, predictedReturnBps: 10 }, CURRENT_RULE), 'HOLD');
  assert.equal(researchAction({ ...base, ema9: 9 }, CURRENT_RULE), 'HOLD');
  assert.equal(researchAction({ ...base, predictedReturnBps: 20, atr: 1 }, { ...CURRENT_RULE, minMoveBps: 10, atrMultiple: 1.5 }), 'HOLD');
  assert.equal(researchAction({ ...base, rsi14: 75 }, CURRENT_RULE), 'HOLD');
  assert.equal(researchAction({ ...base, rsi14: 50 }, CURRENT_RULE), 'BUY');
  assert.equal(researchAction({
    ...base,
    predictedReturnBps: -80,
    ema9: 9,
    ema20: 10,
    rsi14: 25
  }, CURRENT_RULE), 'HOLD');
  assert.equal(researchAction({
    ...base,
    predictedReturnBps: -80,
    ema9: 9,
    ema20: 10,
    rsi14: 25
  }, { ...CURRENT_RULE, rsiBuyMax: undefined, rsiSellMin: undefined }), 'SELL');
});

test('study records drop the embargo and do not take the forecast from future candles', () => {
  const interval = 3_600_000;
  const start = OOS_START_MS - 30 * interval;
  const candles: CanonicalCandle[] = [];
  for (let i = 0; i < 40; i++) {
    const openTime = start + i * interval;
    const close = 100 + i;
    candles.push({
      venue: 'binance', symbol: 'BTCUSDT', interval: '1h', openTime,
      closeTime: openTime + interval - 1, open: close - 1, high: close + 1, low: close - 2, close,
      volume: 1, quoteVolume: close, source: 'historical', ingestedAt: openTime
    });
  }
  const forecasts = new Map<number, { openTime: number; meanCloses: number[]; sampleEnds: number[] }>();
  for (let index = 20; index < 36; index++) {
    forecasts.set(candles[index].openTime, {
      openTime: candles[index].openTime,
      meanCloses: [candles[index].close, candles[index].close + 1],
      sampleEnds: [candles[index].close + 1, candles[index].close + 1]
    });
  }
  const records = buildStudyRecords(candles, forecasts, { context: 10, horizon: 2, stride: 1 }, OOS_START_MS);
  assert.ok(records.every(record => record.split !== 'in_sample' || record.outcomeOpenTime < OOS_START_MS));
  assert.ok(records.every(record => record.split !== 'out_of_sample' || record.openTime >= OOS_START_MS));
  const sample = records[0];
  const original = sample.predictedReturnBps;
  candles[sample.index + 2].close = 1;
  const again = buildStudyRecords(candles, forecasts, { context: 10, horizon: 2, stride: 1 }, OOS_START_MS);
  assert.equal(again[0].predictedReturnBps, original);
  assert.equal(again[0].actualEnd, 1);
});

test('in-sample equity stops at the cut instead of riding a later crash', () => {
  const interval = 3_600_000;
  const candles: CanonicalCandle[] = [];
  for (let i = 0; i < 30; i++) {
    const openTime = OOS_START_MS - 20 * interval + i * interval;
    const close = i < 22 ? 100 : 40;
    candles.push({
      venue: 'binance', symbol: 'BTCUSDT', interval: '1h', openTime,
      closeTime: openTime + interval - 1, open: close, high: close, low: close, close,
      volume: 1, source: 'historical', ingestedAt: openTime
    });
  }
  const scheduled = new Map<number, 'BUY' | 'SELL' | 'HOLD'>([[1, 'BUY']]);
  const contained = simulateDecisions(candles, scheduled, 'long_short', interval, undefined, 'teste', 22);
  const leaked = simulateDecisions(candles, scheduled, 'long_short', interval, undefined, 'teste', candles.length);
  assert.ok(contained.returnPct > -5);
  assert.ok(leaked.returnPct < -30);
});

test('long-only simulation does not open a short', () => {
  const interval = 3_600_000;
  const candles: CanonicalCandle[] = [0, 1, 2].map(i => {
    const openTime = 1_700_000_000_000 + i * interval;
    return {
      venue: 'binance', symbol: 'BTCUSDT', interval: '1h', openTime,
      closeTime: openTime + interval - 1, open: 100, high: 101, low: 99, close: 100,
      volume: 1, source: 'historical', ingestedAt: openTime
    };
  });
  const metrics = simulateDecisions(candles, new Map([[0, 'SELL']]), 'long_only', interval);
  assert.equal(metrics.closedTrades, 0);
  assert.equal(metrics.returnPct, 0);
});

test('tuning count is the full pre-registered grid and ignores records it is not given', () => {
  assert.equal(tuneGridSize(), 108);
  const interval = 3_600_000;
  const candles: CanonicalCandle[] = [];
  for (let i = 0; i < 80; i++) {
    const openTime = OOS_START_MS - 90 * interval + i * interval;
    const close = 100 + i * 0.05;
    candles.push({
      venue: 'binance', symbol: 'BTCUSDT', interval: '1h', openTime,
      closeTime: openTime + interval - 1, open: close, high: close + 0.1, low: close - 0.1, close,
      volume: 1, source: 'historical', ingestedAt: openTime
    });
  }
  const forecasts = new Map<number, { openTime: number; meanCloses: number[]; sampleEnds: number[] }>();
  for (let index = 30; index < 70; index++) {
    const close = candles[index].close;
    forecasts.set(candles[index].openTime, {
      openTime: candles[index].openTime,
      meanCloses: Array(6).fill(close * 1.01),
      sampleEnds: [close * 1.009, close * 1.01, close * 1.011, close * 1.012]
    });
  }
  const records = buildStudyRecords(candles, forecasts, { context: 20, horizon: 6, stride: 1 }, OOS_START_MS + 10 * interval);
  const inSample = records.filter(record => record.split === 'in_sample');
  const first = tuneInSample(candles, inSample, interval, candles.length);
  const second = tuneInSample(candles, inSample, interval, candles.length);
  assert.equal(first.tried, 108);
  assert.deepEqual(first.params, second.params);
});

test('promotion stays off unless direction, return, and trade count all pass', () => {
  const weak = promotionDecision('BTCUSDT', '1h', { hits: 50, compared: 100, accuracy: 0.5, pValue: 0.5 }, null, null);
  assert.equal(weak.promoteToPaper, false);
  const otherSeries = promotionDecision('ETHUSDT', '1h', { hits: 80, compared: 100, accuracy: 0.8, pValue: 0.001 }, {
    label: 'escolhida-na-amostra', returnPct: 5, maxDrawdownPct: 2, sharpe: 1, closedTrades: 30, wins: 20, winRatePct: 66, feesPaid: 1, endingEquity: 10500
  }, {
    label: 'comprar-e-segurar', returnPct: 1, maxDrawdownPct: 3, sharpe: 0.2, closedTrades: 1, wins: 1, winRatePct: 100, feesPaid: 1, endingEquity: 10100
  });
  assert.equal(otherSeries.promoteToPaper, false);
  const passed = promotionDecision('BTCUSDT', '1h', { hits: 80, compared: 100, accuracy: 0.8, pValue: 0.001 }, {
    label: 'escolhida-na-amostra', returnPct: 5, maxDrawdownPct: 2, sharpe: 1, closedTrades: 30, wins: 20, winRatePct: 66, feesPaid: 1, endingEquity: 10500
  }, {
    label: 'comprar-e-segurar', returnPct: 1, maxDrawdownPct: 3, sharpe: 0.2, closedTrades: 1, wins: 1, winRatePct: 100, feesPaid: 1, endingEquity: 10100
  });
  assert.equal(passed.promoteToPaper, true);
});

test('the markdown summary states the multiple-testing count and that no order was sent', () => {
  const report = {
    generatedAt: '2026-11-12T00:00:00.000Z',
    disclaimer: 'Pesquisa. Nenhuma ordem real foi enviada.',
    summaryPt: '',
    promoteToPaper: false,
    promotionReasons: ['O p-valor ficou alto.'],
    tunedParams: null,
    tunedInSample: null,
    tuning: { tried: 108, eligible: 10, series: 'BTCUSDT 1h' },
    multipleTesting: { inSampleConfigs: 108, outOfSampleDirectionTests: 9, primaryAlpha: 0.05, bonferroniAlpha: 0.05 / 9 },
    directional: [{ symbol: 'BTCUSDT', interval: '1h', split: 'out_of_sample', hits: 40, compared: 80, accuracy: 0.5, pValue: 0.54, mae: 10 }],
    rows: [
      { symbol: 'BTCUSDT', interval: '1h', split: 'out_of_sample', strategy: 'escolhida-na-amostra', returnPct: -3, maxDrawdownPct: 8, sharpe: -0.4, closedTrades: 12, winRatePct: 40 },
      { symbol: 'BTCUSDT', interval: '1h', split: 'out_of_sample', strategy: 'comprar-e-segurar', returnPct: -1, maxDrawdownPct: 6, sharpe: -0.2, closedTrades: 1, winRatePct: 0 }
    ],
    datasets: [],
    sampling: { context: 256, sampleCount: 4, specs: [] },
    limitations: ['Isto não é conselho de investimento e nenhuma ordem real foi enviada.']
  } as ResearchReport;
  report.summaryPt = buildSummary(report);
  const markdown = renderResearchMarkdown(report);
  assert.match(markdown, /108 combinações/);
  assert.match(markdown, /nenhuma ordem real foi enviada/i);
  assert.match(report.summaryPt, /-3\.00%/);
  assert.match(report.summaryPt, /-1\.00%/);
});

test('pesquisa is optional and stays off when the study did not promote it', () => {
  const params = { ...CURRENT_RULE, id: 'escolhida-na-amostra' };
  assert.equal(selectPaperStrategy(undefined, { promoteToPaper: true, tunedParams: params }, { symbol: 'BTCUSDT', interval: '1h' }).id, 'atual');
  assert.equal(selectPaperStrategy('pesquisa', { promoteToPaper: false, tunedParams: params }, { symbol: 'BTCUSDT', interval: '1h' }).id, 'atual');
  assert.equal(selectPaperStrategy('pesquisa', { promoteToPaper: true, tunedParams: params }, { symbol: 'BTCUSDT', interval: '5m' }).id, 'atual');
  assert.equal(selectPaperStrategy('pesquisa', { promoteToPaper: true, tunedParams: params }, { symbol: 'BTCUSDT', interval: '1h' }).id, 'pesquisa');
});
