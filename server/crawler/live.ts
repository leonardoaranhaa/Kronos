import { breakoutNow, signedVolumeSpike } from './score';
import type { BookWall, MarketBar, OnchainEvent, WhalePrint } from './types';

export interface LiveCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface LiveZone {
  low: number;
  high: number;
  kind: 'support' | 'resistance' | 'analog';
}

export interface LiveAnnotation {
  id: string;
  time: number;
  price: number;
  kind: 'estrutura' | 'rompimento' | 'volume' | 'analogia' | 'baleia' | 'cadeia' | 'entrada' | 'saida';
  label: string;
  usd?: number;
  side?: 'compra' | 'venda';
}

export interface LiveFeedItem {
  id: string;
  time: string;
  text: string;
}

export interface PaperMark {
  at: string;
  type: string;
  purpose?: string;
  side?: string;
  price?: number;
  action?: string;
}

export interface CoinView {
  candles: LiveCandle[];
  zones: LiveZone[];
  walls: { price: number; side: 'compra' | 'venda'; usd: number }[];
  annotations: LiveAnnotation[];
  feed: LiveFeedItem[];
}

function candleTime(bar: MarketBar): number {
  return bar.openTime;
}

function isHammer(bar: MarketBar): boolean {
  const range = bar.high - bar.low;
  if (!(range > 0)) return false;
  const body = Math.abs(bar.close - bar.open);
  const lower = Math.min(bar.open, bar.close) - bar.low;
  const upper = bar.high - Math.max(bar.open, bar.close);
  return lower >= body * 2 && upper <= body && body / range <= 0.35;
}

function swingZones(bars: readonly MarketBar[]): LiveZone[] {
  const slice = bars.slice(-80);
  const zones: LiveZone[] = [];
  for (let i = 2; i < slice.length - 2; i++) {
    const high = slice[i].high;
    const low = slice[i].low;
    const isHigh = slice.slice(i - 2, i + 3).every((bar, offset) => offset === 2 || bar.high <= high);
    const isLow = slice.slice(i - 2, i + 3).every((bar, offset) => offset === 2 || bar.low >= low);
    if (isHigh) zones.push({ low: high * 0.999, high: high * 1.001, kind: 'resistance' });
    if (isLow) zones.push({ low: low * 0.999, high: low * 1.001, kind: 'support' });
  }
  const last = slice[slice.length - 1]?.close ?? 0;
  return zones
    .filter(zone => last > 0 && zone.high >= last * 0.97 && zone.low <= last * 1.03)
    .slice(-4);
}

/**
 * Chart overlays for one coin. Only the bars passed in are read.
 * Whale, chain and paper marks are events that already happened.
 */
