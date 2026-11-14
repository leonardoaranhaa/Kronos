import { combinations } from './splits';
import { sharpeRatio } from './sharpe';

export interface BacktestOverfit {
  /** Fraction of CSCV splits whose logit is negative. Null when the matrix is too small. */
  probability: number | null;
  splits: number;
  blocks: number;
  strategies: number;
  logits: number[];
}

function performance(column: readonly number[]): number {
  return sharpeRatio(column) ?? 0;
}

/** Average rank, 1 = worst and N = best. Ties share the average rank. */
export function ascendingMidrank(values: readonly number[], index: number): number {
  const order = values.map((value, position) => ({ value, position }))
    .sort((a, b) => a.value - b.value || a.position - b.position);
  const ranks = new Array<number>(values.length);
  let cursor = 0;
  while (cursor < order.length) {
    let end = cursor;
    while (end + 1 < order.length && order[end + 1].value === order[cursor].value) end += 1;
    const average = (cursor + 1 + end + 1) / 2;
    for (let slot = cursor; slot <= end; slot++) ranks[order[slot].position] = average;
    cursor = end + 1;
  }
  return ranks[index];
}

/**
 * Probability of Backtest Overfitting by combinatorially symmetric
 * cross-validation (Bailey, Borwein, López de Prado and Zhu).
 *
 * `returns` is a matrix of aligned simple returns: one row per time, one
 * column per strategy. Blocks stay in calendar order. The logit of a split is
 * negative when the strategy that won in-sample lands below the out-of-sample
 * median. PBO is the fraction of those splits.
 */
export function probabilityOfBacktestOverfitting(returns: readonly (readonly number[])[]): BacktestOverfit {
  const rows = returns.length;
  const columns = returns[0]?.length ?? 0;
  const empty: BacktestOverfit = { probability: null, splits: 0, blocks: 0, strategies: columns, logits: [] };
  if (rows < 16 || columns < 2) return empty;
  if (returns.some(row => row.length !== columns)) throw new Error('PBO matrix is not rectangular');
  let blocks = Math.min(16, Math.floor(rows / 8));
  if (blocks % 2 === 1) blocks -= 1;
  if (blocks < 2) return empty;
  const blockLength = Math.floor(rows / blocks);
  const groups: number[][][] = [];
  for (let block = 0; block < blocks; block++) {
    const slice = returns.slice(block * blockLength, (block + 1) * blockLength);
    groups.push(slice.map(row => row.slice()));
  }
  const logits: number[] = [];
  for (const chosen of combinations(blocks, blocks / 2)) {
    const chosenSet = new Set(chosen);
    const trainRows: number[][] = [];
    const testRows: number[][] = [];
    for (let block = 0; block < blocks; block++) {
      const target = chosenSet.has(block) ? trainRows : testRows;
      target.push(...groups[block]);
    }
    if (trainRows.length < 2 || testRows.length < 2) continue;
    const train = Array.from({ length: columns }, (_, column) => performance(trainRows.map(row => row[column])));
    const test = Array.from({ length: columns }, (_, column) => performance(testRows.map(row => row[column])));
    let best = 0;
    for (let column = 1; column < columns; column++) {
      if (train[column] > train[best]) best = column;
    }
    const rank = ascendingMidrank(test, best);
    const omega = rank / (columns + 1);
    if (!(omega > 0 && omega < 1)) continue;
    logits.push(Math.log(omega / (1 - omega)));
  }
  if (logits.length === 0) return { ...empty, blocks };
  const overfit = logits.filter(value => value < 0).length;
  return {
    probability: overfit / logits.length,
    splits: logits.length,
    blocks,
    strategies: columns,
    logits
  };
}
