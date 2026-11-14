import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brierScore, climatologyBrier, displayedForecastProbability, reliabilityCurve } from '../server/calibration';
import { loadForecastCache, appendForecastCache } from '../server/forecast-cache';
import { equityPath } from '../server/validation/accounting';
import { spearman } from '../server/validation/correlation';
import { directionTest } from '../server/validation/dependence';
import { recordedM2Dataset } from '../server/validation/m2-dataset';
import { standardNormalCdf, standardNormalQuantile } from '../server/validation/normal';
import { probabilityOfBacktestOverfitting } from '../server/validation/pbo';
import { kronosSeriesFromForecasts, kronosStrategyPlan, parseStrategyFlag } from '../server/validation/kronos-run';
import { decideVerdict, VERDICT_RULES } from '../server/validation/protocol';
import { renderValidationMarkdown, replaceStrategy, ValidationReport } from '../server/validation/report';
import { deflatedSharpeRatio, expectedMaximumSharpe, probabilisticSharpeRatio, sharpeRatio } from '../server/validation/sharpe';
import { combinatorialPurgedFolds, purgedTrainIndexes, walkForwardFolds } from '../server/validation/splits';
import { selectNormalizedSnapshot } from '../server/validation/snapshot';
import { readTrials, trialCount, upsertTrial } from '../server/validation/trials';
import { series } from './fixtures';

test('normal cdf and quantile match published anchors', () => {
  assert.ok(Math.abs(standardNormalCdf(0) - 0.5) < 1e-4);
  assert.ok(Math.abs(standardNormalCdf(1) - 0.841344746) < 1e-4);
  assert.ok(Math.abs(standardNormalQuantile(0.975) - 1.959963984) < 1e-4);
  assert.ok(Math.abs(standardNormalCdf(standardNormalQuantile(0.9)) - 0.9) < 1e-3);
});

test('a zero Sharpe has PSR 0.5 and more trials raise the deflated benchmark', () => {
  const flat = probabilisticSharpeRatio(0, 0, 50, 0, 3);
  assert.ok(flat !== null && Math.abs(flat - 0.5) < 1e-9);
  assert.equal(expectedMaximumSharpe(1, 1), 0);
  const few = expectedMaximumSharpe(2, 0.2);
  const many = expectedMaximumSharpe(50, 0.2);
  assert.ok(many > few);
  const returns = Array.from({ length: 80 }, (_, index) => (index % 2 === 0 ? 0.02 : -0.005));
  const one = deflatedSharpeRatio({ returns, trials: 1, skew: 0, kurtosis: 3 });
  const crowd = deflatedSharpeRatio({ returns, trials: 40, skew: 0, kurtosis: 3 });
  assert.ok(one.value !== null && crowd.value !== null);
  assert.ok(crowd.value < one.value);
  assert.equal(crowd.dispersionSource, 'erro-padrao');
  const observed = sharpeRatio(returns);
  assert.ok(observed !== null && observed > 0);
});

test('recorded trial Sharpes replace the standard-error dispersion', () => {
  const returns = Array.from({ length: 40 }, (_, index) => (index % 3 === 0 ? 0.01 : -0.002));
  const result = deflatedSharpeRatio({
    returns,
    trials: 3,
    recordedSharpes: [0.2, 0.05, 0.01],
    skew: 0,
    kurtosis: 3
  });
  assert.equal(result.dispersionSource, 'desvio-entre-tentativas');
  assert.equal(result.trials, 3);
  assert.ok(result.value !== null && result.value > 0 && result.value < 1);
});

test('CSCV PBO is 1 for a split that reverses and 0 for a strategy that wins every block', () => {
  const up = [0.02, 0.01, 0.02, 0.01, 0.02, 0.01, 0.02, 0.01];
  const down = up.map(value => -value);
  const overfit: number[][] = [];
  for (const value of up) overfit.push([value, -value]);
  for (const value of down) overfit.push([value, -value]);
  const bad = probabilityOfBacktestOverfitting(overfit);
  assert.equal(bad.probability, 1);
  const skill: number[][] = [];
  for (let index = 0; index < 16; index++) skill.push([up[index % 8], down[index % 8]]);
  const good = probabilityOfBacktestOverfitting(skill);
  assert.equal(good.probability, 0);
});

