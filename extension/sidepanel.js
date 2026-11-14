import { detectPair, sourceLabel } from './lib/pair.js';
import { buildPanel, DEFAULT_SERVER, normalizeServerUrl, socketUrl } from './lib/panel.js';

const app = document.querySelector('#app');
const meta = document.querySelector('#meta');
const priceFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

const preview = new URLSearchParams(location.search);
const previewMode = preview.get('preview') === '1';
let serverUrl = normalizeServerUrl(preview.get('server')) || DEFAULT_SERVER;
let pinned = preview.get('symbol') ? preview.get('symbol').toUpperCase() : null;
let tabPair = previewMode
  ? detectPair(preview.get('tab') || 'https://www.binance.com/pt-BR/trade/BTC_USDT', preview.get('title') || '')
  : null;
let socket;
let timer = 0;

function money(value) {
  return value === null || value === undefined ? 'sem dados' : priceFmt.format(value);
}

function signed(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return 'sem dados';
  const text = priceFmt.format(value);
  return `${value > 0 ? '+' : ''}${text}${suffix}`;
}

function clock(value) {
  const time = Date.parse(value || '');
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(time);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function currentSymbol() {
  return pinned || tabPair?.symbol || null;
}

function render(state) {
  if (state.kind === 'offline') {
    app.innerHTML = `<p class="down">Servidor fora do ar. Confira o endereço em Servidor. Nada foi inventado no lugar dos dados.</p>`;
    return;
  }
  if (state.kind === 'loading') {
    app.innerHTML = `<p class="muted">Lendo o servidor…</p>`;
    return;
  }
  const view = state.view;
  const symbol = currentSymbol();
  const where = tabPair ? sourceLabel(tabPair.source) : '';
  meta.textContent = symbol
    ? `${symbol}${where ? ` · ${where}` : ''}${pinned ? ' · escolhido no painel' : ''}`
    : 'Nenhum par na aba aberta.';
  if (!symbol) {
    app.innerHTML = rankingHtml(view, 'Escolha um par do ranking. A aba aberta não é Binance nem TradingView, ou o endereço não tem um par.');
    return;
  }
  const bits = [];
  bits.push(`<div class="stat"><span>Preço</span><b>${money(view.price)}</b></div>`);
  bits.push(`<div class="stat"><span>Variação 24h</span><b>${signed(view.change24hPct, '%')}</b></div>`);
  bits.push(`<div class="stat"><span>Ranking</span><b>${view.rank ? `${view.rank} de ${view.universe}` : 'sem dados'}</b></div>`);
  bits.push(`<div class="stat"><span>Score</span><b>${signed(view.score)}</b></div>`);
  bits.push(`<h2>O que a Aranha está vendo</h2>`);
  bits.push(`<p>${view.reason ? escapeHtml(view.reason) : '<span class="empty">sem dados</span>'}</p>`);
  bits.push(`<h2>Previsão do Kronos</h2>`);
  bits.push(`<p>${view.kronosBps === null ? 'sem dados' : `${signed(view.kronosBps)} bps`}${view.kronosNote ? ` <span class="muted">${escapeHtml(view.kronosNote)}</span>` : ''}</p>`);
  bits.push(`<h2>Medo e ganância</h2>`);
  bits.push(`<p>${view.fear ? `${priceFmt.format(view.fear.value)} · ${escapeHtml(view.fear.label)}` : 'sem dados'}</p>`);
  bits.push(`<h2>Baleias do par</h2>`);
  bits.push(view.whales.length
    ? `<ul>${view.whales.map(item => `<li>${clock(item.time)} ${item.side} ${compact.format(item.usd)}</li>`).join('')}</ul>`
    : `<p class="empty">sem dados</p>`);
  bits.push(`<h2>Paredes do livro</h2>`);
  bits.push(view.walls.length
    ? `<ul>${view.walls.map(item => `<li>${item.side} ${money(item.price)} · ${compact.format(item.usd)}</li>`).join('')}</ul>`
    : `<p class="empty">sem dados</p>`);
  if (!view.reason && view.price === null && view.whales.length === 0 && view.walls.length === 0) {
    bits.unshift(`<p class="empty">sem dados para ${escapeHtml(symbol)} neste servidor.</p>`);
  }
  bits.push(rankingHtml(view, 'Outros pares do ranking'));
  app.innerHTML = bits.join('');
  bindRanking();
}

function rankingHtml(view, title) {
  if (!view.ranking.length) return `<h2>${title}</h2><p class="empty">sem dados</p>`;
  return `<h2>${escapeHtml(title)}</h2><ul>${view.ranking.map(item =>
    `<li><button type="button" class="linkish" data-symbol="${escapeHtml(item.symbol)}">${escapeHtml(item.symbol.replace(/USDT$/, ''))}</button> <span class="muted">${signed(item.score)}</span></li>`
  ).join('')}</ul>`;
}

function bindRanking() {
  for (const button of app.querySelectorAll('[data-symbol]')) {
    button.addEventListener('click', () => {
      pinned = button.dataset.symbol;
      refresh();
    });
  }
}

async function readJson(path) {
  const response = await fetch(`${serverUrl}${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

let shown = false;

async function refresh() {
  if (!shown) render({ kind: 'loading' });
  try {
    const symbol = currentSymbol();
    const live = await readJson('/api/aranha-live');
    const [detail, fear] = await Promise.all([
      symbol ? readJson(`/api/crawler/symbol/${encodeURIComponent(symbol)}`).catch(() => null) : Promise.resolve(null),
      readJson('/api/aranha').catch(() => null)
    ]);
    shown = true;
    render({ kind: 'ready', view: buildPanel({ symbol, live, detail, fear }) });
  } catch {
    shown = false;
    render({ kind: 'offline' });
  }
}

function connectSocket() {
  if (socket) socket.close();
  if (previewMode && preview.get('socket') === '0') return;
  try {
    socket = new WebSocket(socketUrl(serverUrl));
  } catch {
    return;
  }
  socket.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      if (message?.type === 'ARANHA_LIVE') refresh();
    } catch {
      // A bad frame does not replace the last good reading.
    }
  };
}

async function watchTab() {
  if (previewMode || !globalThis.chrome?.tabs) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabPair = tab?.url ? detectPair(tab.url, tab.title || '') : null;
  if (!pinned) refresh();
  else meta.textContent = `${currentSymbol()} · escolhido no painel`;
}

async function boot() {
  if (!previewMode && globalThis.chrome?.storage) {
    const stored = await chrome.storage.sync.get({ serverUrl: DEFAULT_SERVER });
    serverUrl = normalizeServerUrl(stored.serverUrl) || DEFAULT_SERVER;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.serverUrl) {
        serverUrl = normalizeServerUrl(changes.serverUrl.newValue) || DEFAULT_SERVER;
        connectSocket();
        refresh();
      }
    });
    chrome.tabs.onActivated.addListener(() => { watchTab(); });
    chrome.tabs.onUpdated.addListener((_id, _info, tab) => {
      if (tab.active) watchTab();
    });
    await watchTab();
  }
  document.querySelector('#follow').addEventListener('click', () => {
    pinned = null;
    refresh();
  });
  connectSocket();
  await refresh();
  timer = window.setInterval(refresh, 20000);
}

boot();
window.addEventListener('pagehide', () => {
  if (timer) window.clearInterval(timer);
  socket?.close();
});
