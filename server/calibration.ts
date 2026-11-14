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

export const MIN_PROBABILITY_SAMPLES = 2;
export const INSUFFICIENT_SAMPLES_NOTE = 'sem amostras suficientes';

/**
 * One forecast path is not a probability. P(alta) is only returned when at
 * least two sampled paths were actually drawn.
 */
export function probabilityUp(sampleEnds: readonly number[], close: number): { pUp: number | null; note: string | null } {
  if (sampleEnds.length < MIN_PROBABILITY_SAMPLES || !(close > 0)) {
    return { pUp: null, note: INSUFFICIENT_SAMPLES_NOTE };
  }
  return { pUp: pUpFromEnds(sampleEnds, close), note: null };
}

export interface DisplayedProbability {
  pUp?: number;
  probabilityNote: string | null;
  quantileBand?: { p10?: number[]; p90?: number[] };
}

/** What the panel is allowed to call a probability. */
export function displayedForecastProbability(message: {
  sampleCount?: unknown;
  probabilityAvailable?: unknown;
  probabilityNote?: unknown;
  pUp?: unknown;
  quantileBand?: { p10?: number[]; p90?: number[] } | null;
}): DisplayedProbability {
  const sampleCount = Number(message.sampleCount);
  const available = message.probabilityAvailable !== false
    && Number.isFinite(sampleCount)
    && sampleCount >= MIN_PROBABILITY_SAMPLES
    && typeof message.pUp === 'number'
    && Number.isFinite(message.pUp);
  if (!available) {
    const note = typeof message.probabilityNote === 'string' && message.probabilityNote.trim()
      ? message.probabilityNote
      : INSUFFICIENT_SAMPLES_NOTE;
    return { probabilityNote: note };
  }
  return {
    pUp: message.pUp as number,
    probabilityNote: null,
    quantileBand: message.quantileBand ?? undefined
  };
}

export function brierScore(rows: readonly { pUp: number; wentUp: boolean }[]): number | null {
  if (rows.length === 0) return null;
  let sum = 0;
  for (const row of rows) {
    if (!(row.pUp >= 0 && row.pUp <= 1)) return null;
    const outcome = row.wentUp ? 1 : 0;
    sum += (row.pUp - outcome) ** 2;
  }
  return sum / rows.length;
}

/** Brier score of always predicting the observed base rate. */
export function climatologyBrier(rows: readonly { wentUp: boolean }[]): number | null {
  if (rows.length === 0) return null;
  const rate = rows.filter(row => row.wentUp).length / rows.length;
  let sum = 0;
  for (const row of rows) sum += (rate - (row.wentUp ? 1 : 0)) ** 2;
  return sum / rows.length;
}

export interface ReliabilityCurveBin {
  binLow: number;
  binHigh: number;
  count: number;
  meanPredicted: number | null;
  realizedUpRate: number | null;
}

/** Equal-width reliability curve. The last bin includes 1. */
export function reliabilityCurve(
  rows: readonly { pUp: number; wentUp: boolean }[],
  bins = 10
): ReliabilityCurveBin[] {
  if (!Number.isInteger(bins) || bins < 1) throw new Error('reliability bins must be a positive integer');
  const groups = Array.from({ length: bins }, (_, index) => ({
    binLow: index / bins,
    binHigh: (index + 1) / bins,
    count: 0,
    predicted: 0,
    ups: 0
  }));
  for (const row of rows) {
    if (!(row.pUp >= 0 && row.pUp <= 1)) continue;
    const slot = Math.min(bins - 1, Math.max(0, Math.floor(row.pUp * bins)));
    const group = groups[slot];
    group.count += 1;
    group.predicted += row.pUp;
    if (row.wentUp) group.ups += 1;
  }
  return groups.map(group => ({
    binLow: group.binLow,
    binHigh: group.binHigh,
    count: group.count,
    meanPredicted: group.count > 0 ? group.predicted / group.count : null,
    realizedUpRate: group.count > 0 ? group.ups / group.count : null
  }));
}
