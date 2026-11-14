import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTeiaApp } from '../server/teia/handler';
import { buildTeiaMarkers, buildTeiaView, type TeiaPaths } from '../server/teia/read';
import {
  TEIA_BEFORE,
  TEIA_DISCLAIMER,
  TEIA_EMPTY,
  TEIA_EVENT_LIMIT,
  TEIA_NONE,
  TEIA_WHALE_MIN_USD,
  buildMarkers,
  parseTeiaQuery,
  teiaRadius
} from '../shared/teia';

const T = Date.parse('2026-11-14T15:00:00.000Z');
const MIN = 60_000;

function iso(time: number): string {
  return new Date(time).toISOString();
}

function writeFixture(): TeiaPaths {
  const root = mkdtempSync(join(tmpdir(), 'kronos-teia-'));
  const crawlerDir = join(root, 'crawler');
  const aranhaDir = join(root, 'snapshots');
  mkdirSync(crawlerDir);
  mkdirSync(aranhaDir);
  const whales = [
    { id: 'old', symbol: 'BTCUSDT', time: iso(T - 26 * 60 * MIN), usd: 150_000, side: 'compra', price: 90_000 },
    { id: 'edge', symbol: 'BTCUSDT', time: iso(T - 30 * MIN), usd: TEIA_WHALE_MIN_USD, side: 'venda', price: 99_000 },
    { id: 'inside', symbol: 'BTCUSDT', time: iso(T - 10 * MIN), usd: 250_000, side: 'compra', price: 100_000, volume: 9_999_999 },
    { id: 'hour', symbol: 'BTCUSDT', time: iso(T - 40 * MIN), usd: 800_000, side: 'compra', price: 98_000 },
    { id: 'at-open', symbol: 'BTCUSDT', time: iso(T), usd: 5_000_000, side: 'compra', price: 101_000 },
    { id: 'small', symbol: 'BTCUSDT', time: iso(T - 5 * MIN), usd: TEIA_WHALE_MIN_USD - 1, side: 'compra', price: 100_000, volume: 1e12 },
    { id: 'eth', symbol: 'ETHUSDT', time: iso(T - 8 * MIN), usd: 500_000, side: 'venda', price: 3_000 },
    'not-json'
  ];
  writeFileSync(join(crawlerDir, 'whales.jsonl'), `${whales.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n')}\n`);
  const chain = [
    { id: 'btc-tx', asset: 'BTC', time: iso(T - 12 * MIN), amount: '2.50 BTC', txid: 'btc-tx', url: 'https://example.test/btc', direction: 'entrada na corretora', label: 'Binance', source: 'fixture' },
    { id: 'eth-tx', asset: 'ETH', time: iso(T - 12 * MIN), amount: '10 ETH', txid: 'eth-tx', url: 'https://example.test/eth', direction: 'saída da corretora', label: 'Binance', source: 'fixture' }
  ];
  writeFileSync(join(crawlerDir, 'onchain.jsonl'), `${chain.map(row => JSON.stringify(row)).join('\n')}\n`);
  const rank = (time: number, rows: { symbol: string; rank: number; price: number; score: number }[]) =>
    rows.map(row => JSON.stringify({ t: iso(time), ...row, parts: { regime: row.score }, whalePressure: null, onchainIn: 0, onchainOut: 0 })).join('\n');
  writeFileSync(join(crawlerDir, 'rankings-2026-11-13.jsonl'), `${rank(T - 26 * 60 * MIN, [{ symbol: 'BTCUSDT', rank: 3, price: 1, score: 1 }])}\n`);
  writeFileSync(join(crawlerDir, 'rankings-2026-11-14.jsonl'), [
    rank(T - 20 * MIN, [
      { symbol: 'ETHUSDT', rank: 1, price: 3_000, score: 9 },
      { symbol: 'BTCUSDT', rank: 2, price: 100_000, score: 8 }
    ]),
    rank(T - 6 * MIN, [
      { symbol: 'ETHUSDT', rank: 1, price: 3_010, score: 9 },
      { symbol: 'BTCUSDT', rank: 2, price: 100_100, score: 7 }
    ]),
    rank(T + MIN, [
      { symbol: 'BTCUSDT', rank: 1, price: 200_000, score: 20 }
    ])
  ].join('\n') + '\n');
  writeFileSync(join(crawlerDir, 'walls-2026-11-14.jsonl'), `${JSON.stringify({
    t: iso(T - 9 * MIN),
    walls: [
      { symbol: 'BTCUSDT', side: 'compra', price: 99_500, usd: 400_000, distancePct: 0.4 },
      { symbol: 'ETHUSDT', side: 'venda', price: 3_020, usd: 900_000, distancePct: 0.2 }
    ]
  })}\n`);
  const asOf = iso(T - 11 * MIN);
  const snapshot = {
    asOf,
    fearGreed: { value: 28, classification: 'Fear', labelPt: 'Medo', fetchedAt: asOf },
    items: [
      { id: 'btc-news', title: 'Bitcoin testa liquidez', url: 'https://example.test/btc-news', source: 'Fixture', publishedAt: iso(T - 14 * MIN), fetchedAt: asOf, summary: 'Uma nota sobre Bitcoin.', relevance: 0.2 },
      { id: 'eth-news', title: 'Ethereum atualiza a rede', url: 'https://example.test/eth-news', source: 'Fixture', publishedAt: iso(T - 13 * MIN), fetchedAt: asOf, summary: 'Nota só sobre essa rede.', relevance: 0.2 },
      { id: 'old-news', title: 'Bitcoin de ontem', url: 'https://example.test/old', source: 'Fixture', publishedAt: iso(T - 3 * 60 * MIN), fetchedAt: asOf, summary: 'Fora da janela.', relevance: 0.2 }
    ]
  };
  writeFileSync(join(aranhaDir, `web-${asOf.replace(/[:.]/g, '-')}.json`), `${JSON.stringify(snapshot)}\n`);
  return { crawlerDir, aranhaDir };
}