export function buildCoinView(input: {
  symbol: string;
  bars: readonly MarketBar[];
  reason?: string;
  analogMedianBps?: number | null;
  whales?: readonly WhalePrint[];
  walls?: readonly BookWall[];
  onchain?: readonly OnchainEvent[];
  paper?: readonly PaperMark[];
}): CoinView {
  const visible = input.bars.slice(-90);
  const candles: LiveCandle[] = visible.map(bar => ({
    t: bar.openTime,
    o: bar.open,
    h: bar.high,
    l: bar.low,
    c: bar.close
  }));
  const annotations: LiveAnnotation[] = [];
  const base = input.symbol.replace(/USDT$/, '');
  const from = Math.max(20, input.bars.length - 12);
  for (let index = from; index < input.bars.length; index++) {
    const prefix = input.bars.slice(0, index + 1);
    const bar = input.bars[index];
    const breakout = breakoutNow(prefix);
    if (breakout !== 0) {
      annotations.push({
        id: `${input.symbol}-break-${bar.openTime}`,
        time: candleTime(bar),
        price: bar.close,
        kind: 'rompimento',
        side: breakout > 0 ? 'compra' : 'venda',
        label: `${base}: rompimento para ${breakout > 0 ? 'cima' : 'baixo'} no candle das ${new Date(bar.openTime).toISOString().slice(11, 16)}.`
      });
    }
    const volume = signedVolumeSpike(prefix);
    if (volume !== 0) {
      annotations.push({
        id: `${input.symbol}-vol-${bar.openTime}`,
        time: candleTime(bar),
        price: bar.close,
        kind: 'volume',
        side: volume > 0 ? 'compra' : 'venda',
        label: `${base}: volume anormal numa vela de ${volume > 0 ? 'alta' : 'baixa'}.`
      });
    }
    if (isHammer(bar)) {
      annotations.push({
        id: `${input.symbol}-hammer-${bar.openTime}`,
        time: candleTime(bar),
        price: bar.low,
        kind: 'estrutura',
        side: 'compra',
        label: `${base}: martelo no gráfico.`
      });
    }
  }

  const zones = swingZones(input.bars);
  if (visible.length >= 24) {
    const window = visible.slice(-24);
    const low = Math.min(...window.map(bar => bar.low));
    const high = Math.max(...window.map(bar => bar.high));
    zones.push({ low, high, kind: 'analog' });
    if (input.analogMedianBps !== null && input.analogMedianBps !== undefined) {
      const last = candles[candles.length - 1];
      annotations.push({
        id: `${input.symbol}-analog-${last.t}`,
        time: last.t,
        price: last.c,
        kind: 'analogia',
        label: `${base}: trechos parecidos com mediana ${input.analogMedianBps > 0 ? '+' : ''}${input.analogMedianBps.toFixed(0)} bps.`
      });
    }
  }

  for (const print of input.whales ?? []) {
    if (print.symbol !== input.symbol) continue;
    const time = Date.parse(print.time);
    annotations.push({
      id: print.id,
      time: Number.isNaN(time) ? (candles.at(-1)?.t ?? 0) : time,
      price: print.price,
      kind: 'baleia',
      side: print.side,
      usd: print.usd,
      label: `${base}: ${print.side} grande de ${Math.round(print.usd).toLocaleString('pt-BR')} dólares.`
    });
  }

  const walls = (input.walls ?? [])
    .filter(wall => wall.symbol === input.symbol)
    .slice(0, 4)
    .map(wall => ({ price: wall.price, side: wall.side, usd: wall.usd }));
  for (const wall of walls) {
    const last = candles.at(-1);
    annotations.push({
      id: `${input.symbol}-wall-${wall.side}-${wall.price}`,
      time: last?.t ?? 0,
      price: wall.price,
      kind: 'estrutura',
      side: wall.side,
      usd: wall.usd,
      label: `${base}: parede de ${wall.side} em ${wall.price.toLocaleString('pt-BR')} (${Math.round(wall.usd).toLocaleString('pt-BR')} dólares).`
    });
  }

  for (const event of input.onchain ?? []) {
    if (event.asset !== base && !(base === 'BTC' && event.asset === 'BTC')) continue;
    if (!input.symbol.startsWith(event.asset)) continue;
    const time = Date.parse(event.time);
    const last = candles.at(-1);
    annotations.push({
      id: event.id,
      time: Number.isNaN(time) ? (last?.t ?? 0) : time,
      price: last?.c ?? 0,
      kind: 'cadeia',
      label: `${base}: ${event.direction}${event.label ? ` (${event.label})` : ''} na cadeia, ${event.amount}.`
    });
  }

  for (const mark of input.paper ?? []) {
    if (mark.type !== 'fill' || !(typeof mark.price === 'number') || !(mark.price > 0)) continue;
    const time = Date.parse(mark.at);
    const opening = mark.purpose === 'open';
    annotations.push({
      id: `paper-${mark.at}-${mark.purpose}-${mark.side}`,
      time: Number.isNaN(time) ? (candles.at(-1)?.t ?? 0) : time,
      price: mark.price,
      kind: opening ? 'entrada' : 'saida',
      side: mark.side === 'sell' ? 'venda' : 'compra',
      label: opening
        ? `Paper: entrada simulada de ${mark.side === 'sell' ? 'venda' : 'compra'} a ${mark.price.toLocaleString('pt-BR')}.`
        : `Paper: saída simulada a ${mark.price.toLocaleString('pt-BR')}.`
    });
  }

  const feed: LiveFeedItem[] = [];
  if (input.reason) {
    const last = candles.at(-1);
    feed.push({
      id: `${input.symbol}-reason-${last?.t ?? 0}`,
      time: new Date(last?.t ?? 0).toISOString(),
      text: `${base}: ${input.reason}`
    });
  }
  for (const item of annotations.slice(-8)) {
    feed.push({ id: item.id, time: new Date(item.time).toISOString(), text: item.label });
  }

  return { candles, zones, walls, annotations, feed };
}
