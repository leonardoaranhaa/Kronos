import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnthropicProvider, createLlmProvider, OpenAiProvider, parseAnthropicMessage } from '../server/aranha/llm';
import { scoreText } from '../server/aranha/lexicon';
import { fearGreedLabel, parseBinanceAnnouncements, parseCoinGeckoTrending, parseFearGreed, parseRss } from '../server/aranha/parse-feed';
import { buildWebContext, MemorySourceCache, type SourceSpec } from '../server/aranha/web';
import type { LlmProvider } from '../server/aranha/llm';

const rss = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[Bitcoin sobe após aprovação]]></title>
    <link>https://example.com/btc-alta</link>
    <pubDate>Thu, 12 Nov 2026 12:00:00 GMT</pubDate>
    <description>O mercado ficou otimista.</description>
  </item>
</channel></rss>`;

const atom = `<?xml version="1.0"?>
<feed>
  <entry>
    <title>Hack na exchange derruba o bitcoin</title>
    <link href="https://example.com/hack"/>
    <published>2026-11-12T13:00:00Z</published>
    <summary>Queda depois do ataque.</summary>
  </entry>
</feed>`;

test('rss and atom fixtures keep title, link and time', () => {
  const news = parseRss(rss);
  assert.equal(news.length, 1);
  assert.equal(news[0].title, 'Bitcoin sobe após aprovação');
  assert.equal(news[0].url, 'https://example.com/btc-alta');
  assert.match(news[0].publishedAt ?? '', /2026/);
  const entry = parseRss(atom);
  assert.equal(entry[0].url, 'https://example.com/hack');
  assert.match(entry[0].title, /Hack/);
});

test('fear and greed, binance and coingecko fixtures parse without the network', () => {
  const fear = parseFearGreed(JSON.stringify({ data: [{ value: '24', value_classification: 'Extreme Fear', timestamp: '1763000000' }] }));
  assert.equal(fear?.value, 24);
  assert.equal(fearGreedLabel(fear?.classification ?? '', fear?.value ?? 0), 'Medo extremo');
  const news = parseBinanceAnnouncements(JSON.stringify({ data: { articles: [{ title: 'Binance lists ABC', code: 'abc-123', releaseDate: 1763000000000 }] } }));
  assert.equal(news[0].title, 'Binance lists ABC');
  assert.match(news[0].url, /abc-123/);
  const trending = parseCoinGeckoTrending(JSON.stringify({ coins: [{ item: { id: 'bitcoin', name: 'Bitcoin', symbol: 'btc' } }] }));
  assert.match(trending[0].title, /Bitcoin/);
  assert.equal(trending[0].eventHint, 'trending');
});

test('lexicon sentiment is directional and stays unknown when nothing matches', () => {
  const up = scoreText('Bitcoin sobe após aprovação do ETF', 'BTCUSDT');
  const down = scoreText('Hack na exchange e queda forte do bitcoin', 'BTCUSDT');
  const quiet = scoreText('O mercado de tomates abriu cedo', 'BTCUSDT');
  assert.ok((up.sentiment ?? 0) > 0);
  assert.equal(up.relevance, 1);
  assert.ok((down.sentiment ?? 0) < 0);
  assert.equal(down.eventType, 'seguranca');
  assert.equal(quiet.sentiment, null);
});

test('without a provider the web leg still scores fixtures and says the model is off', async () => {
  let calls = 0;
  const sources: SourceSpec[] = [
    { id: 'news', kind: 'rss', url: 'https://example.com/rss', minIntervalMs: 600_000, label: 'Exemplo' },
    { id: 'mood', kind: 'fng', url: 'https://example.com/fng', minIntervalMs: 600_000, label: 'Medo' }
  ];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('user-agent')?.includes('KronosAranha'), true);
    const url = String(input);
    if (url.endsWith('/fng')) {
      return new Response(JSON.stringify({ data: [{ value: '24', value_classification: 'Extreme Fear', timestamp: '1763000000' }] }), { status: 200 });
    }
    return new Response(rss, { status: 200 });
  };
  const cache = new MemorySourceCache();
  const context = await buildWebContext({
    sources,
    symbol: 'BTCUSDT',
    now: 1_700_000_000_000,
    fetchImpl,
    cache,
    provider: null
  });
  assert.equal(context.llm, 'desligado');
  assert.match(context.note, /LLM desligado/);
  assert.equal(context.fearGreed?.value, 24);
  assert.equal(context.fearGreed?.labelPt, 'Medo extremo');
  assert.equal(context.items[0].method, 'lexico');
  assert.ok((context.items[0].sentiment ?? 0) > 0);
  await buildWebContext({ sources, symbol: 'BTCUSDT', now: 1_700_000_000_000, fetchImpl, cache, provider: null });
  assert.equal(calls, 2);
});

test('a pluggable provider can score items and keep citations, and a failure falls back', async () => {
  const sources: SourceSpec[] = [
    { id: 'news', kind: 'rss', url: 'https://example.com/rss', minIntervalMs: 10, label: 'Exemplo' }
  ];
  const fetchImpl: typeof fetch = async () => new Response(rss, { status: 200 });
  const provider: LlmProvider = {
    id: 'anthropic',
    model: 'claude-test',
    async complete() {
      return {
        provider: 'anthropic',
        model: 'claude-test',
        text: JSON.stringify({
          items: [{ id: 'news-0', sentiment: 0.4, eventType: 'etf', relevance: 0.9, urgency: 0.3, summary: 'Tom de alta no teste.' }],
          busca: 'Nada urgente.'
        }),
        citations: [{ url: 'https://example.com/fonte', title: 'Fonte', citedText: 'trecho citado' }],
        webSearch: 'usado'
      };
    }
  };
  const scored = await buildWebContext({
    sources,
    symbol: 'BTCUSDT',
    now: 1_700_000_000_000,
    fetchImpl,
    cache: new MemorySourceCache(),
    provider
  });
  assert.equal(scored.llm, 'anthropic');
  assert.equal(scored.items[0].method, 'llm');
  assert.equal(scored.items[0].summary, 'Tom de alta no teste.');
  assert.equal(scored.citations[0].url, 'https://example.com/fonte');
  assert.match(scored.note, /Nada urgente/);

  const failing: LlmProvider = {
    id: 'anthropic',
    model: 'claude-test',
    async complete() {
      throw new Error('sem rede');
    }
  };
  const fallback = await buildWebContext({
    sources,
    symbol: 'BTCUSDT',
    now: 1_700_000_100_000,
    fetchImpl,
    cache: new MemorySourceCache(),
    provider: failing
  });
  assert.equal(fallback.llm, 'desligado');
  assert.equal(fallback.items[0].method, 'lexico');
  assert.match(fallback.errors.join(' '), /sem rede/);
});

test('anthropic messages keep citations and fall back to the older search tool', async () => {
  const fixture = {
    stop_reason: 'end_turn',
    usage: { server_tool_use: { web_search_requests: 1 } },
    content: [
      { type: 'server_tool_use', name: 'web_search', input: { query: 'bitcoin' } },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.com/a', title: 'A' }] },
      {
        type: 'text',
        text: 'Resumo.',
        citations: [{ type: 'web_search_result_location', url: 'https://example.com/a', title: 'A', cited_text: 'trecho' }]
      }
    ]
  };
  const parsed = parseAnthropicMessage(fixture);
  assert.equal(parsed.searched, true);
  assert.equal(parsed.citations[0].citedText, 'trecho');

  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { tools?: { type: string }[] };
    const tool = body.tools?.[0]?.type ?? 'none';
    seen.push(tool);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-api-key'), 'test-key');
    assert.equal(headers.get('anthropic-version'), '2026-10-21');
    if (tool === 'web_search_20260209') return new Response('unsupported', { status: 400 });
    return new Response(JSON.stringify(fixture), { status: 200 });
  };
  const provider = new AnthropicProvider('test-key', 'claude-sonnet-4-6', 'https://api.anthropic.com', '2026-10-21', 'auto', fetchImpl);
  const result = await provider.complete({ system: 'sys', user: 'user', webSearch: true });
  assert.deepEqual(seen, ['web_search_20260209', 'web_search_20250305']);
  assert.equal(result.webSearch, 'usado');
  assert.equal(result.citations[0].url, 'https://example.com/a');
});

test('openai provider falls back when the responses endpoint is missing', async () => {
  const fetchImpl: typeof fetch = async input => {
    const url = String(input);
    if (url.endsWith('/responses')) return new Response('missing', { status: 404 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }), { status: 200 });
  };
  const provider = new OpenAiProvider('test-key', 'gpt-test', 'https://example.com/v1', fetchImpl);
  const result = await provider.complete({ system: 'sys', user: 'user', webSearch: true });
  assert.equal(result.webSearch, 'indisponível');
  assert.match(result.text, /items/);
});

test('provider selection prefers anthropic and stays off without a key', () => {
  assert.equal(createLlmProvider({} as NodeJS.ProcessEnv), null);
  assert.equal(createLlmProvider({ ARANHA_LLM_PROVIDER: 'off', ANTHROPIC_API_KEY: 'test-key' }), null);
  const claude = createLlmProvider({ ANTHROPIC_API_KEY: 'test-key', OPENAI_API_KEY: 'other' });
  assert.equal(claude?.id, 'anthropic');
  assert.equal(claude?.model, 'claude-sonnet-4-6');
  const openai = createLlmProvider({ OPENAI_API_KEY: 'test-key' });
  assert.equal(openai?.id, 'openai');
  const source = readFileSync(new URL('../server/aranha/llm.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sk-ant-|sk-[A-Za-z0-9]{20,}/);
});
