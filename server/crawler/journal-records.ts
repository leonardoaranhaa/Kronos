import type { BookWall, CoinScore, OnchainEvent } from './types';

export interface RankingLog {
  t: string;
  rank: number;
  symbol: string;
  price: number;
  score: number;
  parts: Record<string, number>;
  whalePressure: number | null;
  onchainIn: number;
  onchainOut: number;
}

export interface WallLog {
  t: string;
  walls: { symbol: string; side: 'compra' | 'venda'; price: number; usd: number; distancePct: number }[];
}

export function onchainCounts(symbol: string, events: readonly OnchainEvent[]): { onchainIn: number; onchainOut: number } {
  const base = symbol.replace(/USDT$/, '');
  let onchainIn = 0;
  let onchainOut = 0;
  for (const event of events) {
    if (event.asset !== base) continue;
    if (event.direction === 'entrada na corretora') onchainIn += 1;
    if (event.direction === 'saída da corretora') onchainOut += 1;
  }
  return { onchainIn, onchainOut };
}

/** One JSON line per coin, in rank order. Parts keep the whale contribution separable later. */
export function rankingLines(t: string, scores: readonly CoinScore[], events: readonly OnchainEvent[]): string {
  return scores.map((score, index) => {
    const parts: Record<string, number> = {};
    for (const part of score.parts) parts[part.id] = part.points;
    const counts = onchainCounts(score.symbol, events);
    const row: RankingLog = {
      t,
      rank: index + 1,
      symbol: score.symbol,
      price: score.lastPrice,
      score: score.score,
      parts,
      whalePressure: score.whalePressure,
      onchainIn: counts.onchainIn,
      onchainOut: counts.onchainOut
    };
    return `${JSON.stringify(row)}\n`;
  }).join('');
}

export function wallLine(t: string, walls: readonly BookWall[]): string {
  const row: WallLog = {
    t,
    walls: walls.map(wall => ({
      symbol: wall.symbol,
      side: wall.side,
      price: wall.price,
      usd: wall.usd,
      distancePct: wall.distancePct
    }))
  };
  return `${JSON.stringify(row)}\n`;
}
