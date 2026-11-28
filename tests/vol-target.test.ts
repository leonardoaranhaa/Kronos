import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FundingPrint, KlineBar } from '../server/futures/parse';
import { mulberry32 } from '../server/validation/random';
import { buildVolSample } from '../server/volatility/build';
import {
  VOL_TARGET_PROTOCOL,
  expandingHarWeights,
  forwardCell,
  judgeTargetBook,
  judgeVolTarget,
  type TargetGateInput
} from '../server/volatility/targeting';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function series(days: number, seed: number): { klines: KlineBar[]; funding: FundingPrint[] } {
  const random = mulberry32(seed);
  const start = Date.parse(VOL_TARGET_PROTOCOL.historyStart);
  const klines: KlineBar[] = [];
  let close = 100;
  for (let index = 0; index < days * 24; index++) {
    const regime = Math.floor(index / 500) % 3 === 0 ? 0.02 : 0.005;
    close *= Math.exp((random() - 0.5) * regime);
    const openTime = start + index * HOUR;
    klines.push({ openTime, closeTime: openTime + HOUR - 1, open: close, high: close, low: close, close, volume: 1, takerBuyVolume: 0.5, quoteVolume: close, takerBuyQuoteVolume: close / 2 });
  }
  const funding: FundingPrint[] = [];
  for (let time = start; time < start + days * DAY; time += 8 * HOUR) funding.push({ time, rate: 0.0001 } as FundingPrint);
  return { klines, funding };
}

const passing: TargetGateInput = {
  observations: 100,
  sharpe: 1.2,
  holdSharpe: 0.8,
  maxDrawdownPct: 20,
  holdDrawdownPct: 35,
  deflatedSharpeRatio: 0.97,
  probabilityOfBacktestOverfitting: 0.2,
  usePbo: true
};

test('the vol-target gate needs every condition, and a missing number is inconclusive', () => {
  assert.equal(judgeVolTarget(passing).verdict, 'aprovada');
  assert.equal(judgeVolTarget({ ...passing, sharpe: 0.8 }).verdict, 'reprovada');
  assert.equal(judgeVolTarget({ ...passing, maxDrawdownPct: 35 }).verdict, 'reprovada');
  assert.equal(judgeVolTarget({ ...passing, deflatedSharpeRatio: 0.94 }).verdict, 'reprovada');
  assert.equal(judgeVolTarget({ ...passing, probabilityOfBacktestOverfitting: 0.5 }).verdict, 'reprovada');
  // The forward book does not use PBO: there was no selection inside its data.
  assert.equal(judgeVolTarget({ ...passing, probabilityOfBacktestOverfitting: null, usePbo: false }).verdict, 'aprovada');
  assert.equal(judgeVolTarget({ ...passing, observations: 29 }).verdict, 'inconclusiva');
  assert.equal(judgeVolTarget({ ...passing, deflatedSharpeRatio: null }).verdict, 'inconclusiva');
});

test('the book passes only when all six cells pass', () => {
  const six = (verdict: 'aprovada' | 'reprovada' | 'inconclusiva' | 'aguardando') => Array.from({ length: 6 }, () => ({ verdict }));
  assert.equal(judgeTargetBook(six('aprovada')), 'aprovada');
  assert.equal(judgeTargetBook([...six('aprovada').slice(1), { verdict: 'reprovada' as const }]), 'reprovada');
  assert.equal(judgeTargetBook(six('aprovada').slice(1)), 'inconclusiva');
  assert.equal(judgeTargetBook([...six('aprovada').slice(1), { verdict: 'aguardando' as const }]), 'aguardando');
});

test('the forward HAR weight never reads a block that had not closed', () => {
  const { klines, funding } = series(500, 4);
  const decisions = buildVolSample({ klines, funding, horizonHours: 24, windowEndMs: klines[klines.length - 1].openTime + HOUR }).decisions;
  const start = decisions.length - 60;
  const before = expandingHarWeights(decisions, start);
  const cut = 30;
  const shocked = decisions.map((row, index) => index >= start + cut ? { ...row, realizedVariance: row.realizedVariance * 50, rvDay: row.rvDay * 50 } : row);
  const after = expandingHarWeights(shocked, start);
  for (let index = 0; index < cut; index++) assert.equal(after[index], before[index], `peso ${index} viu o futuro`);
  for (const weight of before) assert.ok(weight === null || (weight > 0 && weight <= 1));
});

test('the forward cell waits for the interim and the published funding, then judges at 365 days', () => {
  const forwardStart = Date.parse(VOL_TARGET_PROTOCOL.forwardStart);
  const historyDays = (forwardStart - Date.parse(VOL_TARGET_PROTOCOL.historyStart)) / DAY;
  const { klines, funding } = series(Math.ceil(historyDays) + 400, 7);

  const early = forwardCell({ klines, funding, symbol: 'BTCUSDT', horizonHours: 24, asOfMs: forwardStart + 30 * DAY });
  assert.equal(early.stage, 'aguardando');
  assert.equal(early.verdict, 'aguardando');

  // Funding published only up to day 40: nothing after it is scored, even with candles.
  const shortFunding = funding.filter(print => print.time < forwardStart + 40 * DAY);
  const capped = forwardCell({ klines, funding: shortFunding, symbol: 'BTCUSDT', horizonHours: 24, asOfMs: forwardStart + 300 * DAY });
  assert.equal(capped.stage, 'aguardando');
  assert.ok(capped.observations <= 40);

  const interim = forwardCell({ klines, funding, symbol: 'BTCUSDT', horizonHours: 24, asOfMs: forwardStart + 120 * DAY });
  assert.equal(interim.stage, 'interina');
  assert.equal(interim.verdict, 'aguardando');
  assert.match(interim.reason, /não decide/);

  const final = forwardCell({ klines, funding, symbol: 'BTCUSDT', horizonHours: 24, asOfMs: forwardStart + 400 * DAY });
  assert.equal(final.stage, 'final');
  assert.notEqual(final.verdict, 'aguardando');
  // The final book stops at 365 days and never starts before the freeze.
  assert.ok(final.observations <= VOL_TARGET_PROTOCOL.finalDays);
  assert.ok(final.observations >= VOL_TARGET_PROTOCOL.finalDays - 2);
});

test('the forward window opens after the registration and the gate stays as written', () => {
  assert.ok(Date.parse(VOL_TARGET_PROTOCOL.forwardStart) > Date.parse(VOL_TARGET_PROTOCOL.registeredAt));
  assert.equal(VOL_TARGET_PROTOCOL.deflatedSharpeMin, 0.95);
  assert.equal(VOL_TARGET_PROTOCOL.maxProbabilityOfOverfit, 0.5);
  assert.equal(VOL_TARGET_PROTOCOL.finalDays, 365);
  const source = readFileSync(new URL('../server/volatility/targeting.ts', import.meta.url), 'utf8');
  assert.equal(/order_execution|placeOrder|apiSecret/i.test(source), false);
});