test('purge drops labels that reach the test and the embargo after it', () => {
  const train = purgedTrainIndexes(20, [8, 9, 10], 3, 2);
  assert.equal(train.includes(5), false);
  assert.equal(train.includes(4), true);
  assert.equal(train.includes(11), false);
  assert.equal(train.includes(12), false);
  assert.equal(train.includes(13), true);
  const folds = walkForwardFolds({ count: 20, groups: 4, minTrainGroups: 2, horizon: 3, embargo: 2 });
  assert.equal(folds.length, 2);
  for (const fold of folds) {
    const testStart = Math.min(...fold.test);
    assert.ok(fold.train.every(index => index < testStart));
    assert.ok(fold.train.every(index => index + 3 < testStart));
  }
  const cpcv = combinatorialPurgedFolds({ count: 12, groups: 4, testGroups: 2, horizon: 2, embargo: 1 });
  assert.equal(cpcv.length, 6);
  for (const fold of cpcv) {
    const test = new Set(fold.test);
    for (const index of fold.train) {
      assert.equal(test.has(index), false);
      const labelEnd = index + 2;
      const overlaps = fold.test.some(point => index <= point && labelEnd >= point);
      assert.equal(overlaps, false);
    }
  }
});

test('overlapping hits keep the binomial on the non-overlapping subset', () => {
  const records = Array.from({ length: 9 }, (_, index) => ({ index, hit: true }));
  const result = directionTest(records, { horizon: 4, stride: 1 }, 99);
  assert.equal(result.independentCompared, 3);
  assert.equal(result.method, 'binomial-and-block-bootstrap');
  assert.ok((result.pValue ?? 0) >= (result.independentPValue ?? 0));
});

test('spearman is 1 for a monotone pair and undefined for a constant', () => {
  assert.ok(Math.abs((spearman([1, 2, 3, 4], [10, 20, 30, 40]) ?? 0) - 1) < 1e-12);
  assert.equal(spearman([1, 1, 1], [1, 2, 3]), null);
});

test('brier and the reliability curve ignore a one-path forecast', () => {
  const rows = [
    { pUp: 0.2, wentUp: false },
    { pUp: 0.8, wentUp: true }
  ];
  assert.ok((brierScore(rows) ?? 1) < (climatologyBrier(rows) ?? 0));
  const curve = reliabilityCurve(rows, 5);
  assert.equal(curve.length, 5);
  assert.equal(displayedForecastProbability({ sampleCount: 1, pUp: 1 }).pUp, undefined);
  assert.equal(displayedForecastProbability({ sampleCount: 1, pUp: 1 }).probabilityNote, 'sem amostras suficientes');
  assert.equal(displayedForecastProbability({ sampleCount: 4, pUp: 0.25, probabilityAvailable: true }).pUp, 0.25);
});

test('verdicts follow the gates fixed before the run', () => {
  const base = {
    independentDecisions: 40,
    returnObservations: 40,
    excessReturn: 0.02,
    trainExcessReturn: 0.01,
    perPeriodSharpe: 0.2,
    deflatedSharpe: 0.97,
    probabilityOfOverfit: 0.2,
    directionPValue: 0.01,
    hasDirection: true,
    brier: null,
    climatologyBrier: null,
    hasProbability: false
  };
  assert.equal(decideVerdict(base).label, 'aprovada');
  assert.equal(decideVerdict({ ...base, independentDecisions: 10 }).label, 'inconclusiva');
  assert.match(decideVerdict({ ...base, perPeriodSharpe: null, independentDecisions: 0 }).reason, /não varia/);
  assert.equal(decideVerdict({ ...base, trainExcessReturn: 0.05, excessReturn: -0.01 }).label, 'reprovada (provável sorte/overfit)');
  assert.equal(decideVerdict({ ...base, probabilityOfOverfit: 0.8 }).label, 'reprovada (provável sorte/overfit)');
  assert.equal(decideVerdict({
    ...base,
    excessReturn: -0.0741,
    trainExcessReturn: -0.3556,
    perPeriodSharpe: -0.136,
    deflatedSharpe: 0.007,
    probabilityOfOverfit: 0.002,
    directionPValue: 0.222,
    independentDecisions: 138,
    returnObservations: 138
  }).label, 'reprovada');
  assert.equal(decideVerdict({
    ...base,
    excessReturn: -0.28,
    trainExcessReturn: -0.26,
    perPeriodSharpe: -0.5,
    deflatedSharpe: 0,
    probabilityOfOverfit: 0.013,
    directionPValue: 0.84,
    independentDecisions: 168,
    returnObservations: 169
  }).label, 'reprovada');
  assert.equal(decideVerdict({
    ...base,
    returnObservations: 12,
    independentDecisions: 12,
    perPeriodSharpe: -0.2,
    excessReturn: -0.1
  }).label, 'inconclusiva');
});

