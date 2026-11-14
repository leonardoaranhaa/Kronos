import { buildAranhaSchedules, AranhaPoint } from '../aranha/backtest';
import { ARANHA_GATES } from '../aranha/gates';
import { buildAnalogIndex } from '../aranha/analogs';
import { sha256Content } from '../binance-import-core';
import { CRAWLER_ANALOG, rankScores, returnOver, scoreCoin, signedVolumeSpike, toCanonical } from '../crawler/score';
import { BACKTEST_UNIVERSE } from '../crawler/config';
import { SignalAction } from '../signals';
import { CanonicalCandle } from '../../shared/types';
import { RESEARCH_COSTS } from '../research-protocol';
import { equityPath, holdReturns } from './accounting';
import { spearman } from './correlation';
import { mean } from './moments';
import { mulberry32 } from './random';
import { InformationOverride, StrategySeries } from './evaluate';
import type { MarketBar } from '../crawler/types';

const ROUND_TRIP = 0.003;

function completedHolds(points: readonly AranhaPoint[], horizon: number, lastIndex: number): { start: number; end: number }[] {
  const fills = points.map(point => point.fillIndex).filter(index => index > 0 && index <= lastIndex);
  const holds: { start: number; end: number }[] = [];
  for (let slot = 0; slot < fills.length; slot++) {
    const start = fills[slot];
    const next = fills[slot + 1];
    const naturalEnd = Math.min(lastIndex, start + horizon - 1);
    const end = next === undefined ? naturalEnd : Math.min(naturalEnd, next - 1);
    if (end >= start) holds.push({ start, end });
  }
  return holds;
}

function seriesFromSchedule(
  id: string,
  name: string,
  note: string,
  candles: readonly CanonicalCandle[],
  schedule: ReadonlyMap<number, SignalAction>,
  holds: readonly { start: number; end: number }[],
  benchmark: number[],
  decisions: StrategySeries['decisions'],
  periodMs: number,
  hasDirection: boolean,
  hasProbability: boolean,
  informationOverride?: InformationOverride
): StrategySeries {
  const last = holds[holds.length - 1]?.end ?? 0;
  const equity = equityPath(candles.slice(0, last + 1), schedule, 'long_short', RESEARCH_COSTS);
  return {
    id,
    family: 'aranha',
    name,
    returns: holdReturns(equity, holds),
    benchmarkReturns: benchmark,
    decisions,
    horizon: 1,
    stride: 1,
    periodMs,
    hasDirection,
    hasProbability,
    note,
    informationOverride
  };
}

export function aranhaStrategies(candles: readonly CanonicalCandle[], intervalMs: number): StrategySeries[] {
  const schedules = buildAranhaSchedules(candles, {
    window: ARANHA_GATES.window,
    horizon: ARANHA_GATES.horizonBars,
    neighbors: ARANHA_GATES.neighbors,
    separation: ARANHA_GATES.separation,
    stride: ARANHA_GATES.decisionStride,
    randomSeed: 42
  });
  const holds = completedHolds(schedules.points, ARANHA_GATES.horizonBars, candles.length - 1);
  if (holds.length < 2) return [];
  const last = holds[holds.length - 1].end;
  const buyAndHold = new Map<number, SignalAction>([[holds[0].start, 'BUY']]);
  const benchmark = holdReturns(
    equityPath(candles.slice(0, last + 1), buyAndHold, 'long_only', RESEARCH_COSTS),
    holds
  );
  const periodMs = intervalMs * ARANHA_GATES.decisionStride;
  const analogDecisions = schedules.points.slice(0, holds.length).map((point, index) => ({
    index,
    predicted: point.predictedBps,
    probabilityUp: point.probabilityUp,
    actual: point.actualBps,
    wentUp: point.wentUp
  }));
  const structureDecisions = schedules.points.slice(0, holds.length).map((point, index) => ({
    index,
    predicted: point.structureSign,
    probabilityUp: null,
    actual: point.actualBps,
    wentUp: point.wentUp
  }));
  const filteredDecisions = schedules.points.slice(0, holds.length).map((point, index) => ({
    index,
    predicted: point.filteredSign,
    probabilityUp: null,
    actual: point.actualBps,
    wentUp: point.wentUp
  }));
  return [
    seriesFromSchedule(
      'aranha-analogs',
      'Aranha: análogos',
      'Sinal dos trechos parecidos, com a regra fixa de mediana e taxa de acerto. P(alta) é a fração de análogos que subiu, só quando há vizinhos suficientes.',
      candles, schedules.analogs, holds, benchmark, analogDecisions, periodMs, true, true
    ),
    seriesFromSchedule(
      'aranha-structures',
      'Aranha: estruturas',
      'Sinal do regime de 1h, bloqueado quando o gráfico de 5m rompe contra ele. Não produz probabilidade.',
      candles, schedules.structures, holds, benchmark, structureDecisions, periodMs, true, false
    ),
    seriesFromSchedule(
      'aranha-persistence-filtered',
      'Aranha: persistência com filtro',
      'Segue o último candle, exceto quando os análogos discordam. Não produz probabilidade.',
      candles, schedules.persistenceFiltered, holds, benchmark, filteredDecisions, periodMs, true, false
    )
  ];
}