function snapshotFiles(paths: TeiaPaths): string {
  return ['whales.jsonl', 'onchain.jsonl', 'rankings-2026-11-14.jsonl', 'walls-2026-11-14.jsonl']
    .map(name => readFileSync(join(paths.crawlerDir, name), 'utf8'))
    .join('\n---\n');
}

test('the window keeps prior events and drops the candle open, other pairs and small prints', async () => {
  const paths = writeFixture();
  const view = await buildTeiaView(paths, { symbol: 'BTCUSDT', time: T, window: '30m' });
  assert.equal(view.mode, 'vela');
  assert.equal(view.disclaimer, TEIA_DISCLAIMER);
  assert.equal(view.from, T - 30 * MIN);
  assert.equal(view.to, T);
  assert.equal(view.empty, false);
  const ids = view.events.map(event => event.id);
  assert.equal(ids.includes('edge'), true);
  assert.equal(ids.includes('inside'), true);
  assert.equal(ids.includes('btc-tx'), true);
  assert.equal(ids.includes('hour'), false);
  assert.equal(ids.includes('at-open'), false);
  assert.equal(ids.includes('small'), false);
  assert.equal(ids.includes('eth'), false);
  assert.equal(ids.includes('eth-tx'), false);
  assert.equal(ids.includes('noticia-eth-news'), false);
  assert.equal(ids.includes('noticia-old-news'), false);
  assert.equal(ids.includes('noticia-btc-news'), true);
  const whale = view.events.find(event => event.id === 'inside');
  assert.equal(whale?.usd, 250_000);
  assert.equal(JSON.stringify(view).includes('"volume"'), false);
  const chain = view.events.find(event => event.id === 'btc-tx');
  assert.equal(chain?.usd, 250_000);
  const rank = view.events.find(event => event.kind === 'ranking');
  assert.equal(rank?.title, 'posição 2 de 2');
  assert.equal(rank?.time, T - 6 * MIN);
  assert.equal(view.events.some(event => event.kind === 'parede' && event.usd === 400_000), true);
  assert.equal(view.events.some(event => event.kind === 'medo' && event.title.includes('Medo')), true);
  assert.equal(view.events.some(event => event.kind === 'noticia' && event.title.includes('Bitcoin testa')), true);
  assert.equal(JSON.stringify(view).includes('sinal'), false);
  assert.equal(JSON.stringify(view).toLowerCase().includes('causal'), false);
});

