import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatResearchAlert, sendTelegramMessage } from '../server/telegram';

test('telegram stays silent when it is not configured', async () => {
  let called = false;
  const result = await sendTelegramMessage('oi', {
    fetchImpl: async () => {
      called = true;
      throw new Error('should not be called');
    }
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'not_configured');
  assert.equal(called, false);
});

test('a configured alert says this is paper research and does not claim an exchange order', async () => {
  const seen: { url: string; body: string }[] = [];
  const text = formatResearchAlert(['Sinal: BUY', 'Motivo: teste']);
  const result = await sendTelegramMessage(text, {
    token: 'test-token',
    chatId: '99',
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), body: String(init?.body) });
      return new Response('{}', { status: 200 });
    }
  });
  assert.equal(result.sent, true);
  assert.match(seen[0].url, /bottest-token\/sendMessage$/);
  assert.match(seen[0].body, /Nenhuma ordem real foi enviada/);
  assert.doesNotMatch(seen[0].body, /ORDEM EXECUTADA/);
});

test('the research server does not import the legacy order executor', () => {
  const index = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
  const backtest = readFileSync(new URL('../server/backtest-cli.ts', import.meta.url), 'utf8');
  const bridge = readFileSync(new URL('../server/kronos-bridge.ts', import.meta.url), 'utf8');
  for (const source of [index, backtest, bridge]) {
    assert.equal(source.includes('order_execution'), false);
    assert.equal(source.includes('test_binance_execution'), false);
  }
});
