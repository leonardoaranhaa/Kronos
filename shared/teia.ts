/** Visual timeline of recorded events. Nothing here is a signal or a cause. */

export const TEIA_WINDOWS = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000
} as const;

export type TeiaWindowId = keyof typeof TEIA_WINDOWS;

export const TEIA_INTERVALS = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000
} as const;

export type TeiaIntervalId = keyof typeof TEIA_INTERVALS;

export const TEIA_DISCLAIMER = 'Eventos próximos no tempo não provam causa.';
export const TEIA_EMPTY = 'sem eventos gravados nessa janela';
export const TEIA_BEFORE = 'Dados de antes do início da gravação não existem.';
export const TEIA_NONE = 'Ainda não há gravação. Dados de antes do início da gravação não existem.';

/** aggTrades at or above this notional. The candle's own volume is never an input. */
export const TEIA_WHALE_MIN_USD = 100_000;
export const TEIA_EVENT_LIMIT = 40;
export const TEIA_MARKER_LIMIT = 1500;
export const TEIA_MAX_SPAN_MS = 21 * 24 * 60 * 60 * 1000;

export type TeiaKind = 'baleia' | 'parede' | 'cadeia' | 'noticia' | 'medo' | 'ranking';

export const TEIA_KIND_LABEL: Record<TeiaKind, string> = {
  baleia: 'Baleia',
  parede: 'Parede do livro',
  cadeia: 'On-chain',
  noticia: 'Notícia',
  medo: 'Medo e ganância',
  ranking: 'Ranking'
};

export const TEIA_KIND_COLOR: Record<TeiaKind, string> = {
  baleia: '#38bdf8',
  parede: '#a78bfa',
  cadeia: '#fbbf24',
  noticia: '#94a3b8',
  medo: '#fb923c',
  ranking: '#34d399'
};

export interface TeiaEvent {
  id: string;
  kind: TeiaKind;
  time: number;
  /** Dollar notional when the recording has one. Null is drawn at the minimum size. */
  usd: number | null;
  title: string;
  detail: string;
}

export interface TeiaView {
  mode: 'vela';
  symbol: string;
  time: number;
  window: TeiaWindowId;
  windowMs: number;
  from: number;
  to: number;
  disclaimer: typeof TEIA_DISCLAIMER;
  recordingStartedAt: number | null;
  recordingNote: string | null;
  empty: boolean;
  emptyMessage: string | null;
  truncated: boolean;
  total: number;
  events: TeiaEvent[];
}

export interface TeiaMarker {
  time: number;
  count: number;
}

export interface TeiaMarkers {
  mode: 'marcadores';
  symbol: string;
  window: TeiaWindowId;
  windowMs: number;
  from: number;
  to: number;
  interval: TeiaIntervalId;
  disclaimer: typeof TEIA_DISCLAIMER;
  recordingStartedAt: number | null;
  recordingNote: string | null;
  truncated: boolean;
  markers: TeiaMarker[];
}

export type TeiaQuery =
  | { kind: 'vela'; symbol: string; time: number; window: TeiaWindowId }
  | { kind: 'marcadores'; symbol: string; from: number; to: number; window: TeiaWindowId; interval: TeiaIntervalId };

export function isTeiaWindow(value: string): value is TeiaWindowId {
  return Object.prototype.hasOwnProperty.call(TEIA_WINDOWS, value);
}

export function isTeiaInterval(value: string): value is TeiaIntervalId {
  return Object.prototype.hasOwnProperty.call(TEIA_INTERVALS, value);
}

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** Milliseconds since epoch, or an ISO string. Seconds are rejected. */
export function parseTeiaTime(value: unknown): number | null {
  const raw = firstQueryValue(value);
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 1e11 || raw >= 1e14) return null;
    return Math.round(raw);
  }
  const text = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    if (!Number.isFinite(numeric) || numeric <= 1e11 || numeric >= 1e14) return null;
    return Math.round(numeric);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed;
}

export function parseTeiaQuery(input: { [key: string]: unknown }): { ok: true; query: TeiaQuery } | { ok: false; error: string } {
  const symbol = String(firstQueryValue(input.symbol) ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) return { ok: false, error: 'Símbolo inválido.' };
  const windowRaw = String(firstQueryValue(input.window) ?? '30m');
  if (!isTeiaWindow(windowRaw)) return { ok: false, error: 'Janela inválida. Use 15m, 30m, 1h ou 4h.' };
  const timeValue = firstQueryValue(input.time);
  const hasTime = timeValue !== undefined && String(timeValue).trim() !== '';
  if (hasTime) {
    const time = parseTeiaTime(timeValue);
    if (time === null) return { ok: false, error: 'time inválido. Use milissegundos da abertura da vela.' };
    return { ok: true, query: { kind: 'vela', symbol, time, window: windowRaw } };
  }
  const from = parseTeiaTime(input.from);
  const to = parseTeiaTime(input.to);
  if (from === null || to === null || !(from < to)) {
    return { ok: false, error: 'Informe time, ou from e to, em milissegundos.' };
  }
  if (to - from > TEIA_MAX_SPAN_MS) return { ok: false, error: 'Intervalo longo demais.' };
  const intervalRaw = String(firstQueryValue(input.interval) ?? '5m');
  if (!isTeiaInterval(intervalRaw)) return { ok: false, error: 'interval inválido.' };
  return { ok: true, query: { kind: 'marcadores', symbol, from, to, window: windowRaw, interval: intervalRaw } };
}