test('a repeated buy does not pay the fee twice', () => {
  const bars = [
    { open: 100, close: 100 },
    { open: 100, close: 110 },
    { open: 110, close: 120 }
  ];
  const costs = { feeRate: 0.001, slippageRate: 0, positionFraction: 1 };
  const once = equityPath(bars, new Map([[1, 'BUY']]), 'long_short', costs);
  const twice = equityPath(bars, new Map([[1, 'BUY'], [2, 'BUY']]), 'long_short', costs);
  assert.equal(twice[2], once[2]);
  assert.ok(once[2] > once[0]);
});

test('snapshot selection filters by symbol and interval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kronos-snap-'));
  const btc = { symbol: 'BTCUSDT', interval: '1h', openTime: 1 };
  const eth = { symbol: 'ETHUSDT', interval: '1h', openTime: 1 };
  writeFileSync(join(dir, 'zzz-ETHUSDT.jsonl'), JSON.stringify(eth) + '\n');
  writeFileSync(join(dir, 'aaa-BTCUSDT.jsonl'), JSON.stringify(btc) + '\n');
  const chosen = selectNormalizedSnapshot({ dir, symbol: 'BTCUSDT', interval: '1h' });
  assert.equal(JSON.parse(readFileSync(chosen, 'utf8').split('\n')[0]).symbol, 'BTCUSDT');
  assert.throws(() => selectNormalizedSnapshot({ dir, symbol: 'SOLUSDT', interval: '1h' }));
});

test('the M2 comparison refuses a dataset the report did not name', () => {
  assert.throws(() => recordedM2Dataset({ datasets: [] }, 'BTCUSDT', '1h'), /não registra/);
  const named = recordedM2Dataset({
    datasets: [{ symbol: 'BTCUSDT', interval: '1h', normalizedPath: 'data/one.jsonl', normalizedSha256: 'abc' }]
  }, 'BTCUSDT', '1h');
  assert.equal(named.normalizedPath, 'data/one.jsonl');
});

test('forecast cache rows from another dataset are not reused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kronos-cache-'));
  const file = join(dir, 'cache.jsonl');
  appendForecastCache(file, [
    { openTime: 1, meanCloses: [1], sampleEnds: [1, 2], datasetSha256: 'aaa' },
    { openTime: 2, meanCloses: [2], sampleEnds: [2, 3], datasetSha256: 'bbb' },
    { openTime: 3, meanCloses: [3], sampleEnds: [3, 4] }
  ]);
  const cache = loadForecastCache(file, 'aaa');
  assert.deepEqual([...cache.keys()], [1]);
});

test('the trial log counts a repeated variation once and a grid by its size', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kronos-trials-'));
  const file = join(dir, 'trials.jsonl');
  const row = {
    id: 'aranha:analogs:abc',
    family: 'aranha',
    strategy: 'analogs',
    recordedAt: '2026-01-01T00:00:00.000Z',
    trials: 1,
    sharpe: 0.1,
    periods: 40,
    source: 'test'
  };
  upsertTrial(file, row);
  upsertTrial(file, { ...row, sharpe: 0.2, recordedAt: '2026-02-01T00:00:00.000Z' });
  upsertTrial(file, {
    id: 'kronos-m2-grid',
    family: 'kronos',
    strategy: 'grade-m2',
    recordedAt: '2026-01-01T00:00:00.000Z',
    trials: 108,
    sharpe: null,
    periods: null,
    source: 'protocol'
  });
  const entries = readTrials(file);
  assert.equal(entries.length, 2);
  assert.equal(trialCount(entries, 'aranha'), 1);
  assert.equal(trialCount(entries, 'kronos'), 108);
  assert.equal(entries.find(entry => entry.family === 'aranha')?.sharpe, 0.2);
});

