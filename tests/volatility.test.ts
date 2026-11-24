import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FUTURES_PROTOCOL } from '../server/futures/protocol';
import { SAMPLE_COUNT, SERIES_SPECS } from '../server/research-protocol';
import { readTrials } from '../server/validation/trials';
import { renderValidationMarkdown, type ValidationReport } from '../server/validation/report';
import { VALIDATION_GATES } from '../server/validation/protocol';
import { mulberry32 } from '../server/validation/random';
import type { KlineBar } from '../server/futures/parse';
import { buildVolDecisions, buildVolSample } from '../server/volatility/build';
import { judgeFilter, judgeSkill } from '../server/volatility/headlines';
import { coverageRate, dieboldMariano, maxDrawdownPct, qlike } from '../server/volatility/losses';
import { sampleVarianceForecast, runKronosVolValidation } from '../server/volatility/kronos-vol';
import { fitGarch11, fitHar, garchHorizonForecast, predictHar } from '../server/volatility/models';
import { VOL_PROTOCOL, volTrialPlans } from '../server/volatility/protocol';
import { skillCell } from '../server/volatility/skill';
import { exposureReturns, scoreVolPoints } from '../server/volatility/study';
import { runVolatilityValidation } from '../server/volatility/validate';

const HOUR = 3_600_000;

function klinesFrom(closes: readonly number[]): KlineBar[] {
  return closes.map((close, index) => {
    const openTime = Date.UTC(2024, 10, 1) + index * HOUR;
    return {
      openTime,
      closeTime: openTime + HOUR - 1,
      open: close,
      high: close * 1.001,
      low: close * 0.999,
      close,
      volume: 10,
      takerBuyVolume: 6,
      quoteVolume: close * 10,
      takerBuyQuoteVolume: close * 6
    };
  });
}

function randomWalk(count: number, seed: number): number[] {
  const random = mulberry32(seed);
  const closes = [100];
  for (let index = 1; index < count; index++) {
    const burst = index % 40 < 8 ? 0.012 : 0.002;
    const shock = (random() - 0.5) * burst;
    closes.push(closes[index - 1] * Math.exp(shock));
  }
  return closes;
}

