import { buildAnalogIndex } from '../aranha/analogs';
import { BACKTEST_UNIVERSE } from './config';
import { CRAWLER_ANALOG, rankScores, returnOver, scoreCoin, signedVolumeSpike, toCanonical } from './score';
import type { CoinScore, MarketBar } from './types';

const ROUND_TRIP = 0.003;

export const CRAWLER_HORIZONS = [
  { id: '1h', label: '1 hora', bars: 12 },
  { id: '4h', label: '4 horas', bars: 48 },
  { id: '24h', label: '24 horas', bars: 288 }
] as const;

export interface HorizonScore {
  label: string;
  bars: number;
  decisions: number;
  topNetPct: number | null;
  universeNetPct: number | null;
  excessPct: number | null;
  topBeatRate: number | null;
}

export interface VariantScore {
  id: 'score' | 'momentum' | 'volume';
  label: string;
  horizons: HorizonScore[];
}

export interface CrawlerBacktestResult {
  universe: string[];
  feeBps: number;
  variantsTried: number;
  variants: VariantScore[];
  decisions: number;
  firstOpenTime: number | null;
  lastOpenTime: number | null;
}

interface Ranked {
  symbol: string;
  score: number;
  index: number;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function netReturn(bars: readonly MarketBar[], index: number, horizon: number): number | null {
  const future = index + horizon;
  if (future >= bars.length) return null;
  const start = bars[index].close;
  const end = bars[future].close;
  if (!(start > 0) || !(end > 0)) return null;
  return end / start - 1 - ROUND_TRIP;
}

function summarize(label: string, bars: number, top: number[], universe: number[]): HorizonScore {
  const topMean = mean(top);
  const universeMean = mean(universe);
  let beats = 0;
  for (let i = 0; i < top.length; i++) if (top[i] > universe[i]) beats += 1;
  return {
    label,
    bars,
    decisions: top.length,
    topNetPct: topMean === null ? null : topMean * 100,
    universeNetPct: universeMean === null ? null : universeMean * 100,
    excessPct: topMean === null || universeMean === null ? null : (topMean - universeMean) * 100,
    topBeatRate: top.length ? beats / top.length : null
  };
}

/**
 * At each hour, rank the coins that already have a bar and a known past.
 * Forward returns are labels only. Three rankings are fixed in advance.
 */
export function runCrawlerBacktest(
  series: Readonly<Record<string, readonly MarketBar[]>>,
  universe: readonly string[] = BACKTEST_UNIVERSE
): CrawlerBacktestResult {
  const symbols = universe.filter(symbol => (series[symbol]?.length ?? 0) > 0);
  if (!series.BTCUSDT) throw new Error('crawler backtest needs BTCUSDT');
  const clock = series.BTCUSDT;
  const location = new Map<string, Map<number, number>>();
  const analog = new Map<string, ReturnType<typeof buildAnalogIndex>>();
  for (const symbol of symbols) {
    const map = new Map<number, number>();
    series[symbol].forEach((bar, index) => map.set(bar.openTime, index));
    location.set(symbol, map);
    if (series[symbol].length >= CRAWLER_ANALOG.window * 2) {
      analog.set(symbol, buildAnalogIndex(toCanonical(symbol, series[symbol]), CRAWLER_ANALOG.window));
    }
  }

  const buckets = {
    score: new Map<number, { top: number[]; universe: number[] }>(),
    momentum: new Map<number, { top: number[]; universe: number[] }>(),
    volume: new Map<number, { top: number[]; universe: number[] }>()
  };
  for (const horizon of CRAWLER_HORIZONS) {
    buckets.score.set(horizon.bars, { top: [], universe: [] });
    buckets.momentum.set(horizon.bars, { top: [], universe: [] });
    buckets.volume.set(horizon.bars, { top: [], universe: [] });
  }

  let decisions = 0;
  let firstOpenTime: number | null = null;
  let lastOpenTime: number | null = null;
  const start = Math.max(CRAWLER_ANALOG.window * 2, 48);

  for (let clockIndex = start; clockIndex + CRAWLER_HORIZONS[2].bars < clock.length; clockIndex += 12) {
    const openTime = clock[clockIndex].openTime;
    const available: { symbol: string; index: number; scored: CoinScore; momentum: number; volume: number }[] = [];
    for (const symbol of symbols) {
      const index = location.get(symbol)?.get(openTime);
      if (index === undefined || index < start) continue;
      if (index + CRAWLER_HORIZONS[2].bars >= series[symbol].length) continue;
      const momentum = returnOver(series[symbol].slice(0, index + 1), 12);
      const volume = signedVolumeSpike(series[symbol].slice(0, index + 1));
      if (momentum === null) continue;
      const scored = scoreCoin({
        symbol,
        bars: series[symbol],
        btcBars: clock,
        endIndex: index,
        analogIndex: analog.get(symbol),
        whalePressure: null
      });
      available.push({ symbol, index, scored, momentum, volume });
    }
    if (available.length < 6) continue;
    decisions += 1;
    firstOpenTime ??= openTime;
    lastOpenTime = openTime;

    const orders: Record<VariantScore['id'], Ranked[]> = {
      score: rankScores(available.map(item => item.scored)).map(item => ({
        symbol: item.symbol,
        score: item.score,
        index: available.find(row => row.symbol === item.symbol)!.index
      })),
      momentum: available.slice().sort((a, b) => b.momentum - a.momentum || a.symbol.localeCompare(b.symbol)).map(item => ({
        symbol: item.symbol, score: item.momentum, index: item.index
      })),
      volume: available.slice().sort((a, b) => b.volume - a.volume || a.symbol.localeCompare(b.symbol)).map(item => ({
        symbol: item.symbol, score: item.volume, index: item.index
      }))
    };

    for (const variant of ['score', 'momentum', 'volume'] as const) {
      const top = orders[variant].slice(0, 3);
      for (const horizon of CRAWLER_HORIZONS) {
        const bucket = buckets[variant].get(horizon.bars)!;
        const topReturns = top.map(item => netReturn(series[item.symbol], item.index, horizon.bars)).filter((value): value is number => value !== null);
        const universeReturns = available.map(item => netReturn(series[item.symbol], item.index, horizon.bars)).filter((value): value is number => value !== null);
        const topMean = mean(topReturns);
        const universeMean = mean(universeReturns);
        if (topMean === null || universeMean === null) continue;
        bucket.top.push(topMean);
        bucket.universe.push(universeMean);
      }
    }
  }

  const labels: Record<VariantScore['id'], string> = {
    score: 'Score da Aranha',
    momentum: 'Só o retorno da última hora',
    volume: 'Só o volume com direção'
  };
  const variants: VariantScore[] = (['score', 'momentum', 'volume'] as const).map(id => ({
    id,
    label: labels[id],
    horizons: CRAWLER_HORIZONS.map(horizon => {
      const bucket = buckets[id].get(horizon.bars)!;
      return summarize(horizon.label, horizon.bars, bucket.top, bucket.universe);
    })
  }));

  return {
    universe: symbols,
    feeBps: ROUND_TRIP * 10_000,
    variantsTried: variants.length,
    variants,
    decisions,
    firstOpenTime,
    lastOpenTime
  };
}

interface Ranked {
  symbol: string;
  score: number;
  index: number;
}