test('the report prints the exact verdict rule', () => {
  const report: ValidationReport = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    disclaimer: 'teste',
    gates: { minIndependentDecisions: 30, deflatedSharpeMin: 0.95, maxProbabilityOfOverfit: 0.5, directionalAlpha: 0.05 },
    trialLog: 'reports/trial-log.jsonl',
    trialsByFamily: {},
    datasets: [],
    strategies: [],
    notes: []
  };
  const markdown = renderValidationMarkdown(report);
  for (const rule of VERDICT_RULES) {
    assert.ok(markdown.includes(rule), rule.slice(0, 40));
  }
  assert.match(markdown, /npm run validate -- --strategy kronos-m2/);
  assert.match(markdown, /kronos-rule/);
});

test('a kronos strategy flag is one of the three documented names', () => {
  assert.equal(parseStrategyFlag(['node', 'cli']), null);
  assert.equal(parseStrategyFlag(['node', '--strategy', 'kronos-m2']), 'kronos-m2');
  assert.equal(parseStrategyFlag(['node', '--strategy=kronos-rule']), 'kronos-rule');
  assert.throws(() => parseStrategyFlag(['node', '--strategy', 'aranha']), /desconhecida/);
});

test('cached forecasts become a kronos rule series without starting the model', () => {
  const candles = series(280, index => 100 + index * 0.2);
  const forecasts = new Map<number, { openTime: number; meanCloses: number[]; sampleEnds: number[]; datasetSha256: string }>();
  for (let index = 255; index + 6 < candles.length; index += 12) {
    const close = candles[index].close;
    forecasts.set(candles[index].openTime, {
      openTime: candles[index].openTime,
      meanCloses: [close, close, close, close, close, close * 1.01],
      sampleEnds: [close * 1.01, close * 1.02, close * 0.99, close * 1.0],
      datasetSha256: 'abc'
    });
  }
  const [rule] = kronosSeriesFromForecasts(candles, forecasts, kronosStrategyPlan('kronos-rule'));
  assert.equal(rule.id, 'kronos-rule');
  assert.ok(rule.returns.length >= 2);
  assert.equal(rule.returns.length, rule.benchmarkReturns.length);
  assert.equal(rule.hasProbability, true);
});

test('replacing a kronos row keeps the other strategies', () => {
  const report: ValidationReport = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    disclaimer: 'teste',
    gates: { minIndependentDecisions: 30, deflatedSharpeMin: 0.95, maxProbabilityOfOverfit: 0.5, directionalAlpha: 0.05 },
    trialLog: 'reports/trial-log.jsonl',
    trialsByFamily: { kronos: 108 },
    datasets: [],
    strategies: [
      { id: 'kronos-rule', family: 'kronos', name: 'Kronos: regra atual', verdict: 'inconclusiva', reason: 'sem modelo', note: '', metrics: null },
      { id: 'aranha-analogs', family: 'aranha', name: 'Aranha: análogos', verdict: 'reprovada', reason: 'perdeu', note: '', metrics: null }
    ],
    notes: []
  };
  const next = replaceStrategy(report, {
    id: 'kronos-rule',
    family: 'kronos',
    name: 'Kronos: regra atual',
    verdict: 'reprovada',
    reason: 'medido',
    note: '',
    metrics: null
  });
  assert.equal(next.strategies.length, 2);
  assert.equal(next.strategies[0].verdict, 'reprovada');
  assert.equal(next.strategies[1].id, 'aranha-analogs');
});

test('the validation route is GET only', () => {
  const source = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/validation'/);
  assert.equal(source.includes("app.post('/api/validation'"), false);
  assert.equal(source.includes('order_execution'), false);
});