function forwardReturn(bars: readonly MarketBar[], index: number, hold: number): number | null {
  const end = index + hold;
  if (end >= bars.length) return null;
  const start = bars[index].close;
  const finish = bars[end].close;
  if (!(start > 0) || !(finish > 0)) return null;
  return finish / start - 1;
}

function basketTurnover(previous: readonly string[], next: readonly string[]): number {
  if (previous.length === 0 || next.length === 0) return 1;
  const kept = next.filter(symbol => previous.includes(symbol)).length;
  return 1 - kept / next.length;
}

export function meanCrossSectionalInformation(
  rows: readonly (readonly { score: number; forward: number }[])[],
  repetitions = 499,
  seed = 20261114
): InformationOverride {
  const usable = rows.filter(row => spearman(row.map(item => item.score), row.map(item => item.forward)) !== null);
  if (usable.length === 0) return { coefficient: null, pValue: null, observations: 0 };
  const coefficients = usable.map(row => spearman(row.map(item => item.score), row.map(item => item.forward)) as number);
  const observed = mean(coefficients);
  const random = mulberry32(seed);
  let extreme = 0;
  for (let rep = 0; rep < repetitions; rep++) {
    const samples: number[] = [];
    for (const row of usable) {
      const forward = row.map(item => item.forward);
      for (let index = forward.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1));
        const held = forward[index];
        forward[index] = forward[swap];
        forward[swap] = held;
      }
      samples.push(spearman(row.map(item => item.score), forward) ?? 0);
    }
    if (Math.abs(mean(samples)) >= Math.abs(observed) - 1e-12) extreme += 1;
  }
  return {
    coefficient: observed,
    pValue: (extreme + 1) / (repetitions + 1),
    observations: usable.length
  };
}

export interface CrawlerClock {
  strategies: StrategySeries[];
  decisions: number;
  symbols: string[];
}

/**
 * Ranking held for `hold` 5-minute bars, which is also the gap between decisions,
 * so successive labels do not share a path. The fee is the same 0,30% round trip
 * used by the crawler, charged on the names that actually change.
 */
