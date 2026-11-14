import { mean } from './moments';
import { mulberry32 } from './random';

function averageRanks(values: readonly number[]): number[] | null {
  if (values.length === 0) return null;
  const order = values.map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
  const ranks = new Array<number>(values.length);
  let cursor = 0;
  while (cursor < order.length) {
    let end = cursor;
    while (end + 1 < order.length && order[end + 1].value === order[cursor].value) end += 1;
    const average = (cursor + 1 + end + 1) / 2;
    for (let slot = cursor; slot <= end; slot++) ranks[order[slot].index] = average;
    cursor = end + 1;
  }
  return ranks;
}

/** Spearman rank correlation. Null when either side does not vary. */
export function spearman(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const leftRanks = averageRanks(left);
  const rightRanks = averageRanks(right);
  if (!leftRanks || !rightRanks) return null;
  const leftMean = mean(leftRanks);
  const rightMean = mean(rightRanks);
  let numerator = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (let index = 0; index < leftRanks.length; index++) {
    const a = leftRanks[index] - leftMean;
    const b = rightRanks[index] - rightMean;
    numerator += a * b;
    leftSquare += a * a;
    rightSquare += b * b;
  }
  if (!(leftSquare > 0) || !(rightSquare > 0)) return null;
  return numerator / Math.sqrt(leftSquare * rightSquare);
}

export interface RankCorrelation {
  coefficient: number | null;
  observations: number;
  /** Two-sided permutation p-value. Null when the coefficient is undefined. */
  pValue: number | null;
}

/**
 * Spearman correlation with a two-sided permutation test.
 * Pass only non-overlapping pairs: shuffling assumes those pairs are exchangeable.
 */
export function spearmanTest(
  predicted: readonly number[],
  actual: readonly number[],
  repetitions = 499,
  seed = 20261114
): RankCorrelation {
  const coefficient = spearman(predicted, actual);
  if (coefficient === null) {
    return { coefficient: null, observations: predicted.length, pValue: null };
  }
  const random = mulberry32(seed);
  const shuffled = actual.slice();
  let extreme = 0;
  for (let rep = 0; rep < repetitions; rep++) {
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1));
      const held = shuffled[index];
      shuffled[index] = shuffled[swap];
      shuffled[swap] = held;
    }
    const sample = spearman(predicted, shuffled);
    if (sample !== null && Math.abs(sample) >= Math.abs(coefficient) - 1e-12) extreme += 1;
  }
  return {
    coefficient,
    observations: predicted.length,
    pValue: (extreme + 1) / (repetitions + 1)
  };
}
