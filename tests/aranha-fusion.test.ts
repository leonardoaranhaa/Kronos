import test from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalCandle } from '../shared/types';
import { buildPatternContext } from '../server/aranha/pattern';
import { mechanicalReading, parseChartAnalyst } from '../server/aranha/reading';
import { applyAranhaFilter, fuse } from '../server/aranha/fusion';
import { analogsDisagree } from '../server/aranha/gates';
import { emptyWebContext } from '../server/aranha/web';
import { readAranhaConfig } from '../server/aranha/config';
import type { ResearchSignal } from '../server/signals';

const START = 1_704_067_200_000;

function flat(count: number): CanonicalCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const openTime = START + index * 300_000;
    return {
      venue: 'binance',
      symbol: 'BTCUSDT',
      interval: '5m',
      openTime,
      closeTime: openTime + 299_999,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 10,
      quoteVolume: 1000,
      source: 'historical',
      ingestedAt: openTime
    };
  });
}

function signal(action: ResearchSignal['action']): ResearchSignal {
  return {
    action,
    reason: 'Sinal de teste.',
    forecastReturnBps: action === 'SELL' ? -40 : 40,
    heuristicScore: 0.5,
    indicators: { ema9: 11, ema20: 10, ema50: null, rsi14: 50, atr14: 1 }
  };
}

function bearishPattern() {
  const pattern = buildPatternContext(flat(80), 79, {
    window: 16,
    horizon: 4,
    k: 3,
    separation: 4,
    candidateStride: 1
  });
  pattern.analogSummary = {
    count: 10,
    hitRateUp: 0.2,
    hitRateDown: 0.8,
    flatCount: 0,
    meanForwardReturnBps: -20,
    medianForwardReturnBps: -20,
    p25Bps: -30,
    p75Bps: -10,
    medianDistance: 1
  };
  pattern.chartReading = mechanicalReading(pattern);
  return pattern;
}

test('the filter is off by default and only holds when both legs disagree', () => {
  assert.equal(readAranhaConfig({} as NodeJS.ProcessEnv).filterEnabled, false);
  const pattern = bearishPattern();
  assert.equal(pattern.chartReading.bias, 'baixa');
  assert.match(pattern.chartReading.text, /leitura mecânica/);
  assert.equal(analogsDisagree(pattern.analogSummary, 'BUY'), true);
  assert.equal(analogsDisagree({ ...pattern.analogSummary, count: 7 }, 'BUY'), false);

  const web = emptyWebContext('teste');
  web.sentiment = -0.8;
  const buy = signal('BUY');
  const held = applyAranhaFilter(buy, { pattern, web }, true);
  assert.equal(held.action, 'HOLD');
  assert.match(held.reason, /Filtro da Aranha/);
  assert.equal(applyAranhaFilter(buy, { pattern, web }, false).action, 'BUY');
  assert.equal(applyAranhaFilter(buy, { pattern, web: { ...web, sentiment: null } }, true).action, 'BUY');
  assert.equal(applyAranhaFilter(buy, { pattern, web: { ...web, sentiment: 0.6 } }, true).action, 'BUY');

  const fused = fuse(pattern, web, buy, true);
  assert.equal(fused.usedSignal?.action, 'HOLD');
  assert.equal(fused.verdict.bias, 'baixa');
  assert.match(fused.verdict.note, /segurou/);

  const untouched = fuse(pattern, web, buy, false);
  assert.equal(untouched.usedSignal?.action, 'BUY');
  assert.match(untouched.verdict.note, /não muda/);
});

test('a chart comment from the model cannot replace the mechanical bias', () => {
  const parsed = parseChartAnalyst('```json\n{"leitura":"O gráfico está misturado.","vies":"alta","ressalvas":["poucos casos"]}\n```', 'baixa');
  assert.ok(parsed);
  assert.equal(parsed?.bias, 'baixa');
  assert.match(parsed?.text ?? '', /misturado/);
  assert.ok(parsed?.caveats.some(item => item.includes('viés')));
});
