import { closeSync, createReadStream, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  TEIA_BEFORE,
  TEIA_DISCLAIMER,
  TEIA_EMPTY,
  TEIA_INTERVALS,
  TEIA_NONE,
  TEIA_WHALE_MIN_USD,
  TEIA_WINDOWS,
  buildMarkers,
  formatTeiaPrice,
  formatTeiaUsd,
  limitTeiaEvents,
  pairBase,
  textMentionsAsset,
  type TeiaEvent,
  type TeiaIntervalId,
  type TeiaMarkers,
  type TeiaView,
  type TeiaWindowId
} from '../../shared/teia';

export interface TeiaPaths {
  crawlerDir: string;
  aranhaDir: string;
}

interface PriceTick {
  time: number;
  symbol: string;
  price: number;
}

interface RawChain {
  id: string;
  time: number;
  asset: string;
  amount: string;
  direction: string;
  label: string | null;
  source: string;
}

function listNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function parseEpoch(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1e11 && value < 1e14) return Math.round(value);
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function timeOf(row: unknown): number | null {
  const record = asRecord(row);
  if (!record) return null;
  for (const key of ['time', 't', 'asOf']) {
    const parsed = parseEpoch(record[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstJsonLine(path: string): unknown | null {
  if (!existsSync(path)) return null;
  const fd = openSync(path, 'r');
  try {
    let text = '';
    const buf = Buffer.alloc(65536);
    while (!text.includes('\n') && text.length < 1_000_000) {
      const n = readSync(fd, buf, 0, buf.length, text.length);
      if (n <= 0) break;
      text += buf.toString('utf8', 0, n);
    }
    const line = text.split('\n')[0]?.trim();
    if (!line) return null;
    try {
      return JSON.parse(line) as unknown;
    } catch {
      return null;
    }
  } finally {
    closeSync(fd);
  }
}

async function forEachJsonl(path: string, visit: (row: unknown) => void): Promise<void> {
  if (!existsSync(path)) return;
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      visit(JSON.parse(trimmed) as unknown);
    } catch {
      // A torn line is skipped. The rest of the file still counts.
    }
  }
}

function snapshotTimeFromName(name: string): number | null {
  const match = name.match(/^web-(.+)\.json$/);
  if (!match) return null;
  const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d+)Z$/, 'T$1:$2:$3.$4Z');
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function journalFiles(dir: string, from: number, to: number): string[] {
  const days = new Set<string>();
  const start = from - 24 * 60 * 60 * 1000;
  for (let cursor = start; cursor <= to; cursor += 24 * 60 * 60 * 1000) {
    days.add(new Date(cursor).toISOString().slice(0, 10));
  }
  days.add(new Date(from).toISOString().slice(0, 10));
  days.add(new Date(to).toISOString().slice(0, 10));
  return listNames(dir).filter(name => {
    const match = name.match(/^(?:rankings|walls)-(\d{4}-\d{2}-\d{2})(?:\.\d+)?\.jsonl$/);
    return Boolean(match && days.has(match[1]));
  });
}

export async function recordingStartedAt(paths: TeiaPaths): Promise<number | null> {
  let min: number | null = null;
  const consider = (value: number | null) => {
    if (value === null) return;
    if (min === null || value < min) min = value;
  };
  for (const name of ['whales.jsonl', 'onchain.jsonl']) {
    consider(timeOf(firstJsonLine(join(paths.crawlerDir, name))));
  }
  for (const name of listNames(paths.crawlerDir)) {
    if (!/^(?:rankings|walls)-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/.test(name)) continue;
    consider(timeOf(firstJsonLine(join(paths.crawlerDir, name))));
  }
  const snaps = listNames(paths.aranhaDir).filter(name => name.startsWith('web-') && name.endsWith('.json')).sort();
  if (snaps[0]) {
    const fromName = snapshotTimeFromName(snaps[0]);
    consider(fromName);
    if (fromName === null) {
      try {
        const body = JSON.parse(readFileSync(join(paths.aranhaDir, snaps[0]), 'utf8')) as { asOf?: unknown };
        consider(parseEpoch(body.asOf));
      } catch {
        // An unreadable snapshot does not move the start time.
      }
    }
  }
  return min;
}

function inHalfOpen(time: number, from: number, to: number): boolean {
  return time >= from && time < to;
}

function recordingCopy(started: number | null, from: number, to: number, count: number): Pick<TeiaView, 'recordingStartedAt' | 'recordingNote' | 'empty' | 'emptyMessage'> {
  if (started === null) {
    return { recordingStartedAt: null, recordingNote: TEIA_BEFORE, empty: true, emptyMessage: TEIA_NONE };
  }
  const when = new Date(started).toISOString();
  if (to <= started) {
    return {
      recordingStartedAt: started,
      recordingNote: `A gravação começa em ${when}.`,
      empty: true,
      emptyMessage: TEIA_BEFORE
    };
  }
  const overlap = from < started ? `A gravação começa em ${when}. ${TEIA_BEFORE}` : null;
  if (count === 0) {
    return { recordingStartedAt: started, recordingNote: overlap, empty: true, emptyMessage: TEIA_EMPTY };
  }
  return { recordingStartedAt: started, recordingNote: overlap, empty: false, emptyMessage: null };
}

function estimateChainUsd(amount: string, asset: string, eventTime: number, prices: readonly PriceTick[]): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*([A-Za-z0-9]+)/.exec(amount.trim());
  if (!match) return null;
  const qty = Number(match[1]);
  const unit = match[2].toUpperCase();
  if (!(qty > 0)) return null;
  if (unit === 'USD' || unit === 'USDT') return qty;
  if (unit !== asset) return null;
  const symbol = `${asset}USDT`;
  let latest = -1;
  let price: number | null = null;
  for (const tick of prices) {
    if (tick.symbol !== symbol || !(tick.price > 0) || tick.time > eventTime) continue;
    if (tick.time >= latest) {
      latest = tick.time;
      price = tick.price;
    }
  }
  if (price === null) return null;
  return qty * price;
}