test('a longer window reaches further back, and a shorter one does not', async () => {
  const paths = writeFixture();
  const hour = await buildTeiaView(paths, { symbol: 'BTCUSDT', time: T, window: '1h' });
  const quarter = await buildTeiaView(paths, { symbol: 'BTCUSDT', time: T, window: '15m' });
  assert.equal(hour.events.some(event => event.id === 'hour'), true);
  assert.equal(quarter.events.some(event => event.id === 'hour'), false);
  assert.equal(quarter.events.some(event => event.id === 'edge'), false);
  assert.equal(quarter.events.some(event => event.id === 'inside'), true);
});

test('ETH keeps its own prints and chain, not the BTC ones', async () => {
  const paths = writeFixture();
  const view = await buildTeiaView(paths, { symbol: 'ETHUSDT', time: T, window: '30m' });
  const ids = view.events.map(event => event.id);
  assert.equal(ids.includes('eth'), true);
  assert.equal(ids.includes('eth-tx'), true);
  assert.equal(ids.includes('inside'), false);
  assert.equal(ids.includes('btc-tx'), false);
  assert.equal(view.events.some(event => event.kind === 'noticia' && event.title.includes('Ethereum')), true);
  assert.equal(view.events.some(event => event.title.includes('Bitcoin testa')), false);
  assert.equal(view.events.some(event => event.kind === 'parede' && event.usd === 900_000), true);
  assert.equal(view.events.some(event => event.kind === 'parede' && event.usd === 400_000), false);
});

test('the event list is capped without using candle volume', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kronos-teia-cap-'));
  const paths = { crawlerDir: root, aranhaDir: join(root, 'empty') };
  mkdirSync(paths.aranhaDir);
  const lines = Array.from({ length: TEIA_EVENT_LIMIT + 5 }, (_, index) => JSON.stringify({
    id: `w${index}`,
    symbol: 'BTCUSDT',
    time: iso(T - MIN - index),
    usd: TEIA_WHALE_MIN_USD + index,
    side: 'compra',
    price: 100,
    volume: 1
  }));
  writeFileSync(join(root, 'whales.jsonl'), `${lines.join('\n')}\n`);
  const view = await buildTeiaView(paths, { symbol: 'BTCUSDT', time: T, window: '4h' });
  assert.equal(view.truncated, true);
  assert.equal(view.total, TEIA_EVENT_LIMIT + 5);
  assert.equal(view.events.length, TEIA_EVENT_LIMIT);
  assert.equal(view.events.some(event => event.id === `w${TEIA_EVENT_LIMIT + 4}`), true);
  assert.equal(view.events.some(event => event.id === 'w0'), false);
  assert.equal(view.events.every(event => event.usd !== null && event.usd >= TEIA_WHALE_MIN_USD), true);
});

test('an empty recorded window and a time before the archive say so', async () => {
  const paths = writeFixture();
  const quiet = await buildTeiaView(paths, { symbol: 'BTCUSDT', time: T + 6 * 60 * MIN, window: '15m' });
  assert.equal(quiet.empty, true);
  assert.equal(quiet.emptyMessage, TEIA_EMPTY);
  assert.equal(quiet.events.length, 0);

  const root = mkdtempSync(join(tmpdir(), 'kronos-teia-before-'));
  const early = { crawlerDir: root, aranhaDir: join(root, 'snap') };
  mkdirSync(early.aranhaDir);
  writeFileSync(join(root, 'whales.jsonl'), `${JSON.stringify({
    id: 'later', symbol: 'BTCUSDT', time: iso(T), usd: 200_000, side: 'compra', price: 1
  })}\n`);
  const before = await buildTeiaView(early, { symbol: 'BTCUSDT', time: T - 2 * 60 * MIN, window: '30m' });
  assert.equal(before.empty, true);
  assert.equal(before.emptyMessage, TEIA_BEFORE);
  assert.equal(before.events.length, 0);
  assert.match(before.recordingNote ?? '', /2026-11-14T15:00:00.000Z/);

  const none = await buildTeiaView(
    { crawlerDir: join(root, 'missing'), aranhaDir: join(root, 'also-missing') },
    { symbol: 'BTCUSDT', time: T, window: '30m' }
  );
  assert.equal(none.emptyMessage, TEIA_NONE);
});