test('the vol protocol stays on the futures window and the existing gates', () => {
  assert.equal(VOL_PROTOCOL.windowStart, FUTURES_PROTOCOL.windowStart);
  assert.equal(VOL_PROTOCOL.windowEnd, FUTURES_PROTOCOL.windowEnd);
  assert.equal(VOL_PROTOCOL.feeRate, FUTURES_PROTOCOL.feeRate);
  assert.equal(VOL_PROTOCOL.slippageRate, FUTURES_PROTOCOL.slippageRate);
  assert.equal(VOL_PROTOCOL.walkForwardGroups, VALIDATION_GATES.walkForwardGroups);
  assert.equal(VOL_PROTOCOL.walkForwardMinTrainGroups, VALIDATION_GATES.walkForwardMinTrainGroups);
  assert.deepEqual([...VOL_PROTOCOL.horizons], [4, 24]);
  assert.deepEqual([...VOL_PROTOCOL.symbols], ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  const hour = SERIES_SPECS.find(spec => spec.interval === '1h');
  assert.equal(VOL_PROTOCOL.kronosHorizonBars, hour?.horizon);
  assert.equal(VOL_PROTOCOL.kronosContext, hour?.context);
  assert.equal(VOL_PROTOCOL.kronosStride, hour?.stride);
  assert.equal(VOL_PROTOCOL.kronosSampleCount, SAMPLE_COUNT);
  assert.equal(volTrialPlans().some(plan => plan.strategy === 'kronos-vol'), true);
  assert.equal(volTrialPlans().every(plan => plan.params && (plan.params as { registeredAt: string }).registeredAt === VOL_PROTOCOL.registeredAt), true);
});

test('QLIKE, Diebold-Mariano and coverage match their definitions', () => {
  assert.equal(qlike(1, 1), 1);
  const good = [qlike(0.2, 0.2) as number, qlike(2, 2) as number];
  const bad = [qlike(2, 0.2) as number, qlike(0.2, 2) as number];
  assert.ok(good[0] + good[1] < bad[0] + bad[1]);
  const model = new Array(80).fill(0.1);
  const baseline = new Array(80).fill(1);
  const better = dieboldMariano(model, baseline, 0, 1);
  assert.ok(better.pValue !== null && better.pValue < 0.01);
  assert.ok((better.meanGap ?? 0) < 0);
  const tied = dieboldMariano(baseline, baseline, 0, 1);
  assert.equal(tied.pValue, null);
  assert.equal(coverageRate([0, 0, 0], [1, 1, 1], 0.8), 1);
  assert.equal(coverageRate([5, 5, 5], [1e-8, 1e-8, 1e-8], 0.95), 0);
});

test('a label change does not move features, and a future close does not move the label', () => {
  const closes = randomWalk(400, 7);
  const original = klinesFrom(closes);
  const first = buildVolDecisions({ klines: original, horizonHours: 4 })[0];
  assert.ok(first);
  const afterLabel = klinesFrom(closes);
  afterLabel[first.barIndex + 4 + 3].close = afterLabel[first.barIndex + 4 + 3].close * 1.4;
  const untouched = buildVolDecisions({ klines: afterLabel, horizonHours: 4 })[0];
  assert.equal(untouched.realizedVariance, first.realizedVariance);
  assert.equal(untouched.rvDay, first.rvDay);
  assert.equal(untouched.ewmaVariance, first.ewmaVariance);
  assert.equal(untouched.absoluteLogReturn, first.absoluteLogReturn);
  const inside = klinesFrom(closes);
  inside[first.barIndex + 2].close = inside[first.barIndex + 2].close * 1.3;
  const moved = buildVolDecisions({ klines: inside, horizonHours: 4 })[0];
  assert.notEqual(moved.realizedVariance, first.realizedVariance);
  assert.equal(moved.rvDay, first.rvDay);
  assert.equal(moved.rvWeek, first.rvWeek);
  const day24 = buildVolDecisions({ klines: klinesFrom(randomWalk(900, 3)), horizonHours: 24 });
  assert.ok(day24.length >= 1);
  assert.equal(new Date(day24[0].openTime).getUTCHours(), 0);
});

test('HAR and GARCH fits ignore returns that have not happened yet', () => {
  const returns = [Number.NaN, ...randomWalk(180, 11).slice(1).map((close, index, all) => Math.log(close / (index === 0 ? 100 : all[index - 1])))];
  // randomWalk slice above is awkward. Build log returns directly.
  const random = mulberry32(11);
  const logReturns = [Number.NaN];
  for (let index = 0; index < 180; index++) logReturns.push((random() - 0.5) * 0.01);
  const fitted = fitGarch11(logReturns);
  assert.ok(fitted);
  const early = garchHorizonForecast(logReturns, fitted, [40], 4, 0.0001)[0];
  const tampered = logReturns.slice();
  tampered[120] = 0.2;
  const still = garchHorizonForecast(tampered, fitted, [40], 4, 0.0001)[0];
  assert.equal(still, early);
  const later = garchHorizonForecast(tampered, fitted, [130], 4, 0.0001)[0];
  const originalLater = garchHorizonForecast(logReturns, fitted, [130], 4, 0.0001)[0];
  assert.notEqual(later, originalLater);
  const day = [0.01, 0.02, 0.015, 0.03];
  const week = [0.02, 0.02, 0.02, 0.02];
  const month = [0.018, 0.018, 0.019, 0.021];
  const target = [0.02, 0.03, 0.01, 0.04];
  const model = fitHar(day, week, month, target);
  assert.ok(model);
  const prediction = predictHar(model, 0.02, 0.02, 0.02);
  const changed = fitHar(day, week, month, [0.02, 0.03, 0.01, 5]);
  assert.notEqual(predictHar(changed as NonNullable<typeof changed>, 0.02, 0.02, 0.02), prediction);
  const held = fitHar(day, week, month, [9, 0.03, 0.01, 0.04]);
  assert.notEqual(predictHar(held as NonNullable<typeof held>, 0.02, 0.02, 0.02), prediction);
});

test('the walk-forward forecast does not use the test label', () => {
  const sample = buildVolSample({ klines: klinesFrom(randomWalk(1100, 21)), horizonHours: 4 });
  assert.ok(sample.decisions.length > VOL_PROTOCOL.minTrainRows);
  const scored = scoreVolPoints(sample.decisions, sample.hourlyReturns, 4);
  assert.ok(scored.length >= VOL_PROTOCOL.minTestObservations);
  const last = sample.decisions.length - 1;
  const mutated = sample.decisions.map((decision, index) => index === last
    ? { ...decision, realizedVariance: decision.realizedVariance + 3, absoluteLogReturn: 1 }
    : decision);
  const again = scoreVolPoints(mutated, sample.hourlyReturns, 4);
  assert.equal(again.length, scored.length);
  for (let index = 0; index < scored.length; index++) {
    assert.equal(again[index].models.har.forecast, scored[index].models.har.forecast);
    assert.equal(again[index].models.ewma.forecast, scored[index].models.ewma.forecast);
    assert.equal(again[index].models.naive.forecast, scored[index].models.naive.forecast);
    assert.equal(again[index].models.garch.forecast, scored[index].models.garch.forecast);
  }
  const shifted = sample.decisions.map((decision, index) => index === 0
    ? { ...decision, realizedVariance: decision.realizedVariance + 4 }
    : decision);
  const moved = scoreVolPoints(shifted, sample.hourlyReturns, 4);
  const harChanged = moved.some((point, index) => point.models.har.forecast !== scored[index].models.har.forecast);
  assert.equal(harChanged, true);
  const cell = skillCell('BTCUSDT', 4, 'har', scored);
  assert.equal(cell.observations, scored.length);
  assert.ok(cell.qlike !== null && cell.baselineQlike !== null);
  assert.equal(cell.symbol, 'BTCUSDT');
});

test('position changes pay the fee once, and sitting out a crash cuts the drawdown', () => {
  const decision = {
    openTime: 0,
    barIndex: 0,
    priceReturn: 0,
    absoluteLogReturn: 0,
    realizedVariance: 0.01,
    squaredLogReturn: 0.01,
    fundingPaidByLong: 0,
    rvDay: 0.01,
    rvWeek: 0.01,
    rvMonth: 0.01,
    ewmaVariance: 0.01,
    absPast: 0.1,
    features: null
  };
  const path = [
    { ...decision, priceReturn: 0.05 },
    { ...decision, priceReturn: -0.4 }
  ];
  const side = VOL_PROTOCOL.feeRate + VOL_PROTOCOL.slippageRate;
  const held = exposureReturns(path, [1, 1]);
  assert.ok(Math.abs(held[0] - (0.05 - side)) < 1e-12);
  assert.ok(Math.abs(held[1] - (-0.4 - side)) < 1e-12);
  const filtered = exposureReturns(path, [1, 0]);
  assert.ok(Math.abs(filtered[1] - (-side)) < 1e-12);
  const holdDrawdown = maxDrawdownPct(held) as number;
  const filterDrawdown = maxDrawdownPct(filtered) as number;
  assert.ok(filterDrawdown < holdDrawdown);
  const flat = exposureReturns(path, [0, 0]);
  assert.deepEqual(flat, [0, 0]);
  assert.equal(maxDrawdownPct(flat), 0);
});

test('an empty futures folder stays inconclusive and the trial log is written before any score', () => {
  const root = mkdtempSync(join(tmpdir(), 'vol-empty-'));
  const reportDir = mkdtempSync(join(tmpdir(), 'vol-report-'));
  const trialLog = join(reportDir, 'trial-log.jsonl');
  const seeded: ValidationReport = {
    generatedAt: '2026-01-01T00:00:00.000Z',
    disclaimer: 'teste',
    gates: {
      minIndependentDecisions: 30,
      deflatedSharpeMin: 0.95,
      maxProbabilityOfOverfit: 0.5,
      directionalAlpha: 0.05
    },
    trialLog,
    trialsByFamily: { aranha: 1 },
    datasets: [],
    strategies: [{
      id: 'aranha-analogs',
      family: 'aranha',
      name: 'Aranha: análogos',
      verdict: 'reprovada',
      reason: 'já medida',
      note: '',
      metrics: null
    }],
    notes: ['Futuros: esta nota fica.']
  };
  writeFileSync(join(reportDir, 'validation-latest.json'), JSON.stringify(seeded));
  const report = runVolatilityValidation({ root, trialLog, reportDirectory: reportDir, symbols: ['BTCUSDT'] });
  assert.equal(report.strategies.some(row => row.id === 'aranha-analogs'), true);
  assert.equal(report.notes.some(note => note.startsWith('Futuros:')), true);
  const row = report.strategies.find(item => item.id === 'vol-btcusdt-sem-serie');
  assert.equal(row?.verdict, 'inconclusiva');
  assert.equal(row?.metrics, null);
  assert.equal(report.volatility?.skillVerdict, 'inconclusiva');
  assert.equal(report.volatility?.filterVerdict, 'inconclusiva');
  assert.match(report.volatility?.headline ?? '', /Ainda não dá para dizer/);
  assert.match(report.volatility?.kronosReason ?? '', /npm run validate -- --strategy kronos-vol/);
  assert.equal(report.volatility?.cells.length, 0);
  const trials = readTrials(trialLog);
  assert.equal(trials.length, volTrialPlans().length);
  assert.ok(trials.every(entry => entry.sharpe === null));
  assert.ok(trials.every(entry => entry.recordedAt === VOL_PROTOCOL.registeredAt));
  assert.equal(judgeSkill([]).verdict, 'inconclusiva');
  assert.equal(judgeFilter([]).verdict, 'inconclusiva');
  const markdown = renderValidationMarkdown(report);
  assert.match(markdown, /npm run validate -- --strategy vol/);
  assert.match(markdown, /kronos-vol/);
  assert.match(markdown, /Tamanho do movimento/);
});

test('kronos dispersion is the sample variance and the command stays inconclusive without the checkout', async () => {
  const close = 100;
  const forecast = sampleVarianceForecast(close, [110, 90, 105, 95]);
  assert.ok(forecast !== null && forecast > 0);
  const logs = [110, 90, 105, 95].map(end => Math.log(end / close));
  const center = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  const expected = logs.reduce((sum, value) => sum + (value - center) ** 2, 0) / (logs.length - 1);
  assert.ok(Math.abs((forecast as number) - expected) < 1e-12);
  assert.equal(sampleVarianceForecast(close, [close]), null);
  const root = mkdtempSync(join(tmpdir(), 'kronos-vol-'));
  const reportDir = mkdtempSync(join(tmpdir(), 'kronos-vol-report-'));
  const trialLog = join(reportDir, 'trial-log.jsonl');
  const report = await runKronosVolValidation({
    root,
    trialLog,
    reportDirectory: reportDir,
    modulePath: join(root, 'missing.py')
  });
  const row = report.strategies.find(item => item.id === 'kronos-vol');
  assert.equal(row?.verdict, 'inconclusiva');
  assert.equal(row?.metrics, null);
  assert.match(row?.reason ?? '', /npm run validate -- --strategy kronos-vol/);
  assert.equal(report.volatility?.kronosVerdict, 'inconclusiva');
  const trials = readTrials(trialLog);
  assert.ok(trials.length >= 1);
  assert.ok(trials.every(entry => entry.sharpe === null));
});

test('vol validation does not touch the legacy execution module', () => {
  for (const relative of [
    '../server/volatility/validate.ts',
    '../server/volatility/kronos-vol.ts',
    '../server/volatility/study.ts',
    '../server/validation/cli.ts',
    '../server/index.ts'
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.equal(source.includes('order_execution'), false, relative);
  }
  const screen = readFileSync(new URL('../src/client/App.tsx', import.meta.url), 'utf8');
  assert.match(screen, /Tamanho do movimento/);
});
