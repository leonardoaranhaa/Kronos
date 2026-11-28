import { join } from 'node:path';
import { fetchZip, listDays, listMonths } from '../futures/import-vision';
import { parseFundingCsv, parseKlineCsv, type FundingPrint, type KlineBar } from '../futures/parse';
import { symbolDir } from '../futures/paths';
import { readJsonl, writeJsonl } from '../futures/store';
import { FORWARD_FUNDING, FORWARD_KLINES, VOL_TARGET_PROTOCOL } from './targeting';

const VISION = 'https://data.binance.vision/data/futures/um';
const DAY_MS = 86_400_000;

function dedupe<T>(rows: readonly T[], key: (row: T) => number): T[] {
  return [...new Map(rows.map(row => [key(row), row])).values()].sort((a, b) => key(a) - key(b));
}

/**
 * Public files only, so anyone can rebuild the forward book later.
 * Candles: one daily zip per finished UTC day after the frozen window.
 * Funding: one monthly zip per finished month; the running month is not published yet,
 * and the forward evaluator stops at the last funding print it has.
 */
export async function importForward(options: {
  root: string;
  symbols?: readonly string[];
  nowMs?: number;
  onProgress?: (message: string) => void;
}): Promise<{ symbol: string; klines: number; funding: number; lastKline: string | null; lastFunding: string | null }[]> {
  const now = options.nowMs ?? Date.now();
  const startMs = Date.parse(VOL_TARGET_PROTOCOL.retrospectiveEnd);
  const lastFullDay = Math.floor(now / DAY_MS) * DAY_MS;
  const progress = options.onProgress ?? (() => undefined);
  const out = [];
  for (const symbol of options.symbols ?? VOL_TARGET_PROTOCOL.symbols) {
    const directory = symbolDir(options.root, symbol);
    const klines = readJsonl<KlineBar>(join(directory, FORWARD_KLINES)).slice();
    const funding = readJsonl<FundingPrint>(join(directory, FORWARD_FUNDING)).slice();
    const haveDays = new Set(klines.map(bar => new Date(bar.openTime).toISOString().slice(0, 10)));
    for (const day of listDays(startMs, lastFullDay)) {
      if (haveDays.has(day)) continue;
      const zip = await fetchZip(`${VISION}/daily/klines/${symbol}/1h/${symbol}-1h-${day}.zip`);
      if (!zip.text) {
        progress(`${symbol}: candles de ${day} ainda não publicados (${zip.status})`);
        break;
      }
      klines.push(...parseKlineCsv(zip.text).filter(bar => bar.openTime >= startMs));
    }
    const haveMonths = new Set(funding.map(print => new Date(print.time).toISOString().slice(0, 7)));
    const currentMonth = new Date(now).toISOString().slice(0, 7);
    for (const month of listMonths(startMs, now)) {
      if (month >= currentMonth || haveMonths.has(month)) continue;
      const zip = await fetchZip(`${VISION}/monthly/fundingRate/${symbol}/${symbol}-fundingRate-${month}.zip`);
      if (!zip.text) {
        progress(`${symbol}: funding de ${month} ainda não publicado (${zip.status})`);
        break;
      }
      funding.push(...parseFundingCsv(zip.text).filter(print => print.time >= startMs));
    }
    const cleanKlines = dedupe(klines, bar => bar.openTime);
    const cleanFunding = dedupe(funding, print => print.time);
    writeJsonl(join(directory, FORWARD_KLINES), cleanKlines);
    writeJsonl(join(directory, FORWARD_FUNDING), cleanFunding);
    const last = (ms: number | undefined) => ms === undefined ? null : new Date(ms).toISOString();
    out.push({
      symbol,
      klines: cleanKlines.length,
      funding: cleanFunding.length,
      lastKline: last(cleanKlines[cleanKlines.length - 1]?.openTime),
      lastFunding: last(cleanFunding[cleanFunding.length - 1]?.time)
    });
    progress(`${symbol}: ${cleanKlines.length} candles, ${cleanFunding.length} funding`);
  }
  return out;
}
