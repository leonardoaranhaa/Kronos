import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmProvider } from './llm';
import { scoreText } from './lexicon';
import {
  fearGreedLabel,
  parseBinanceAnnouncements,
  parseCoinGeckoTrending,
  parseFearGreed,
  parseRss,
  toIsoTime,
  type FeedItem
} from './parse-feed';
import type { NewsItem, WebCitation, WebContext } from './types';

/**
 * Public syndication and JSON endpoints only. No exchange account, no key.
 * Each source is cached and is not fetched again before its own interval.
 */
export interface SourceSpec {
  id: string;
  kind: 'rss' | 'fng' | 'binance' | 'coingecko';
  url: string;
  minIntervalMs: number;
  label: string;
}

export const USER_AGENT = 'KronosAranha/1.0 (local research; public RSS and JSON only; no orders)';

export const PUBLIC_SOURCES: SourceSpec[] = [
  {
    id: 'coindesk',
    kind: 'rss',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml',
    minIntervalMs: 600_000,
    label: 'CoinDesk'
  },
  {
    id: 'cointelegraph',
    kind: 'rss',
    url: 'https://cointelegraph.com/rss',
    minIntervalMs: 600_000,
    label: 'Cointelegraph'
  },
  {
    id: 'decrypt',
    kind: 'rss',
    url: 'https://decrypt.co/feed',
    minIntervalMs: 600_000,
    label: 'Decrypt'
  },
  {
    id: 'binance-announcements',
    kind: 'binance',
    url: 'https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=48&pageNo=1&pageSize=8',
    minIntervalMs: 600_000,
    label: 'Binance anúncios'
  },
  {
    id: 'fear-greed',
    kind: 'fng',
    url: 'https://api.alternative.me/fng/?limit=1',
    minIntervalMs: 1_800_000,
    label: 'Fear & Greed'
  },
  {
    id: 'coingecko-trending',
    kind: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/search/trending',
    minIntervalMs: 600_000,
    label: 'CoinGecko'
  }
];

export interface CacheEntry {
  url: string;
  fetchedAt: number;
  status: number;
  body: string;
  error: string | null;
}

export interface SourceCache {
  get(id: string): Promise<CacheEntry | null>;
  set(id: string, entry: CacheEntry): Promise<void>;
}

export class MemorySourceCache implements SourceCache {
  private readonly entries = new Map<string, CacheEntry>();
  async get(id: string): Promise<CacheEntry | null> {
    return this.entries.get(id) ?? null;
  }
  async set(id: string, entry: CacheEntry): Promise<void> {
    this.entries.set(id, entry);
  }
}

export class FileSourceCache implements SourceCache {
  constructor(private readonly dir: string) {}
  async get(id: string): Promise<CacheEntry | null> {
    try {
      return JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as CacheEntry;
    } catch {
      return null;
    }
  }
  async set(id: string, entry: CacheEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, `${id}.json`), JSON.stringify(entry));
  }
}

export function emptyWebContext(note: string, asOf = new Date(0).toISOString()): WebContext {
  return {
    asOf,
    llm: 'desligado',
    llmModel: null,
    webSearch: 'desligado',
    sentiment: null,
    fearGreed: null,
    items: [],
    citations: [],
    errors: [],
    note
  };
}

interface CollectedItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  summary: string;
  eventHint?: string;
}

function parseBody(source: SourceSpec, body: string): { items: FeedItem[]; fear: ReturnType<typeof parseFearGreed> } {
  if (source.kind === 'fng') return { items: [], fear: parseFearGreed(body) };
  if (source.kind === 'binance') return { items: parseBinanceAnnouncements(body), fear: null };
  if (source.kind === 'coingecko') return { items: parseCoinGeckoTrending(body), fear: null };
  return { items: parseRss(body), fear: null };
}

