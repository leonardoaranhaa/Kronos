import test from 'node:test';
import assert from 'node:assert/strict';
import { runWalkForward, WalkForwardConfig } from '../server/backtest';
import { renderBacktestMarkdown, BacktestReport } from '../server/backtest-report';
import { CanonicalCandle } from '../shared/types';
import { series } from './fixtures';

const costs = { feeRate: 0.001, slippageRate: 0.0005, positionFraction: 1 };
const breaker = {
  maxDailyDrawdownPct: 2,
  maxConsecutiveLosses: 3,
  cooldownPeriodMs: 30 * 60 * 1000,
  feedTimeoutMs: 30_000
};

function config(overrides: Partial<WalkForwardConfig> = {}): WalkForwardConfig {
  return {
    context: 20,
    horizon: 2,
    stride: 5,
    costs,
    signal: { minMoveBps: 30, rsiBuyMax: 70, rsiSellMin: 30 },
    breaker,
    startingEquity: 10_000,
    intervalMs: 300_000,
    randomSeed: 42,
    ...overrides
  };
}

test('the forecaster never receives a candle after the decision', async () => {
  const candles = series(80, index => 100 + index * 0.1);
  const seen: number[][] = [];
  await runWalkForward(candles, config(), {
    predict(window) {
      seen.push(window.map(candle => candle.openTime));
      const last = window[window.length - 1].close;
      return [last, last];
    }
  });

  assert.ok(seen.length > 0);
  for (const window of seen) {
    assert.equal(window.length, 20);
    const decision = window[window.length - 1];
    assert.ok(window.every(openTime => openTime <= decision));
  }

  const mutated = candles.map(candle => ({ ...candle }));
  const firstDecisionIndex = 19;
  mutated[firstDecisionIndex + 1] = { ...mutated[firstDecisionIndex + 1], close: 1 };
  const seenAfter: number[][] = [];
  await runWalkForward(mutated, config(), {
    predict(window) {
      seenAfter.push(window.map(candle => candle.close));
      const last = window[window.length - 1].close;
      return [last, last];
    }
  });
  assert.deepEqual(seenAfter[0], seen[0].map(openTime => candles.find(candle => candle.openTime === openTime)!.close));
});

test('buy and hold on a flat series loses money to fees, and a flat forecast does not trade', async () => {
  const candles = series(60, () => 100);
  const result = await runWalkForward(candles, config({ stride: 10, context: 20 }), {
    predict(window) {
      const last = window[window.length - 1].close;
      return [last, last];
    }
  });
  assert.ok(result.strategies.buyAndHold.endingEquity < result.strategies.buyAndHold.startingEquity);
  assert.ok(result.strategies.buyAndHold.feesPaid > 0);
  assert.equal(result.strategies.kronos.closedTrades, 0);
  assert.equal(result.strategies.kronos.returnPct, 0);
});

test('directional accuracy uses only the future close, not the input window', async () => {
  const candles = series(50, index => 100 + index);
  const result = await runWalkForward(candles, config({ context: 20, horizon: 2, stride: 10 }), {
    predict(window) {
      const last = window[window.length - 1].close;
      return [last + 1, last + 1];
    }
  });
  assert.equal(result.forecast.directionalAccuracy, 1);
  assert.ok((result.forecast.mae ?? 0) > 0);
});

test('the same random seed produces the same baseline', async () => {
  const candles = series(40, index => 100 + (index % 3));
  const forecaster = {
    predict(window: CanonicalCandle[]) {
      const last = window[window.length - 1].close;
      return [last, last];
    }
  };
  const first = await runWalkForward(candles, config(), forecaster);
  const second = await runWalkForward(candles, config(), forecaster);
  assert.equal(first.strategies.random.endingEquity, second.strategies.random.endingEquity);
  assert.equal(first.strategies.random.closedTrades, second.strategies.random.closedTrades);
});

test('the markdown report quotes the measured return and states that no order was sent', async () => {
  const candles = series(40, index => 100 + index * 0.2);
  const result = await runWalkForward(candles, config(), {
    predict(window) {
      const last = window[window.length - 1].close;
      return [last * 1.01, last * 1.01];
    }
  });
  const report: BacktestReport = {
    ...result,
    generatedAt: '2026-11-12T00:00:00.000Z',
    disclaimer: 'Simulação de pesquisa. Nenhuma ordem real foi enviada.',
    symbol: 'BTCUSDT',
    interval: '5m',
    range: { firstOpenTime: candles[0].openTime, lastOpenTime: candles.at(-1)!.openTime, candleCount: candles.length },
    dataset: { normalizedPath: 'data/normalized/fixture.jsonl', normalizedSha256: 'abc' },
    model: { modelId: 'NeoQuasar/Kronos-small', tokenizerId: 'NeoQuasar/Kronos-Tokenizer-base', upstreamCommit: '67b630e', device: 'cpu' },
    costs,
    signal: config().signal,
    signalRules: ['regra de teste'],
    limitations: result.sampling.stride ? ['limite'] : [],
    runtime: { forecasts: result.sampling.decisionCount, inferenceMs: 10 }
  };
  const markdown = renderBacktestMarkdown(report);
  assert.match(markdown, /Nenhuma ordem real foi enviada/);
  assert.match(markdown, new RegExp(result.strategies.kronos.returnPct.toFixed(2).replace('.', '\\.')));
  assert.match(markdown, /20 \/ 2 \/ 5/);
});
