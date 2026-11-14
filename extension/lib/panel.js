export const DEFAULT_SERVER = 'http://localhost:3000';

export function normalizeServerUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return DEFAULT_SERVER;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function socketUrl(serverUrl) {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function coversKnownHost(serverUrl) {
  try {
    const url = new URL(serverUrl);
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
    if (url.protocol === 'https:' && url.hostname.endsWith('.trycloudflare.com')) return true;
    return false;
  } catch {
    return false;
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function whale(item) {
  if (!item || typeof item !== 'object') return null;
  const symbol = textOrNull(item.symbol);
  const side = item.side === 'compra' || item.side === 'venda' ? item.side : null;
  const usd = numberOrNull(item.usd);
  if (!symbol || !side || usd === null) return null;
  return { symbol, side, usd, time: textOrNull(item.time), price: numberOrNull(item.price) };
}

function wall(item) {
  if (!item || typeof item !== 'object') return null;
  const symbol = textOrNull(item.symbol);
  const side = item.side === 'compra' || item.side === 'venda' ? item.side : null;
  const price = numberOrNull(item.price);
  const usd = numberOrNull(item.usd);
  if (!symbol || !side || price === null || usd === null) return null;
  return { symbol, side, price, usd };
}

function row(item) {
  if (!item || typeof item !== 'object') return null;
  const symbol = textOrNull(item.symbol);
  const score = numberOrNull(item.score);
  const lastPrice = numberOrNull(item.lastPrice);
  if (!symbol || (score === null && lastPrice === null)) return null;
  return {
    symbol,
    score,
    lastPrice,
    change24hPct: numberOrNull(item.change24hPct),
    reason: textOrNull(item.reason),
    kronos: textOrNull(item.kronos),
    kronosBps: numberOrNull(item.kronosBps)
  };
}

export function parseLive(payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  const rows = asList(body.rows).map(row).filter(Boolean);
  return {
    updatedAt: textOrNull(body.updatedAt),
    disclaimer: textOrNull(body.disclaimer),
    kronosNote: textOrNull(body.kronosNote),
    rows,
    whales: asList(body.whales).map(whale).filter(Boolean),
    walls: asList(body.walls).map(wall).filter(Boolean),
    forecastBps: body.forecastBps && typeof body.forecastBps === 'object' ? body.forecastBps : {}
  };
}

export function parseDetail(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const score = payload.score && typeof payload.score === 'object' ? payload.score : null;
  const verdict = payload.context?.verdict;
  return {
    symbol: textOrNull(payload.symbol),
    score: score ? numberOrNull(score.score) : null,
    lastPrice: score ? numberOrNull(score.lastPrice) : null,
    reason: textOrNull(score?.reason) || textOrNull(verdict?.note),
    bias: textOrNull(verdict?.bias)
  };
}

export function parseFear(payload) {
  const fear = payload?.web?.fearGreed;
  if (!fear || typeof fear !== 'object') return null;
  const value = numberOrNull(fear.value);
  if (value === null) return null;
  return { value, label: textOrNull(fear.labelPt) || textOrNull(fear.classification) || 'sem rótulo' };
}

/**
 * Joins the public research payloads into what the side panel shows.
 * Missing pieces stay null so the screen can say "sem dados" without inventing a number.
 */
export function buildPanel({ symbol, live, detail, fear }) {
  const parsed = parseLive(live);
  const card = parseDetail(detail);
  const mood = parseFear(fear);
  const rows = parsed.rows;
  const wanted = symbol ? symbol.toUpperCase() : null;
  const index = wanted ? rows.findIndex(item => item.symbol === wanted) : -1;
  const ranked = index >= 0 ? rows[index] : null;
  const forecast = wanted ? numberOrNull(parsed.forecastBps[wanted]) : null;
  return {
    symbol: wanted,
    price: card?.lastPrice ?? ranked?.lastPrice ?? null,
    change24hPct: ranked?.change24hPct ?? null,
    rank: index >= 0 ? index + 1 : null,
    universe: rows.length,
    score: card?.score ?? ranked?.score ?? null,
    reason: card?.reason || ranked?.reason || null,
    bias: card?.bias || null,
    whales: parsed.whales.filter(item => !wanted || item.symbol === wanted).slice(0, 5),
    walls: parsed.walls.filter(item => !wanted || item.symbol === wanted).slice(0, 4),
    fear: mood,
    kronosBps: ranked ? ranked.kronosBps : forecast,
    kronos: ranked?.kronos || null,
    kronosNote: parsed.kronosNote,
    disclaimer: parsed.disclaimer,
    ranking: rows.slice(0, 12),
    updatedAt: parsed.updatedAt
  };
}
