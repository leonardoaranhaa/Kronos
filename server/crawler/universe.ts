import type { TickerInfo } from './types';

/** Spot bases that are cash-like. A move here is not a coin opportunity. */
export const STABLE_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'EUR', 'AEUR', 'EURI',
  'USDE', 'USD1', 'USDS', 'PYUSD', 'GUSD', 'FRAX', 'LUSD', 'CRVUSD', 'USDD',
  'USTC', 'TUSD', 'USDP', 'SUSD', 'USDQ'
]);

/** Leveraged tokens use these suffixes on the base asset, e.g. BTCUP. */
export function isLeveragedBase(base: string): boolean {
  return /(?:UP|DOWN|BULL|BEAR)$/.test(base);
}

export function selectUniverse(tickers: readonly TickerInfo[], limit: number): TickerInfo[] {
  const eligible = tickers.filter(ticker => {
    if (ticker.quote !== 'USDT') return false;
    if (ticker.status && ticker.status !== 'TRADING') return false;
    if (!(ticker.quoteVolume > 0) || !(ticker.lastPrice > 0)) return false;
    if (STABLE_BASES.has(ticker.base) || ticker.base.endsWith('USD')) return false;
    if (isLeveragedBase(ticker.base)) return false;
    return true;
  });
  eligible.sort((a, b) => b.quoteVolume - a.quoteVolume || a.symbol.localeCompare(b.symbol));
  return eligible.slice(0, Math.max(0, limit));
}

export function parseTickerPayload(payload: unknown): TickerInfo[] {
  if (!Array.isArray(payload)) return [];
  const rows: TickerInfo[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const symbol = String(row.symbol || '');
    if (!symbol.endsWith('USDT')) continue;
    const lastPrice = Number(row.lastPrice);
    const priceChangePercent = Number(row.priceChangePercent);
    const quoteVolume = Number(row.quoteVolume);
    const highPrice = Number(row.highPrice);
    const lowPrice = Number(row.lowPrice);
    rows.push({
      symbol,
      base: symbol.slice(0, -4),
      quote: 'USDT',
      lastPrice,
      priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : 0,
      quoteVolume: Number.isFinite(quoteVolume) ? quoteVolume : 0,
      highPrice: Number.isFinite(highPrice) && highPrice > 0 ? highPrice : null,
      lowPrice: Number.isFinite(lowPrice) && lowPrice > 0 ? lowPrice : null,
      status: typeof row.status === 'string' ? row.status : undefined
    });
  }
  return rows;
}