async function loadSource(
  source: SourceSpec,
  now: number,
  fetchImpl: typeof fetch,
  cache: SourceCache
): Promise<{ entry: CacheEntry; error: string | null }> {
  const cached = await cache.get(source.id);
  if (cached && now - cached.fetchedAt < source.minIntervalMs) {
    return { entry: cached, error: cached.error };
  }
  try {
    const response = await fetchImpl(source.url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: source.kind === 'rss' ? 'application/rss+xml, application/xml, text/xml, */*' : 'application/json'
      },
      signal: AbortSignal.timeout(8_000)
    });
    const body = await response.text();
    const entry: CacheEntry = {
      url: source.url,
      fetchedAt: now,
      status: response.status,
      body: response.ok ? body : (cached?.body ?? ''),
      error: response.ok ? null : `HTTP ${response.status}`
    };
    await cache.set(source.id, entry);
    return { entry, error: entry.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cached?.body) {
      return { entry: cached, error: `${source.label}: coleta nova falhou (${message}); usando o cache.` };
    }
    const entry: CacheEntry = { url: source.url, fetchedAt: now, status: 0, body: '', error: message };
    await cache.set(source.id, entry);
    return { entry, error: `${source.label}: ${message}` };
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function newsScorePrompt(items: readonly CollectedItem[], symbol: string, fear: number | null): { system: string; user: string } {
  const lines = items.map(item => `${item.id} | ${item.source} | ${item.publishedAt ?? 'sem data'} | ${item.title}`);
  return {
    system: [
      'Você pontua notícias públicas de cripto para uma pesquisa. Não dá ordem de compra.',
      'Pode usar a busca na web se ela estiver disponível, para checar um fato urgente do ativo.',
      'Não invente notícia que não esteja na lista. O que a busca acrescentar vai no campo busca, com a fonte que a ferramenta citou.',
      'Responda só JSON: {"items":[{"id":"","sentiment":0,"eventType":"noticia","relevance":0,"urgency":0,"summary":"uma frase em pt-BR"}],"busca":""}.',
      'sentiment vai de -1 (baixa) a 1 (alta). relevance e urgency vão de 0 a 1.'
    ].join(' '),
    user: [`Ativo: ${symbol}.`, fear === null ? 'Fear & Greed: indisponível.' : `Fear & Greed (número cru, não mude): ${fear}.`, ...lines].join('\n')
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function lexiconItems(items: CollectedItem[], symbol: string, fetchedAt: string): NewsItem[] {
  return items.map(item => {
    const score = scoreText(`${item.title} ${item.summary}`, symbol, item.eventHint);
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      publishedAt: item.publishedAt,
      fetchedAt,
      sentiment: score.sentiment,
      eventType: score.eventType,
      relevance: score.relevance,
      urgency: score.urgency,
      summary: score.summary,
      method: 'lexico'
    };
  });
}

function applyLlmScores(items: CollectedItem[], payload: Record<string, unknown>, symbol: string, fetchedAt: string): NewsItem[] | null {
  const rows = Array.isArray(payload.items) ? payload.items : null;
  if (!rows) return null;
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row && typeof row === 'object' && typeof (row as { id?: unknown }).id === 'string') {
      byId.set((row as { id: string }).id, row as Record<string, unknown>);
    }
  }
  return items.map(item => {
    const fallback = lexiconItems([item], symbol, fetchedAt)[0];
    const row = byId.get(item.id);
    if (!row) return fallback;
    const sentiment = Number(row.sentiment);
    const relevance = Number(row.relevance);
    const urgency = Number(row.urgency);
    return {
      ...fallback,
      sentiment: Number.isFinite(sentiment) ? clamp(sentiment, -1, 1) : fallback.sentiment,
      eventType: typeof row.eventType === 'string' && row.eventType.trim() ? row.eventType.trim().slice(0, 40) : fallback.eventType,
      relevance: Number.isFinite(relevance) ? clamp(relevance, 0, 1) : fallback.relevance,
      urgency: Number.isFinite(urgency) ? clamp(urgency, 0, 1) : fallback.urgency,
      summary: typeof row.summary === 'string' && row.summary.trim() ? row.summary.trim().slice(0, 280) : fallback.summary,
      method: 'llm'
    };
  });
}

function aggregateSentiment(items: readonly NewsItem[]): number | null {
  let weight = 0;
  let sum = 0;
  for (const item of items) {
    if (item.sentiment === null) continue;
    const itemWeight = Math.max(0.05, item.relevance);
    sum += item.sentiment * itemWeight;
    weight += itemWeight;
  }
  if (!(weight > 0)) return null;
  return Math.round((sum / weight) * 1000) / 1000;
}

