import { binomialSurvivalHalf } from '../research-stats';
import { mean } from './moments';
import { mulberry32 } from './random';

export interface Overlap {
  /** How many bars the label looks ahead. */
  horizon: number;
  /** Bars between successive decisions. */
  stride: number;
}

export interface DirectionTest {
  hits: number;
  compared: number;
  accuracy: number | null;
  independentHits: number;
  independentCompared: number;
  /** Binomial tail on decisions whose labels do not share a price path. */
  independentPValue: number | null;
  /** Circular block bootstrap of the full series. Null when the labels do not overlap. */
  blockBootstrapPValue: number | null;
  /**
   * The p-value used for a claim. With overlap it is the larger of the two
   * dependence-aware figures, so shared price paths cannot shrink the tail.
   */
  pValue: number | null;
  method: 'binomial' | 'binomial-and-block-bootstrap';
}

export function nonOverlappingIndexes<T extends { index: number }>(records: readonly T[], horizon: number): T[] {
  const step = Math.max(1, horizon);
  const sorted = records.slice().sort((a, b) => a.index - b.index || 0);
  const kept: T[] = [];
  let next = -Infinity;
  for (const record of sorted) {
    if (record.index >= next) {
      kept.push(record);
      next = record.index + step;
    }
  }
  return kept;
}

/**
 * One-sided p-value for a mean above `nullMean`, preserving local dependence
 * with a circular block bootstrap. The +1 smoothing keeps the result inside (0, 1).
 */
export function blockBootstrapMeanPValue(
  values: readonly number[],
  nullMean: number,
  blockLength: number,
  repetitions: number,
  seed: number
): number {
  const n = values.length;
  if (n === 0 || repetitions < 1) return 1;
  const observed = mean(values);
  const centered = values.map(value => value - observed);
  const block = Math.max(1, Math.min(Math.floor(blockLength), n));
  const random = mulberry32(seed);
  let extreme = 0;
  for (let rep = 0; rep < repetitions; rep++) {
    let sum = 0;
    let filled = 0;
    while (filled < n) {
      const start = Math.floor(random() * n);
      const take = Math.min(block, n - filled);
      for (let k = 0; k < take; k++) sum += centered[(start + k) % n];
      filled += take;
    }
    if (sum / n + nullMean >= observed - 1e-12) extreme += 1;
  }
  return (extreme + 1) / (repetitions + 1);
}

export function directionTest(
  records: readonly { index: number; hit: boolean | null }[],
  overlap: Overlap,
  bootstrapRepetitions = 999
): DirectionTest {
  const compared = records.filter(record => record.hit !== null) as { index: number; hit: boolean }[];
  const hits = compared.filter(record => record.hit).length;
  const horizon = Math.max(1, overlap.horizon);
  const stride = Math.max(1, overlap.stride);
  const independent = nonOverlappingIndexes(compared, horizon);
  const independentHits = independent.filter(record => record.hit).length;
  const independentPValue = independent.length > 0
    ? binomialSurvivalHalf(independentHits, independent.length)
    : null;
  const overlaps = horizon > stride;
  const blockBootstrapPValue = overlaps && compared.length >= 4
    ? blockBootstrapMeanPValue(
      compared.map(record => record.hit ? 1 : 0),
      0.5,
      Math.ceil(horizon / stride),
      bootstrapRepetitions,
      20261114
    )
    : null;
  const pValue = independentPValue === null
    ? null
    : blockBootstrapPValue === null
      ? independentPValue
      : Math.max(independentPValue, blockBootstrapPValue);
  return {
    hits,
    compared: compared.length,
    accuracy: compared.length > 0 ? hits / compared.length : null,
    independentHits,
    independentCompared: independent.length,
    independentPValue,
    blockBootstrapPValue,
    pValue,
    method: blockBootstrapPValue === null ? 'binomial' : 'binomial-and-block-bootstrap'
  };
}
