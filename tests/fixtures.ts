import { CanonicalCandle } from '../shared/types';

const INTERVAL = 300_000;
const START = 1_704_067_200_000;

export function candleAt(index: number, close: number, open = close): CanonicalCandle {
  const openTime = START + index * INTERVAL;
  const high = Math.max(open, close) + 0.5;
  const low = Math.min(open, close) - 0.5;
  return {
    venue: 'binance',
    symbol: 'BTCUSDT',
    interval: '5m',
    openTime,
    closeTime: openTime + INTERVAL - 1,
    open,
    high,
    low,
    close,
    volume: 1,
    quoteVolume: close,
    source: 'historical',
    ingestedAt: openTime
  };
}

export function series(count: number, closeAt: (index: number) => number): CanonicalCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = closeAt(index);
    const open = index === 0 ? close : closeAt(index - 1);
    return candleAt(index, close, open);
  });
}