export async function buildWebContext(options: {
  sources?: readonly SourceSpec[];
  symbol: string;
  now?: number;
  fetchImpl?: typeof fetch;
  cache: SourceCache;
  provider: LlmProvider | null;
}): Promise<WebContext> {
  const now = options.now ?? Date.now();
  const fetchedAt = new Date(now).toISOString();
  const fetchImpl = options.fetchImpl ?? fetch;
  const sources = options.sources ?? PUBLIC_SOURCES;
  const errors: string[] = [];
  const collected: CollectedItem[] = [];
  let fear: WebContext['fearGreed'] = null;

  for (const source of sources) {
    const loaded = await loadSource(source, now, fetchImpl, options.cache);
    if (loaded.error) errors.push(`${source.label}: ${loaded.error}`.replace(`${source.label}: ${source.label}:`, `${source.label}:`));
    if (!loaded.entry.body) continue;
    try {
      const parsed = parseBody(source, loaded.entry.body);
      if (parsed.fear) {
        fear = {
          value: parsed.fear.value,
          classification: parsed.fear.classification,
          labelPt: fearGreedLabel(parsed.fear.classification, parsed.fear.value),
          fetchedAt: new Date(loaded.entry.fetchedAt).toISOString()
        };
      }
      parsed.items.slice(0, 8).forEach((item, index) => {
        collected.push({
          id: `${source.id}-${index}`,
          title: item.title,
          url: item.url,
          source: source.label,
          publishedAt: toIsoTime(item.publishedAt),
          summary: item.summary,
          eventHint: item.eventHint
        });
      });
    } catch (error) {
      errors.push(`${source.label}: resposta ilegível (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  collected.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
  const bySource = new Map<string, CollectedItem[]>();
  for (const item of collected) {
    const group = bySource.get(item.source) ?? [];
    group.push(item);
    bySource.set(item.source, group);
  }
  const items: CollectedItem[] = [];
  while (items.length < 12) {
    let added = false;
    for (const group of bySource.values()) {
      const next = group.shift();
      if (!next || items.length >= 12) continue;
      items.push(next);
      added = true;
    }
    if (!added) break;
  }
  let scored = lexiconItems(items, options.symbol, fetchedAt);
  let llm: WebContext['llm'] = 'desligado';
  let llmModel: string | null = null;
  let webSearch: WebContext['webSearch'] = 'desligado';
  const citations: WebCitation[] = [];
  let searchNote = '';

  if (options.provider && items.length > 0) {
    try {
      const prompt = newsScorePrompt(items, options.symbol, fear?.value ?? null);
      const result = await options.provider.complete({
        system: prompt.system,
        user: prompt.user,
        webSearch: true,
        maxTokens: 1200
      });
      const payload = extractJsonObject(result.text);
      const merged = payload ? applyLlmScores(items, payload, options.symbol, fetchedAt) : null;
      if (!merged) {
        errors.push('O modelo não devolveu JSON de pontuação. A lista de palavras foi usada.');
      } else {
        scored = merged;
        llm = result.provider;
        llmModel = result.model;
        webSearch = result.webSearch;
        for (const citation of result.citations) {
          if (citations.some(item => item.url === citation.url)) continue;
          citations.push({ url: citation.url, title: citation.title, citedText: citation.citedText });
        }
        const busca = payload && typeof payload.busca === 'string' ? payload.busca.trim() : '';
        if (busca) searchNote = ` Busca do modelo: ${busca.slice(0, 400)}`;
      }
    } catch (error) {
      errors.push(`Modelo indisponível (${error instanceof Error ? error.message : String(error)}). Lista de palavras no lugar.`);
    }
  }

  const sentiment = aggregateSentiment(scored);
  const note = llm === 'desligado'
    ? `LLM desligado. O tom das notícias, quando há palavras reconhecidas, vem de uma lista fixa. Isso não é uma previsão.${searchNote}`
    : `Tom resumido por ${llm === 'anthropic' ? 'Claude' : 'um modelo compatível com OpenAI'}${llmModel ? ` (${llmModel})` : ''}. Os análogos e os padrões do gráfico não vêm daqui.${searchNote}`;

  return {
    asOf: fetchedAt,
    llm,
    llmModel,
    webSearch,
    sentiment,
    fearGreed: fear,
    items: scored,
    citations,
    errors,
    note
  };
}
