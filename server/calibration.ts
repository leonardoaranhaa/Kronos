export interface ReliabilityBin {
  pUp: number;
  count: number;
  realizedUpRate: number | null;
}

/** Group forecasts by the exact P(up) the sample produced. */
export function reliabilityTable(rows: readonly { pUp: number; wentUp: boolean }[]): ReliabilityBin[] {
  const groups = new Map<number, { count: number; ups: number }>();
  for (const row of rows) {
    const key = Math.round(row.pUp * 1e6) / 1e6;
    const group = groups.get(key) ?? { count: 0, ups: 0 };
    group.count += 1;
    if (row.wentUp) group.ups += 1;
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([pUp, group]) => ({
      pUp,
      count: group.count,
      realizedUpRate: group.count > 0 ? group.ups / group.count : null
    }));
}

export function pUpFromEnds(sampleEnds: readonly number[], close: number): number {
  if (sampleEnds.length === 0 || !(close > 0)) return 0;
  return sampleEnds.filter(value => value > close).length / sampleEnds.length;
}
