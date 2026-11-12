import test from 'node:test';
import assert from 'node:assert/strict';
import { candleAt, series } from './fixtures';
import { LLM_ACCOUNT_BACKOFF_MS, LlmRequestError, type LlmProvider, type LlmResult } from '../server/aranha/llm';
import { readAranhaConfig } from '../server/aranha/config';
import { AranhaRuntime } from '../server/aranha/runtime';
import { llmLabel } from '../src/client/llm-label';
import type { LlmAccountStatus } from '../server/aranha/types';

function runtime(provider: LlmProvider): AranhaRuntime {
  const config = readAranhaConfig({
    ARANHA_WEB: '0',
    ARANHA_CHART_IMAGE: '0',
    ARANHA_LLM_MIN_INTERVAL_MS: '600000'
  } as NodeJS.ProcessEnv);
  const app = new AranhaRuntime(config, { provider, cache: undefined });
  app.setCandles(series(80, index => 100 + Math.sin(index / 6)));
  return app;
}

function okResult(text: string): LlmResult {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    text,
    citations: [],
    webSearch: 'desligado',
    usage: { inputTokens: 30, outputTokens: 12, webSearchRequests: null }
  };
}

test('a failed Claude call stays an error after the next candle and does not retry inside the billing pause', async () => {
  let calls = 0;
  let fail = false;
  const provider: LlmProvider = {
    id: 'anthropic',
    model: 'claude-sonnet-4-6',
    async complete() {
      calls += 1;
      if (fail) throw new LlmRequestError('HTTP 400 credit balance is too low', 'billing', 400);
      return okResult('{"leitura":"O gráfico está lateral.","vies":"neutro","ressalvas":["amostra pequena"]}');
    }
  };
  const app = runtime(provider);
  const first = 1_700_000_000_000;
  await app.refreshChartReading(first);
  const ok = app.view();
  assert.equal(ok.llm.mode, 'anthropic');
  assert.equal(ok.llm.configured, true);
  assert.equal(ok.llm.lastCallOk, true);
  assert.equal(ok.llm.usage?.inputTokens, 30);
  assert.equal(ok.llm.usage?.outputTokens, 12);
  assert.match(ok.pattern.chartReading.llmText ?? '', /lateral/);
  assert.equal(llmLabel(ok.llm).startsWith('Claude ligado às '), true);

  fail = true;
  await app.refreshChartReading(first + 11 * 60 * 1000);
  assert.equal(calls, 2);
  app.append(candleAt(80, 101));
  const broken = app.view();
  assert.equal(broken.llm.mode, 'erro');
  assert.equal(broken.llm.reason, 'Sem crédito na conta da Anthropic');
  assert.equal(broken.pattern.chartReading.llmMode, 'erro');
  assert.match(broken.pattern.chartReading.llmText ?? '', /lateral/);
  assert.equal(broken.llm.readingAt, new Date(first).toISOString());
  assert.equal(broken.llm.usage?.inputTokens, 30);
  assert.match(llmLabel(broken.llm), /Sem crédito na conta da Anthropic às /);
  assert.doesNotMatch(llmLabel(broken.llm), /ligado|desligado/);

  await app.refreshChartReading(first + 30 * 60 * 1000);
  assert.equal(calls, 2);
  await app.refreshChartReading(first + 11 * 60 * 1000 + LLM_ACCOUNT_BACKOFF_MS);
  assert.equal(calls, 3);
});

test('the label says the model is off only when no key is configured', () => {
  const off: LlmAccountStatus = {
    configured: false,
    provider: null,
    model: null,
    mode: 'desligado',
    reason: null,
    lastCallAt: null,
    lastCallOk: null,
    readingAt: null,
    usage: null
  };
  assert.equal(llmLabel(off), 'LLM desligado');
  assert.equal(llmLabel({ ...off, configured: true, provider: 'anthropic', model: 'claude-sonnet-4-6' }), 'Claude configurado');
});