interface Collected {
  events: TeiaEvent[];
  started: number | null;
}

async function collectEvents(paths: TeiaPaths, symbol: string, from: number, to: number): Promise<Collected> {
  const started = await recordingStartedAt(paths);
  const base = pairBase(symbol);
  const events: TeiaEvent[] = [];
  const prices: PriceTick[] = [];
  const chains: RawChain[] = [];
  const seen = new Set<string>();
  const push = (event: TeiaEvent) => {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    events.push(event);
  };

  await forEachJsonl(join(paths.crawlerDir, 'whales.jsonl'), row => {
    const record = asRecord(row);
    if (!record || String(record.symbol || '').toUpperCase() !== symbol) return;
    const time = parseEpoch(record.time);
    const usd = Number(record.usd);
    if (time === null || !inHalfOpen(time, from, to) || !(usd >= TEIA_WHALE_MIN_USD)) return;
    const side = record.side === 'venda' ? 'venda' : record.side === 'compra' ? 'compra' : '';
    const price = Number(record.price);
    const aggressor = side ? `O agressor foi ${side}` : 'O lado do agressor não veio gravado';
    push({
      id: String(record.id || `${symbol}-${time}-${usd}`),
      kind: 'baleia',
      time,
      usd,
      title: formatTeiaUsd(usd),
      detail: `Negócio agregado na Binance. ${aggressor}${Number.isFinite(price) ? ` a ${formatTeiaPrice(price)}` : ''}. O tamanho do ponto usa esse notional.`
    });
  });

  await forEachJsonl(join(paths.crawlerDir, 'onchain.jsonl'), row => {
    const record = asRecord(row);
    if (!record || String(record.asset || '').toUpperCase() !== base) return;
    const time = parseEpoch(record.time);
    if (time === null || !inHalfOpen(time, from, to)) return;
    chains.push({
      id: String(record.id || record.txid || `chain-${time}`),
      time,
      asset: base,
      amount: String(record.amount || base),
      direction: String(record.direction || 'desconhecido'),
      label: typeof record.label === 'string' ? record.label : null,
      source: String(record.source || '')
    });
  });

  const walls = new Map<string, { side: string; price: number; usd: number; time: number; distancePct: number; hits: number }>();
  const latestRank: { current: { time: number; rank: number; score: number; bucket: string } | null } = { current: null };
  const rankCounts = new Map<string, number>();

  for (const name of journalFiles(paths.crawlerDir, from, to)) {
    await forEachJsonl(join(paths.crawlerDir, name), row => {
      const record = asRecord(row);
      if (!record) return;
      if (name.startsWith('walls-')) {
        const time = parseEpoch(record.t);
        if (time === null || !inHalfOpen(time, from, to) || !Array.isArray(record.walls)) return;
        for (const item of record.walls) {
          const wall = asRecord(item);
          if (!wall || String(wall.symbol || '').toUpperCase() !== symbol) continue;
          const usd = Number(wall.usd);
          const price = Number(wall.price);
          if (!(usd > 0) || !(price > 0)) continue;
          const side = wall.side === 'venda' || wall.side === 'compra' ? wall.side : '';
          if (!side) continue;
          const key = `${side}|${price.toPrecision(6)}`;
          const prev = walls.get(key);
          if (!prev) {
            walls.set(key, { side, price, usd, time, distancePct: Number(wall.distancePct) || 0, hits: 1 });
          } else {
            prev.hits += 1;
            if (usd > prev.usd) {
              prev.usd = usd;
              prev.price = price;
              prev.distancePct = Number(wall.distancePct) || prev.distancePct;
            }
            if (time > prev.time) prev.time = time;
          }
        }
        return;
      }
      const time = parseEpoch(record.t);
      const rowSymbol = String(record.symbol || '').toUpperCase();
      const price = Number(record.price);
      if (time !== null && rowSymbol && price > 0) prices.push({ time, symbol: rowSymbol, price });
      if (time === null || !inHalfOpen(time, from, to)) return;
      const bucket = String(record.t);
      rankCounts.set(bucket, (rankCounts.get(bucket) ?? 0) + 1);
      if (rowSymbol !== symbol) return;
      const rank = Number(record.rank);
      const score = Number(record.score);
      if (!Number.isFinite(rank)) return;
      if (!latestRank.current || time >= latestRank.current.time) {
        latestRank.current = { time, rank, score: Number.isFinite(score) ? score : 0, bucket };
      }
    });
  }

  for (const chain of chains) {
    const usd = estimateChainUsd(chain.amount, chain.asset, chain.time, prices);
    const bits = [chain.direction, chain.label, chain.source].filter((item): item is string => Boolean(item));
    if (usd === null) bits.push('sem preço gravado para converter em dólar');
    else bits.push(`${formatTeiaUsd(usd)} pelo preço do ranking gravado até essa transferência, só para o tamanho do ponto`);
    push({
      id: chain.id,
      kind: 'cadeia',
      time: chain.time,
      usd,
      title: chain.amount,
      detail: bits.join(' · ')
    });
  }

  for (const [key, wall] of walls) {
    const distance = Number.isFinite(wall.distancePct) ? `${formatTeiaPrice(wall.distancePct)}% do meio` : 'distância não gravada';
    push({
      id: `parede-${symbol}-${key}`,
      kind: 'parede',
      time: wall.time,
      usd: wall.usd,
      title: formatTeiaUsd(wall.usd),
      detail: `Livro de ${wall.side} a ${formatTeiaPrice(wall.price)}, ${distance}. Vista ${wall.hits} ${wall.hits === 1 ? 'vez' : 'vezes'} na janela.`
    });
  }

  if (latestRank.current) {
    const rank = latestRank.current;
    const universe = rankCounts.get(rank.bucket);
    push({
      id: `ranking-${symbol}-${rank.time}`,
      kind: 'ranking',
      time: rank.time,
      usd: null,
      title: universe ? `posição ${rank.rank} de ${universe}` : `posição ${rank.rank}`,
      detail: `Coleta das ${new Date(rank.time).toISOString().slice(11, 16)} UTC. Score gravado: ${formatTeiaPrice(rank.score)}.`
    });
  }

  for (const name of listNames(paths.aranhaDir)) {
    if (!name.startsWith('web-') || !name.endsWith('.json')) continue;
    const named = snapshotTimeFromName(name);
    if (named !== null && (named < from - 60 * 60 * 1000 || named >= to)) continue;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(readFileSync(join(paths.aranhaDir, name), 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const asOf = parseEpoch(body.asOf);
    if (asOf === null || !inHalfOpen(asOf, from, to)) continue;
    const fear = asRecord(body.fearGreed);
    if (fear) {
      const value = Number(fear.value);
      const when = parseEpoch(fear.fetchedAt) ?? asOf;
      if (Number.isFinite(value) && inHalfOpen(when, from, to)) {
        const label = String(fear.labelPt || fear.classification || '').trim();
        push({
          id: `medo-${when}-${value}`,
          kind: 'medo',
          time: when,
          usd: null,
          title: label ? `${formatTeiaPrice(value)} · ${label}` : formatTeiaPrice(value),
          detail: 'Índice geral de medo e ganância gravado na coleta da Aranha. Vale para o mercado inteiro.'
        });
      }
    }
    if (!Array.isArray(body.items)) continue;
    for (const item of body.items) {
      const news = asRecord(item);
      if (!news) continue;
      const published = parseEpoch(news.publishedAt) ?? parseEpoch(news.fetchedAt) ?? asOf;
      if (!inHalfOpen(published, from, to)) continue;
      const title = String(news.title || '').trim();
      const summary = String(news.summary || '').trim();
      if (!textMentionsAsset(`${title} ${summary}`, base)) continue;
      const source = String(news.source || '').trim();
      push({
        id: `noticia-${String(news.id || news.url || published)}`,
        kind: 'noticia',
        time: published,
        usd: null,
        title: title || 'Notícia',
        detail: [source, summary].filter(Boolean).join(' · ').slice(0, 280)
      });
    }
  }

  return { events, started };
}

export async function buildTeiaView(
  paths: TeiaPaths,
  input: { symbol: string; time: number; window: TeiaWindowId }
): Promise<TeiaView> {
  const windowMs = TEIA_WINDOWS[input.window];
  const from = input.time - windowMs;
  const to = input.time;
  const collected = await collectEvents(paths, input.symbol, from, to);
  const limited = limitTeiaEvents(collected.events);
  const copy = recordingCopy(collected.started, from, to, limited.total);
  return {
    mode: 'vela',
    symbol: input.symbol,
    time: input.time,
    window: input.window,
    windowMs,
    from,
    to,
    disclaimer: TEIA_DISCLAIMER,
    ...copy,
    truncated: limited.truncated,
    total: limited.total,
    events: copy.empty && copy.emptyMessage === TEIA_BEFORE ? [] : limited.events
  };
}

export async function buildTeiaMarkers(
  paths: TeiaPaths,
  input: { symbol: string; from: number; to: number; window: TeiaWindowId; interval: TeiaIntervalId }
): Promise<TeiaMarkers> {
  const windowMs = TEIA_WINDOWS[input.window];
  const intervalMs = TEIA_INTERVALS[input.interval];
  const collected = await collectEvents(paths, input.symbol, input.from - windowMs, input.to);
  const marked = buildMarkers(collected.events.map(event => event.time), input.from, input.to, intervalMs, windowMs);
  const beforeRecording = collected.started !== null && input.to <= collected.started;
  const copy = recordingCopy(collected.started, input.from, input.to, beforeRecording ? 0 : marked.markers.length);
  return {
    mode: 'marcadores',
    symbol: input.symbol,
    window: input.window,
    windowMs,
    from: input.from,
    to: input.to,
    interval: input.interval,
    disclaimer: TEIA_DISCLAIMER,
    recordingStartedAt: copy.recordingStartedAt,
    recordingNote: copy.recordingNote,
    truncated: marked.truncated,
    markers: beforeRecording ? [] : marked.markers
  };
}
