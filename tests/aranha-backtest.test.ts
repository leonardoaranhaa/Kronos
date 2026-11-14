import test from 'node:test';
import assert from 'node:assert/strict';
import { series } from './fixtures';
import { DEFAULT_BREAKER_CONFIG } from '../server/circuit_breaker';
import { buildAranhaSchedules, runAranhaBacktest } from '../server/aranha/backtest';
import { aranhaLimitationLines } from '../server/aranha/report';

const search = {
  window: 16,
  horizon: 4,
  neighbors: 3,
  separation: 4,
  stride: 8,
  randomSeed: 7
};

const costs = { feeRate: 0.001, slippageRate: 0.0005, positionFraction: 1 };

test('walk-forward schedules do not change when the future is appended', () => {
  const full = series(420, index => 100 + Math.sin(index / 5) * 3 + (index > 300 ? 8 : 0));
  const cut = 300;
  const prefix = buildAranhaSchedules(full.slice(0, cut), search);
  const longer = buildAranhaSchedules(full, search);
  for (const key of ['analogs', 'structures', 'persistence', 'persistenceFiltered', 'random'] as const) {
    for (const [index, action] of prefix[key]) {
      assert.equal(longer[key].get(index), action, `${key} at ${index}`);
    }
  }
  assert.ok(prefix.decisions > 0);
});

test('the pattern backtest runs on the same fee path and does not claim a web result', () => {
  const candles = series(260, index => 100 + index * 0.02 + Math.sin(index / 4));
  const result = runAranhaBacktest(candles, {
    ...search,
    costs,
    breaker: DEFAULT_BREAKER_CONFIG,
    startingEquity: 10_000,
    intervalMs: 300_000
  });
  assert.ok(result.sampling.decisionCount > 0);
  assert.equal(result.strategies.analogs.label, 'Análogos');
  assert.ok(Number.isFinite(result.strategies.analogs.returnPct));
  assert.ok(Number.isFinite(result.strategies.buyAndHold.returnPct));
  assert.ok(Number.isFinite(result.strategies.persistenceFiltered.returnPct));
  assert.ok(result.filter.skippedByAnalogFilter >= 0);
  const limits = aranhaLimitationLines().join(' ');
  assert.match(limits, /não entra neste backtest/);
  assert.match(limits, /Não foi inventado um sentimento/);
});
