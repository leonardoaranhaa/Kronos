export interface FeedItem {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string;
  eventHint?: string;
}

export interface FearGreedParsed {
  value: number;
  classification: string;
  timestampMs: number | null;
}

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function extractLink(block: string): string {
  const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (href) return href[1].trim();
  const text = tagText(block, 'link');
  if (text) {
    const decoded = decode(text);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  }
  const guid = tagText(block, 'guid');
  if (guid) {
    const decoded = decode(guid);
    if (/^https?:\/\//i.test(decoded)) return decoded;
  }
  return '';
}

/** RSS 2.0 `<item>` and Atom `<entry>`. Enough for the public news feeds, not a general XML parser. */
export function parseRss(xml: string): FeedItem[] {
  const chunks = xml.split(/<item\b|<entry\b/i).slice(1);
  const items: FeedItem[] = [];
  for (const chunk of chunks) {
    const block = chunk.split(/<\/item>|<\/entry>/i)[0] ?? chunk;
    const title = decode(tagText(block, 'title') ?? '');
    const url = extractLink(block);
    const published = tagText(block, 'pubDate') || tagText(block, 'published') || tagText(block, 'updated');
    const summary = decode(tagText(block, 'description') || tagText(block, 'summary') || tagText(block, 'content') || '');
    if (!title || !url) continue;
    items.push({
      title,
      url,
      publishedAt: published ? decode(published) : null,
      summary: summary.slice(0, 280)
    });
  }
  return items;
}

export function parseFearGreed(body: string): FearGreedParsed | null {
  const parsed = JSON.parse(body) as { data?: { value?: unknown; value_classification?: unknown; timestamp?: unknown }[] };
  const row = parsed.data?.[0];
  if (!row) return null;
  const value = Number(row.value);
  if (!Number.isFinite(value)) return null;
  const rawTime = row.timestamp === undefined || row.timestamp === null ? null : Number(row.timestamp);
  const timestampMs = rawTime === null || !Number.isFinite(rawTime)
    ? null
    : rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime;
  return {
    value,
    classification: String(row.value_classification ?? ''),
    timestampMs
  };
}

export function fearGreedLabel(classification: string, value: number): string {
  const known: Record<string, string> = {
    'extreme fear': 'Medo extremo',
    fear: 'Medo',
    neutral: 'Neutro',
    greed: 'Ganância',
    'extreme greed': 'Ganância extrema'
  };
  const mapped = known[classification.trim().toLowerCase()];
  if (mapped) return mapped;
  if (value <= 25) return 'Medo extremo';
  if (value <= 45) return 'Medo';
  if (value <= 55) return 'Neutro';
  if (value <= 75) return 'Ganância';
  return 'Ganância extrema';
}

export function parseBinanceAnnouncements(body: string): FeedItem[] {
  const parsed = JSON.parse(body) as {
    data?: { articles?: Record<string, unknown>[]; catalogs?: { articles?: Record<string, unknown>[] }[] };
  };
  const articles = parsed.data?.articles ?? parsed.data?.catalogs?.[0]?.articles ?? [];
  if (!Array.isArray(articles)) return [];
  return articles.flatMap(article => {
    const title = String(article.title ?? '').trim();
    if (!title) return [];
    const code = String(article.code ?? '').trim();
    const release = Number(article.releaseDate ?? article.publishDate ?? 0);
    return [{
      title,
      url: code
        ? `https://www.binance.com/en/support/announcement/${encodeURIComponent(code)}`
        : 'https://www.binance.com/en/support/announcement',
      publishedAt: Number.isFinite(release) && release > 0 ? new Date(release).toISOString() : null,
      summary: ''
    }];
  });
}

export function parseCoinGeckoTrending(body: string): FeedItem[] {
  const parsed = JSON.parse(body) as { coins?: { item?: Record<string, unknown> }[] };
  const coins = Array.isArray(parsed.coins) ? parsed.coins : [];
  return coins.slice(0, 8).flatMap(row => {
    const item = row.item ?? {};
    const id = String(item.id ?? '').trim();
    const name = String(item.name ?? id).trim();
    const symbol = String(item.symbol ?? '').toUpperCase();
    if (!name) return [];
    return [{
      title: `Em alta na CoinGecko: ${name}${symbol ? ` (${symbol})` : ''}`,
      url: id ? `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}` : 'https://www.coingecko.com',
      publishedAt: null,
      summary: 'Moeda em tendência no CoinGecko. Não é uma notícia.',
      eventHint: 'trending'
    }];
  });
}

export function toIsoTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}
