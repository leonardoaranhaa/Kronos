import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPanel, coversKnownHost, normalizeServerUrl, parseLive, socketUrl } from '../extension/lib/panel.js';

const live = {
  updatedAt: '2026-11-14T12:00:00.000Z',
  disclaimer: 'Pesquisa.',
  kronosNote: 'O modelo não está pronto.',
  rows: [
    { symbol: 'ETHUSDT', score: 12.5, lastPrice: 3200, change24hPct: 1.2, reason: '1h e 4h estão em alta.', kronos: 'rodou', kronosBps: 15 },
    { symbol: 'BTCUSDT', score: 4, lastPrice: 67000, change24hPct: -0.4, reason: 'Força parecida com a do BTC.', kronos: 'fila', kronosBps: null },
    { symbol: 'nope', score: 'x' }
  ],
  whales: [
    { symbol: 'BTCUSDT', side: 'compra', usd: 180000, time: '2026-11-14T12:00:00.000Z', price: 67010 },
    { symbol: 'ETHUSDT', side: 'venda', usd: 120000, time: '2026-11-14T12:01:00.000Z' },
    { symbol: 'BTCUSDT', side: 'lado', usd: 1 }
  ],
  walls: [
    { symbol: 'BTCUSDT', side: 'compra', price: 66000, usd: 400000 },
    { symbol: 'ETHUSDT', side: 'venda', price: 3300, usd: 200000 }
  ],
  forecastBps: { BTCUSDT: -8 }
};

test('the live payload keeps only complete rows, whales and walls', () => {
  const parsed = parseLive(live);
  assert.deepEqual(parsed.rows.map(item => item.symbol), ['ETHUSDT', 'BTCUSDT']);
  assert.equal(parsed.whales.length, 2);
  assert.equal(parsed.walls.length, 2);
  assert.equal(parseLive(null).rows.length, 0);
});

test('a known pair joins rank, aranha text, fear and the kronos number', () => {
  const view = buildPanel({
    symbol: 'BTCUSDT',
    live,
    detail: { symbol: 'BTCUSDT', score: { score: 4.2, lastPrice: 67100, reason: 'Sem rompimento agora.' }, context: { verdict: { bias: 'neutro', note: 'ignorar' } } },
    fear: { web: { fearGreed: { value: '28', labelPt: 'Medo' } } }
  });
  assert.equal(view.rank, 2);
  assert.equal(view.universe, 2);
  assert.equal(view.price, 67100);
  assert.equal(view.change24hPct, -0.4);
  assert.equal(view.reason, 'Sem rompimento agora.');
  assert.equal(view.fear?.label, 'Medo');
  assert.equal(view.whales.length, 1);
  assert.equal(view.walls.length, 1);
  assert.equal(view.kronosBps, null);
  const missing = buildPanel({ symbol: 'ADAUSDT', live, detail: null, fear: {} });
  assert.equal(missing.rank, null);
  assert.equal(missing.price, null);
  assert.equal(missing.reason, null);
  assert.equal(missing.kronosBps, null);
});

test('server urls stay http(s) and the socket uses /ws', () => {
  assert.equal(normalizeServerUrl(' https://abc.trycloudflare.com/api/ '), 'https://abc.trycloudflare.com');
  assert.equal(normalizeServerUrl(''), 'http://localhost:3000');
  assert.equal(normalizeServerUrl('javascript:alert(1)'), null);
  assert.equal(socketUrl('https://abc.trycloudflare.com'), 'wss://abc.trycloudflare.com/ws');
  assert.equal(coversKnownHost('http://127.0.0.1:3000'), true);
  assert.equal(coversKnownHost('https://evil.example'), false);
});

test('the manifest only reads tabs and does not touch the exchange page', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions.slice().sort(), ['sidePanel', 'storage', 'tabs']);
  const hosts = JSON.stringify(manifest.host_permissions);
  assert.equal(hosts.includes('binance'), false);
  assert.equal(hosts.includes('tradingview'), false);
  assert.equal(hosts.includes('localhost'), true);
  assert.equal(hosts.includes('trycloudflare.com'), true);
});