/**
 * Radius grows with recorded dollar notional. Missing dollars stay at the minimum.
 * The candle volume is not an argument, on purpose.
 */
export function teiaRadius(usd: number | null): number {
  if (usd === null || !(usd > 0)) return 6;
  const t = Math.min(1, Math.max(0, (Math.log10(usd) - 4) / 4));
  return 6 + t * 16;
}

export interface TeiaNode {
  id: string;
  x: number;
  y: number;
  r: number;
}

/** Candle in the center. Events sit on a circle, in time order. */
export function layoutTeia(
  events: readonly { id: string; usd: number | null }[],
  width = 300,
  height = 200
): { cx: number; cy: number; nodes: TeiaNode[] } {
  const cx = width / 2;
  const cy = height / 2;
  const orbit = Math.min(width, height) * 0.34;
  const count = events.length;
  return {
    cx,
    cy,
    nodes: events.map((event, index) => {
      const angle = -Math.PI / 2 + (count <= 1 ? 0 : index / count) * Math.PI * 2;
      return {
        id: event.id,
        x: cx + Math.cos(angle) * orbit,
        y: cy + Math.sin(angle) * orbit,
        r: teiaRadius(event.usd)
      };
    })
  };
}

/** Candle opens strictly after the event and at most `windowMs` later. */
export function candlesTouchedByEvent(
  eventTime: number,
  from: number,
  to: number,
  intervalMs: number,
  windowMs: number
): number[] {
  const times: number[] = [];
  let cursor = Math.floor(eventTime / intervalMs) * intervalMs;
  if (cursor <= eventTime) cursor += intervalMs;
  const last = eventTime + windowMs;
  for (; cursor <= last && cursor < to; cursor += intervalMs) {
    if (cursor < from) continue;
    times.push(cursor);
  }
  return times;
}

export function buildMarkers(
  eventTimes: readonly number[],
  from: number,
  to: number,
  intervalMs: number,
  windowMs: number,
  limit = TEIA_MARKER_LIMIT
): { markers: TeiaMarker[]; truncated: boolean } {
  const counts = new Map<number, number>();
  for (const eventTime of eventTimes) {
    for (const candle of candlesTouchedByEvent(eventTime, from, to, intervalMs, windowMs)) {
      counts.set(candle, (counts.get(candle) ?? 0) + 1);
    }
  }
  let entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  let truncated = false;
  if (entries.length > limit) {
    truncated = true;
    entries = entries.slice(entries.length - limit);
  }
  return {
    markers: entries.map(([time, count]) => ({ time, count })),
    truncated
  };
}

/** Keeps every kind that appeared, then the largest dollar amounts, then restores time order. */
export function limitTeiaEvents(events: readonly TeiaEvent[], limit = TEIA_EVENT_LIMIT): { events: TeiaEvent[]; truncated: boolean; total: number } {
  const total = events.length;
  const byTime = (list: readonly TeiaEvent[]) => list.slice().sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  if (total <= limit) return { events: byTime(events), truncated: false, total };
  const ranked = events.slice().sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.time - a.time);
  const kept = new Map<string, TeiaEvent>();
  for (const event of ranked) {
    if (kept.size >= limit) break;
    if ([...kept.values()].some(item => item.kind === event.kind)) continue;
    kept.set(event.id, event);
  }
  for (const event of ranked) {
    if (kept.size >= limit) break;
    kept.set(event.id, event);
  }
  return { events: byTime([...kept.values()]), truncated: true, total };
}

const ASSET_WORDS: Record<string, string[]> = {
  BTC: ['btc', 'bitcoin', 'xbt'],
  ETH: ['eth', 'ethereum', 'ether'],
  SOL: ['sol', 'solana'],
  BNB: ['bnb'],
  XRP: ['xrp', 'ripple'],
  DOGE: ['doge', 'dogecoin'],
  ADA: ['ada', 'cardano'],
  AVAX: ['avax', 'avalanche'],
  LINK: ['link', 'chainlink'],
  DOT: ['dot', 'polkadot'],
  LTC: ['ltc', 'litecoin'],
  BCH: ['bch', 'bitcoin cash']
};

export function pairBase(symbol: string): string {
  return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
}

export function textMentionsAsset(text: string, base: string): boolean {
  const folded = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (base === 'BTC' && folded.includes('bitcoin cash')) {
    const without = folded.replace(/bitcoin cash/g, ' ');
    return textMentionsAsset(without, 'BTC');
  }
  const words = ASSET_WORDS[base] ?? [base.toLowerCase()];
  return words.some(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(folded);
  });
}

export function formatTeiaUsd(usd: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(usd);
}

export function formatTeiaPrice(price: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(price);
}

export function formatTeiaClock(time: number): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(time);
}