export function crawlerStrategies(
  series: Readonly<Record<string, readonly MarketBar[]>>,
  hold = 12,
  universe: readonly string[] = BACKTEST_UNIVERSE
): CrawlerClock {
  const symbols = universe.filter(symbol => (series[symbol]?.length ?? 0) > 0);
  if (!series.BTCUSDT) throw new Error('crawler validation needs BTCUSDT');
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
  const rows: {
    score: number;
    momentum: number;
    volume: number;
    basket: Record<'score' | 'momentum' | 'volume', number>;
    btc: number;
    sections: Record<'score' | 'momentum' | 'volume', { score: number; forward: number }[]>;
  }[] = [];
  const previous: Record<'score' | 'momentum' | 'volume', string[]> = { score: [], momentum: [], volume: [] };
  const start = Math.max(CRAWLER_ANALOG.window * 2, 48);
  for (let clockIndex = start; clockIndex + hold < clock.length; clockIndex += hold) {
    const openTime = clock[clockIndex].openTime;
    const available: { symbol: string; index: number; momentum: number; volume: number; scored: ReturnType<typeof scoreCoin> }[] = [];
    for (const symbol of symbols) {
      const index = location.get(symbol)?.get(openTime);
      if (index === undefined || index < start || index + hold >= series[symbol].length) continue;
      const momentum = returnOver(series[symbol].slice(0, index + 1), 12);
      const volume = signedVolumeSpike(series[symbol].slice(0, index + 1));
      if (momentum === null) continue;
      available.push({
        symbol,
        index,
        momentum,
        volume,
        scored: scoreCoin({
          symbol,
          bars: series[symbol],
          btcBars: clock,
          endIndex: index,
          analogIndex: analog.get(symbol),
          whalePressure: null
        })
      });
    }
    if (available.length < 6) continue;
    const forwards = new Map<string, number>();
    for (const item of available) {
      const value = forwardReturn(series[item.symbol], item.index, hold);
      if (value !== null) forwards.set(item.symbol, value);
    }
    const btc = forwardReturn(clock, clockIndex, hold);
    if (btc === null || forwards.size < 6) continue;
    const ranked = {
      score: rankScores(available.map(item => item.scored)).map(item => item.symbol),
      momentum: available.slice().sort((a, b) => b.momentum - a.momentum || a.symbol.localeCompare(b.symbol)).map(item => item.symbol),
      volume: available.slice().sort((a, b) => b.volume - a.volume || a.symbol.localeCompare(b.symbol)).map(item => item.symbol)
    };
    const basketReturn = (names: string[]) => {
      const values = names.slice(0, 3).map(symbol => forwards.get(symbol)).filter((value): value is number => value !== undefined);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    };
    const scoreBasket = basketReturn(ranked.score);
    const momentumBasket = basketReturn(ranked.momentum);
    const volumeBasket = basketReturn(ranked.volume);
    if (scoreBasket === null || momentumBasket === null || volumeBasket === null) continue;
    const sectionFor = (key: 'score' | 'momentum' | 'volume', valueOf: (item: typeof available[number]) => number) =>
      available
        .filter(item => forwards.has(item.symbol))
        .map(item => ({ score: valueOf(item), forward: forwards.get(item.symbol) as number }));
    const topSignal = (names: readonly string[], valueOf: (item: typeof available[number]) => number) => {
      const values = names.slice(0, 3)
        .map(symbol => available.find(item => item.symbol === symbol))
        .filter((item): item is typeof available[number] => item !== undefined)
        .map(valueOf);
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    };
    rows.push({
      score: topSignal(ranked.score, item => item.scored.score),
      momentum: topSignal(ranked.momentum, item => item.momentum),
      volume: topSignal(ranked.volume, item => item.volume),
      basket: {
        score: scoreBasket - basketTurnover(previous.score, ranked.score) * ROUND_TRIP,
        momentum: momentumBasket - basketTurnover(previous.momentum, ranked.momentum) * ROUND_TRIP,
        volume: volumeBasket - basketTurnover(previous.volume, ranked.volume) * ROUND_TRIP
      },
      btc,
      sections: {
        score: sectionFor('score', item => item.scored.score),
        momentum: sectionFor('momentum', item => item.momentum),
        volume: sectionFor('volume', item => item.volume)
      }
    });
    previous.score = ranked.score.slice(0, 3);
    previous.momentum = ranked.momentum.slice(0, 3);
    previous.volume = ranked.volume.slice(0, 3);
    if (rows.length % 40 === 0) console.log(`[validação] crawler decisões ${rows.length}`);
  }
  const benchmark = rows.map((row, index) => {
    const entry = index === 0 ? 0.0015 : 0;
    const exit = index === rows.length - 1 ? 0.0015 : 0;
    return row.btc - entry - exit;
  });
  const build = (
    id: string,
    name: string,
    note: string,
    key: 'score' | 'momentum' | 'volume',
    predicted: (row: typeof rows[number]) => number
  ): StrategySeries => ({
    id,
    family: 'crawler',
    name,
    returns: rows.map(row => row.basket[key]),
    benchmarkReturns: benchmark,
    decisions: rows.map((row, index) => ({
      index,
      predicted: predicted(row),
      probabilityUp: null,
      actual: row.basket[key],
      wentUp: row.basket[key] > 0
    })),
    horizon: 1,
    stride: 1,
    periodMs: hold * 300_000,
    hasDirection: true,
    hasProbability: false,
    note,
    informationOverride: meanCrossSectionalInformation(rows.map(row => row.sections[key]))
  });
  return {
    decisions: rows.length,
    symbols,
    strategies: [
      build('crawler-score', 'Crawler: score', 'Carteira igual das 3 moedas com maior score. O IC é a média do Spearman entre o score e o retorno das 12 velas seguintes, moeda a moeda.', 'score', row => row.score),
      build('crawler-momentum', 'Crawler: momentum', 'A mesma carteira, ordenada só pelo retorno da última hora.', 'momentum', row => row.momentum),
      build('crawler-volume', 'Crawler: volume', 'A mesma carteira, ordenada só pelo volume anormal com o sinal da vela.', 'volume', row => row.volume)
    ]
  };
}

export function datasetSha256(candles: readonly CanonicalCandle[]): string {
  return sha256Content(candles.map(candle => JSON.stringify(candle)).join('\n'));
}
