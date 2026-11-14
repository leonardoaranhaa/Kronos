import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TeiaPanel } from '../src/client/TeiaPanel';
import {
  TEIA_BEFORE,
  TEIA_DISCLAIMER,
  TEIA_EMPTY,
  layoutTeia,
  teiaRadius,
  type TeiaView
} from '../shared/teia';

function view(partial: Partial<TeiaView>): TeiaView {
  return {
    mode: 'vela',
    symbol: 'BTCUSDT',
    time: Date.parse('2026-11-14T15:00:00.000Z'),
    window: '30m',
    windowMs: 1_800_000,
    from: Date.parse('2026-11-14T14:30:00.000Z'),
    to: Date.parse('2026-11-14T15:00:00.000Z'),
    disclaimer: TEIA_DISCLAIMER,
    recordingStartedAt: Date.parse('2026-11-13T12:00:00.000Z'),
    recordingNote: null,
    empty: false,
    emptyMessage: null,
    truncated: false,
    total: 2,
    events: [
      {
        id: 'whale',
        kind: 'baleia',
        time: Date.parse('2026-11-14T14:50:00.000Z'),
        usd: 850_000,
        title: 'US$ 850 mil',
        detail: 'Negócio agregado na Binance.'
      },
      {
        id: 'chain',
        kind: 'cadeia',
        time: Date.parse('2026-11-14T14:48:00.000Z'),
        usd: 1_500_000,
        title: '15.50 BTC',
        detail: 'entrada na corretora'
      }
    ],
    ...partial
  };
}

function html(node: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(node);
}

test('the panel keeps the fixed honesty line, the empty copy, and the event list', () => {
  const filled = html(createElement(TeiaPanel, {
    view: view({}),
    windowId: '30m',
    pinned: true,
    loading: false,
    error: '',
    onWindow: () => undefined,
    onClose: () => undefined
  }));
  assert.match(filled, new RegExp(TEIA_DISCLAIMER));
  assert.match(filled, /US\$ 850 mil/);
  assert.match(filled, /15\.50 BTC/);
  assert.match(filled, /Baleia/);
  assert.match(filled, /On-chain/);
  assert.match(filled, /<line /);
  assert.equal(filled.toLowerCase().includes('causalidade'), false);
  assert.equal(filled.toLowerCase().includes('sinal de compra'), false);
  assert.equal(filled.toLowerCase().includes('sinal de venda'), false);
  assert.match(filled, /15 min/);
  assert.match(filled, /30 min/);
  assert.match(filled, /1 h/);
  assert.match(filled, /4 h/);

  const empty = html(createElement(TeiaPanel, {
    view: view({ empty: true, emptyMessage: TEIA_EMPTY, events: [], total: 0 }),
    windowId: '30m',
    pinned: false,
    loading: false,
    error: '',
    onWindow: () => undefined,
    onClose: () => undefined
  }));
  assert.match(empty, new RegExp(TEIA_EMPTY));
  assert.match(empty, new RegExp(TEIA_DISCLAIMER));
  assert.equal(empty.includes('<line '), false);

  const before = html(createElement(TeiaPanel, {
    view: view({
      empty: true,
      emptyMessage: TEIA_BEFORE,
      recordingNote: 'A gravação começa em 2026-11-14T15:00:00.000Z.',
      events: [],
      total: 0
    }),
    windowId: '1h',
    pinned: true,
    loading: false,
    error: '',
    onWindow: () => undefined,
    onClose: () => undefined
  }));
  assert.match(before, new RegExp(TEIA_BEFORE));
  assert.match(before, /A gravação começa em/);
});

test('event nodes sit off the candle and a larger dollar value draws a larger point', () => {
  const events = [
    { id: 'small', usd: 100_000 },
    { id: 'large', usd: 20_000_000 }
  ];
  const layout = layoutTeia(events, 300, 200);
  assert.equal(layout.nodes.length, 2);
  assert.ok(teiaRadius(events[1].usd) > teiaRadius(events[0].usd));
  for (const node of layout.nodes) {
    assert.ok(Math.hypot(node.x - layout.cx, node.y - layout.cy) > node.r);
    assert.equal(node.r, teiaRadius(events.find(event => event.id === node.id)?.usd ?? null));
  }
  const alone = layoutTeia([{ id: 'only', usd: null }]);
  assert.ok(alone.nodes[0].y < alone.cy);
});
