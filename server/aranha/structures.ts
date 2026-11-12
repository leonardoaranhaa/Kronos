import { CanonicalCandle } from '../../shared/types';
import { ARANHA_GATES } from './gates';
import { median, roundTo } from './math';
import { Bar, resampleCompleted } from './resample';
import type { ChartMarker, PatternHit, PriceZone, Timeframe } from './types';

const FIVE_MINUTES = 300_000;
const ONE_HOUR = 3_600_000;
const FOUR_HOURS = 14_400_000;

type Regime = 'up' | 'down' | 'range';

interface Frame {
  timeframe: Timeframe;
  bars: Bar[];
  horizon: number;
  horizonLabel: string;
}

function toBars(candles: readonly CanonicalCandle[]): Bar[] {
  return candles.map(candle => ({
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  }));
}

function atrAt(bars: readonly Bar[], index: number, period = 14): number | null {
  if (index < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const current = bars[i];
    const previous = bars[i - 1];
    sum += Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
  }
  return sum / period;
}

function slope(values: readonly number[]): number {
  const n = values.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

export function regimeAt(bars: readonly Bar[], index: number): Regime | null {
  const lookback = ARANHA_GATES.trendLookback;
  if (index < lookback) return null;
  const closes: number[] = [];
  for (let i = index - lookback + 1; i <= index; i++) closes.push(bars[i].close);
  const atr = atrAt(bars, index);
  if (atr === null || atr === 0) return 'range';
  const projected = slope(closes) * lookback;
  if (projected > ARANHA_GATES.trendAtrFactor * atr) return 'up';
  if (projected < -ARANHA_GATES.trendAtrFactor * atr) return 'down';
  return 'range';
}

function priorExtreme(bars: readonly Bar[], index: number, lookback: number, side: 'high' | 'low'): number | null {
  if (index < lookback) return null;
  let value = side === 'high' ? -Infinity : Infinity;
  for (let i = index - lookback; i < index; i++) {
    const price = side === 'high' ? bars[i].high : bars[i].low;
    if (side === 'high' ? price > value : price < value) value = price;
  }
  return value;
}

function isDoji(bar: Bar): boolean {
  const range = bar.high - bar.low;
  if (!(range > 0) || !(bar.close > 0)) return false;
  return Math.abs(bar.close - bar.open) / range < 0.1 && range / bar.close > 0.0005;
}

function isHammer(bars: readonly Bar[], index: number): boolean {
  if (index < 3) return false;
  const bar = bars[index];
  const range = bar.high - bar.low;
  if (!(range > 0)) return false;
  const body = Math.abs(bar.close - bar.open);
  const lower = Math.min(bar.open, bar.close) - bar.low;
  const upper = bar.high - Math.max(bar.open, bar.close);
  if (!(lower >= body * 2 && upper <= body && body / range <= 0.35)) return false;
  return bar.close < bars[index - 3].close;
}

function isShootingStar(bars: readonly Bar[], index: number): boolean {
  if (index < 3) return false;
  const bar = bars[index];
  const range = bar.high - bar.low;
  if (!(range > 0)) return false;
  const body = Math.abs(bar.close - bar.open);
  const upper = bar.high - Math.max(bar.open, bar.close);
  const lower = Math.min(bar.open, bar.close) - bar.low;
  if (!(upper >= body * 2 && lower <= body && body / range <= 0.35)) return false;
  return bar.close > bars[index - 3].close;
}

function isBullishEngulfing(bars: readonly Bar[], index: number): boolean {
  if (index < 1) return false;
  const previous = bars[index - 1];
  const bar = bars[index];
  const previousBear = previous.close < previous.open;
  const currentBull = bar.close > bar.open;
  return previousBear && currentBull && bar.open <= previous.close && bar.close >= previous.open;
}

function isBearishEngulfing(bars: readonly Bar[], index: number): boolean {
  if (index < 1) return false;
  const previous = bars[index - 1];
  const bar = bars[index];
  return previous.close > previous.open && bar.close < bar.open && bar.open >= previous.close && bar.close <= previous.open;
}

function isVolumeSpike(bars: readonly Bar[], index: number): boolean {
  if (index < 20) return false;
  const volumes: number[] = [];
  for (let i = index - 20; i < index; i++) volumes.push(bars[i].volume);
  const typical = medianOf(volumes);
  return typical > 0 && bars[index].volume >= typical * 2;
}

function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function isBreakoutUp(bars: readonly Bar[], index: number): boolean {
  const ceiling = priorExtreme(bars, index, 20, 'high');
  return ceiling !== null && bars[index].close > ceiling;
}

function isBreakoutDown(bars: readonly Bar[], index: number): boolean {
  const floor = priorExtreme(bars, index, 20, 'low');
  return floor !== null && bars[index].close < floor;
}

function isSupportRetest(bars: readonly Bar[], index: number): boolean {
  const floor = priorExtreme(bars, index, 20, 'low');
  if (floor === null) return false;
  const bar = bars[index];
  return bar.low <= floor * 1.001 && bar.close > floor && bar.close >= bar.open;
}

function isResistanceReject(bars: readonly Bar[], index: number): boolean {
  const ceiling = priorExtreme(bars, index, 20, 'high');
  if (ceiling === null) return false;
  const bar = bars[index];
  return bar.high >= ceiling * 0.999 && bar.close < ceiling && bar.close <= bar.open;
}

interface Detector {
  id: string;
  name: string;
  kind: 'state' | 'event';
  side: 'up' | 'down';
  detect: (bars: readonly Bar[], index: number) => boolean;
}

function detectorsFor(timeframe: Timeframe): Detector[] {
  const prefix = timeframe;
  return [
    { id: 'regime-up', name: `Tendência de alta (${prefix})`, kind: 'state', side: 'up', detect: (bars, index) => regimeAt(bars, index) === 'up' },
    { id: 'regime-down', name: `Tendência de baixa (${prefix})`, kind: 'state', side: 'down', detect: (bars, index) => regimeAt(bars, index) === 'down' },
    { id: 'regime-range', name: `Lateral (${prefix})`, kind: 'state', side: 'up', detect: (bars, index) => regimeAt(bars, index) === 'range' },
    { id: 'breakout-up', name: `Rompimento para cima (${prefix})`, kind: 'event', side: 'up', detect: isBreakoutUp },
    { id: 'breakout-down', name: `Rompimento para baixo (${prefix})`, kind: 'event', side: 'down', detect: isBreakoutDown },
    { id: 'hammer', name: `Martelo (${prefix})`, kind: 'event', side: 'up', detect: isHammer },
    { id: 'shooting-star', name: `Estrela cadente (${prefix})`, kind: 'event', side: 'down', detect: isShootingStar },
    { id: 'bull-engulf', name: `Engolfo de alta (${prefix})`, kind: 'event', side: 'up', detect: isBullishEngulfing },
    { id: 'bear-engulf', name: `Engolfo de baixa (${prefix})`, kind: 'event', side: 'down', detect: isBearishEngulfing },
    { id: 'doji', name: `Doji (${prefix})`, kind: 'event', side: 'up', detect: (bars, index) => isDoji(bars[index]) },
    { id: 'volume-spike', name: `Volume anormal (${prefix})`, kind: 'event', side: 'up', detect: isVolumeSpike },
    { id: 'support-retest', name: `Reteste de suporte (${prefix})`, kind: 'event', side: 'up', detect: isSupportRetest },
    { id: 'resistance-reject', name: `Rejeição de resistência (${prefix})`, kind: 'event', side: 'down', detect: isResistanceReject }
  ];
}

function collectReturns(bars: readonly Bar[], horizon: number, asOf: number, detector: Detector): number[] {
  const values: number[] = [];
  if (detector.kind === 'state') {
    for (let index = 0; index + horizon <= asOf; index += horizon) {
      if (!detector.detect(bars, index)) continue;
      const origin = bars[index].close;
      if (!(origin > 0)) continue;
      values.push((bars[index + horizon].close / origin - 1) * 10_000);
    }
    return values;
  }
  let index = 0;
  while (index + horizon <= asOf) {
    if (!detector.detect(bars, index)) {
      index += 1;
      continue;
    }
    const origin = bars[index].close;
    if (origin > 0) values.push((bars[index + horizon].close / origin - 1) * 10_000);
    index += horizon;
  }
  return values;
}

function hitOf(frame: Frame, detector: Detector): PatternHit {
  const asOf = frame.bars.length - 1;
  const returns = asOf < 0 ? [] : collectReturns(frame.bars, frame.horizon, asOf, detector);
  const ups = returns.filter(value => value > 0).length;
  const downs = returns.filter(value => value < 0).length;
  const activeNow = asOf >= 0 && detector.detect(frame.bars, asOf);
  const sampleNote = returns.length < 20 ? ' Amostra pequena.' : '';
  return {
    id: detector.id,
    name: detector.name,
    timeframe: frame.timeframe,
    activeNow,
    hitRateUp: returns.length ? ups / returns.length : null,
    hitRateDown: returns.length ? downs / returns.length : null,
    sampleCount: returns.length,
    medianForwardReturnBps: median(returns) === null ? null : roundTo(median(returns) as number, 1),
    horizonBars: frame.horizon,
    horizonLabel: frame.horizonLabel,
    detail: `Horizonte de ${frame.horizon} candles de ${frame.timeframe} (${frame.horizonLabel}). As amostras não se sobrepõem nesse horizonte e só entram quando o resultado já era conhecido neste instante.${sampleNote}`
  };
}

export function framesAt(candles: readonly CanonicalCandle[], asOf: number): Frame[] {
  if (asOf < 0 || asOf >= candles.length) return [];
  const prefix = candles.slice(0, asOf + 1);
  const asOfClose = prefix[prefix.length - 1].closeTime;
  const base = toBars(prefix);
  return [
    { timeframe: '5m', bars: base, horizon: 12, horizonLabel: '1 hora' },
    { timeframe: '1h', bars: resampleCompleted(prefix, ONE_HOUR, FIVE_MINUTES, asOfClose), horizon: 4, horizonLabel: '4 horas' },
    { timeframe: '4h', bars: resampleCompleted(prefix, FOUR_HOURS, FIVE_MINUTES, asOfClose), horizon: 6, horizonLabel: '1 dia' }
  ];
}

/** Point-in-time pattern scan. Bars after `asOf` are not read. */
export function evaluatePatterns(candles: readonly CanonicalCandle[], asOf: number): PatternHit[] {
  const frames = framesAt(candles, asOf);
  const hits: PatternHit[] = [];
  for (const frame of frames) {
    if (frame.bars.length === 0) continue;
    for (const detector of detectorsFor(frame.timeframe)) hits.push(hitOf(frame, detector));
  }
  return hits;
}

function swings(bars: readonly Bar[], asOf: number, wing: number): { price: number; kind: 'high' | 'low' }[] {
  const found: { price: number; kind: 'high' | 'low' }[] = [];
  for (let index = wing; index + wing <= asOf; index++) {
    let high = true;
    let low = true;
    for (let neighbor = index - wing; neighbor <= index + wing; neighbor++) {
      if (neighbor === index) continue;
      if (bars[neighbor].high > bars[index].high) high = false;
      if (bars[neighbor].low < bars[index].low) low = false;
    }
    if (high) found.push({ price: bars[index].high, kind: 'high' });
    if (low) found.push({ price: bars[index].low, kind: 'low' });
  }
  return found;
}

function cluster(swingsFound: { price: number; kind: 'high' | 'low' }[], tolerance: number, last: number, timeframe: Timeframe): PriceZone[] {
  const zones: PriceZone[] = [];
  for (const kind of ['low', 'high'] as const) {
    const prices = swingsFound.filter(item => item.kind === kind).map(item => item.price).sort((a, b) => a - b);
    let bucket: number[] = [];
    const emit = () => {
      if (bucket.length >= 2) {
        zones.push({
          timeframe,
          kind: kind === 'low' ? 'support' : 'resistance',
          low: bucket[0],
          high: bucket[bucket.length - 1],
          touches: bucket.length
        });
      }
      bucket = [];
    };
    for (const price of prices) {
      if (bucket.length === 0 || price - bucket[0] <= tolerance) bucket.push(price);
      else {
        emit();
        bucket = [price];
      }
    }
    emit();
  }
  return zones
    .filter(zone => zone.high >= last * 0.97 && zone.low <= last * 1.03)
    .sort((a, b) => b.touches - a.touches || a.low - b.low)
    .slice(0, 6);
}

export function priceZones(bars: readonly Bar[], timeframe: Timeframe): PriceZone[] {
  if (bars.length < 10) return [];
  const asOf = bars.length - 1;
  const atr = atrAt(bars, asOf) ?? bars[asOf].close * 0.002;
  const tolerance = Math.max(bars[asOf].close * 0.0015, atr * 0.35);
  return cluster(swings(bars, asOf, 3), tolerance, bars[asOf].close, timeframe);
}

const MARKED = new Set(['hammer', 'shooting-star', 'bull-engulf', 'bear-engulf', 'doji', 'breakout-up', 'breakout-down', 'volume-spike', 'support-retest', 'resistance-reject']);

export function markersAt(candles: readonly CanonicalCandle[], patterns: readonly PatternHit[]): ChartMarker[] {
  if (candles.length === 0) return [];
  const last = candles[candles.length - 1];
  return patterns
    .filter(pattern => pattern.timeframe === '5m' && pattern.activeNow && MARKED.has(pattern.id))
    .map(pattern => ({
      openTime: last.openTime,
      label: pattern.name.replace(' (5m)', ''),
      side: pattern.id.includes('down') || pattern.id.includes('bear') || pattern.id.includes('shooting') || pattern.id.includes('resistance') ? 'down' as const : 'up' as const
    }));
}

export function regimeLabel(patterns: readonly PatternHit[], timeframe: Timeframe): string {
  const active = patterns.find(pattern => pattern.timeframe === timeframe && pattern.id.startsWith('regime-') && pattern.activeNow);
  if (!active) return 'indefinido';
  if (active.id === 'regime-up') return 'alta';
  if (active.id === 'regime-down') return 'baixa';
  return 'lateral';
}

export function zonesForContext(candles: readonly CanonicalCandle[], asOf: number): PriceZone[] {
  const frames = framesAt(candles, asOf);
  const zones: PriceZone[] = [];
  for (const frame of frames) {
    if (frame.timeframe === '4h') continue;
    zones.push(...priceZones(frame.bars, frame.timeframe));
  }
  return zones;
}
