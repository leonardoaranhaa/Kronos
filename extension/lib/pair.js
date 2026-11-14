const QUOTES = ['USDT', 'FDUSD', 'USDC', 'BUSD', 'TUSD', 'BTC', 'ETH', 'BNB'];

export function pageHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Binance spot/futures and TradingView, including country subdomains. */
export function isExchangePage(url) {
  const host = pageHost(url);
  return host === 'binance.com' || host.endsWith('.binance.com')
    || host === 'tradingview.com' || host.endsWith('.tradingview.com');
}

export function normalizePair(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let text = raw.trim().toUpperCase();
  try {
    text = decodeURIComponent(text);
  } catch {
    // Keep the raw token when it is not valid percent-encoding.
  }
  text = text.split(/[?#\s]/)[0];
  if (text.includes(':')) text = text.slice(text.lastIndexOf(':') + 1);
  text = text.replace(/(\.P|\.PERP|_PERP)$/, '');
  text = text.replace(/_\d{6}$/, '');
  const separated = text.match(/^([A-Z0-9]{2,15})[_/-]([A-Z0-9]{2,10})$/);
  let base = '';
  let quote = '';
  if (separated) {
    base = separated[1];
    quote = separated[2];
  } else {
    quote = QUOTES.find(item => text.endsWith(item) && text.length > item.length + 1) || '';
    base = quote ? text.slice(0, -quote.length) : '';
  }
  if (!/^[A-Z0-9]{2,15}$/.test(base) || !QUOTES.includes(quote)) return null;
  return `${base}${quote}`;
}

function fromTitle(title) {
  if (!title) return null;
  const match = String(title).toUpperCase().match(/[A-Z0-9]{2,15}(?:[_/-](?:USDT|USDC|FDUSD|BUSD|TUSD|BTC|ETH|BNB)|USDT|USDC|FDUSD)/);
  return match ? normalizePair(match[0]) : null;
}

/**
 * Reads the pair from a Binance or TradingView tab.
 * Returns null when the page is not one of those sites or no pair is present.
 */
export function detectPair(url, title = '') {
  if (!isExchangePage(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  let symbol = null;
  if (host.endsWith('binance.com')) {
    const trade = path.match(/\/trade\/([A-Za-z0-9_-]+)/);
    const futures = path.match(/\/futures\/([A-Za-z0-9_]+)/);
    symbol = normalizePair(trade?.[1] || futures?.[1] || parsed.searchParams.get('symbol') || '');
  } else {
    const symbolsPath = path.match(/\/symbols\/([^/]+)/);
    symbol = normalizePair(parsed.searchParams.get('symbol') || symbolsPath?.[1] || '');
  }
  if (!symbol) symbol = fromTitle(title);
  if (!symbol) return null;
  const source = host.endsWith('binance.com')
    ? (path.includes('/futures/') ? 'binance-futuros' : 'binance-spot')
    : 'tradingview';
  return { symbol, source };
}

export function sourceLabel(source) {
  if (source === 'binance-futuros') return 'Binance futuros';
  if (source === 'binance-spot') return 'Binance à vista';
  if (source === 'tradingview') return 'TradingView';
  return 'escolhido no painel';
}