test('markers follow the pair and the prior window, and a huge span is refused', async () => {
  const paths = writeFixture();
  const markers = await buildTeiaMarkers(paths, {
    symbol: 'BTCUSDT',
    from: T - 60 * MIN,
    to: T + 60 * MIN,
    window: '30m',
    interval: '5m'
  });
  assert.equal(markers.mode, 'marcadores');
  assert.equal(markers.disclaimer, TEIA_DISCLAIMER);
  const times = markers.markers.map(marker => marker.time);
  assert.equal(times.includes(T), true);
  assert.equal(times.includes(T - 55 * MIN), false);
  assert.equal(times.includes(T + 35 * MIN), false);
  const eth = await buildTeiaMarkers(paths, {
    symbol: 'ETHUSDT',
    from: T - 60 * MIN,
    to: T + 60 * MIN,
    window: '30m',
    interval: '5m'
  });
  assert.equal(eth.markers.some(marker => marker.time === T), true);
  const touched = buildMarkers([T], T - 60 * MIN, T + 60 * MIN, 5 * MIN, 30 * MIN);
  assert.equal(touched.markers.some(marker => marker.time === T), false);
  assert.equal(touched.markers[0]?.time, T + 5 * MIN);
  const parsed = parseTeiaQuery({
    symbol: 'BTCUSDT',
    from: String(T),
    to: String(T + 22 * 24 * 60 * MIN),
    interval: '5m'
  });
  assert.equal(parsed.ok, false);
});

test('GET /api/teia is read-only and rejects a bad query', async () => {
  const paths = writeFixture();
  const before = snapshotFiles(paths);
  const app = createTeiaApp(paths);
  const server: Server = await new Promise(resolve => {
    const listening = createServer(app);
    listening.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const ok = await fetch(`http://127.0.0.1:${port}/api/teia?symbol=BTCUSDT&time=${T}`);
    const body = await ok.json() as { window: string; events: { id: string }[]; disclaimer: string };
    assert.equal(ok.status, 200);
    assert.equal(body.window, '30m');
    assert.equal(body.disclaimer, TEIA_DISCLAIMER);
    assert.equal(body.events.some(event => event.id === 'inside'), true);
    assert.equal(body.events.some(event => event.id === 'hour'), false);

    const badSymbol = await fetch(`http://127.0.0.1:${port}/api/teia?symbol=BT&time=${T}`);
    assert.equal(badSymbol.status, 400);
    const badWindow = await fetch(`http://127.0.0.1:${port}/api/teia?symbol=BTCUSDT&time=${T}&window=2h`);
    assert.equal(badWindow.status, 400);
    const missing = await fetch(`http://127.0.0.1:${port}/api/teia?window=30m`);
    assert.equal(missing.status, 400);
    const posted = await fetch(`http://127.0.0.1:${port}/api/teia?symbol=BTCUSDT&time=${T}`, { method: 'POST' });
    assert.equal(posted.status, 404);
    assert.equal(snapshotFiles(paths), before);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('node radius grows with recorded dollars and ignores a missing amount', () => {
  assert.ok(teiaRadius(1_000_000) > teiaRadius(100_000));
  assert.ok(teiaRadius(100_000) > teiaRadius(null));
  assert.equal(teiaRadius(null), teiaRadius(0));
});
