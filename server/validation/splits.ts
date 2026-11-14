export interface IndexRange {
  start: number;
  end: number;
}

export interface Fold {
  train: number[];
  test: number[];
}

export function combinations(n: number, k: number): number[][] {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0 || k > n) {
    throw new Error('combinations expects 0 <= k <= n');
  }
  const out: number[][] = [];
  const current: number[] = [];
  const walk = (start: number): void => {
    if (current.length === k) {
      out.push(current.slice());
      return;
    }
    for (let value = start; value < n; value++) {
      current.push(value);
      walk(value + 1);
      current.pop();
    }
  };
  walk(0);
  return out;
}

/** Contiguous groups covering `0 .. count`. The last groups absorb the remainder. */
export function groupRanges(count: number, groups: number): IndexRange[] {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(groups) || groups < 1 || groups > count) {
    throw new Error('group count must be an integer inside 1..count');
  }
  const base = Math.floor(count / groups);
  let extra = count % groups;
  const ranges: IndexRange[] = [];
  let cursor = 0;
  for (let group = 0; group < groups; group++) {
    const size = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    ranges.push({ start: cursor, end: cursor + size });
    cursor += size;
  }
  return ranges;
}

function contiguousSegments(indexes: readonly number[]): IndexRange[] {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b);
  const segments: IndexRange[] = [];
  for (const index of sorted) {
    const last = segments[segments.length - 1];
    if (last && index === last.end) last.end = index + 1;
    else segments.push({ start: index, end: index + 1 });
  }
  return segments;
}

/**
 * Training indexes with López de Prado's purge and embargo.
 * A training label that overlaps a test label is removed. Training indexes
 * in the embargo window immediately after a test segment are removed too.
 * `horizon` is the number of steps the label looks past its own index.
 */
export function purgedTrainIndexes(
  count: number,
  test: readonly number[],
  horizon: number,
  embargo: number
): number[] {
  if (!Number.isInteger(horizon) || horizon < 0 || !Number.isInteger(embargo) || embargo < 0) {
    throw new Error('horizon and embargo must be non-negative integers');
  }
  const banned = new Set(test);
  const segments = contiguousSegments(test);
  const train: number[] = [];
  for (let index = 0; index < count; index++) {
    if (banned.has(index)) continue;
    const labelEnd = index + horizon;
    let drop = false;
    for (const segment of segments) {
      const overlaps = index <= segment.end - 1 && labelEnd >= segment.start;
      const embargoed = index >= segment.end && index < segment.end + embargo;
      if (overlaps || embargoed) {
        drop = true;
        break;
      }
    }
    if (!drop) train.push(index);
  }
  return train;
}

export function combinatorialPurgedFolds(options: {
  count: number;
  groups: number;
  testGroups: number;
  horizon: number;
  embargo: number;
}): Fold[] {
  const ranges = groupRanges(options.count, options.groups);
  return combinations(options.groups, options.testGroups).map(chosen => {
    const test: number[] = [];
    for (const group of chosen) {
      for (let index = ranges[group].start; index < ranges[group].end; index++) test.push(index);
    }
    return {
      test,
      train: purgedTrainIndexes(options.count, test, options.horizon, options.embargo)
    };
  });
}

/**
 * Expanding walk-forward. Test blocks do not overlap. Train is everything
 * before the test, then purge and embargo are applied. On a causal split the
 * embargo window falls inside or after the test, so the purge does the work.
 */
export function walkForwardFolds(options: {
  count: number;
  groups: number;
  minTrainGroups: number;
  horizon: number;
  embargo: number;
}): Fold[] {
  const ranges = groupRanges(options.count, options.groups);
  if (options.minTrainGroups < 1 || options.minTrainGroups >= options.groups) {
    throw new Error('walk-forward needs at least one train group and one test group');
  }
  const folds: Fold[] = [];
  for (let group = options.minTrainGroups; group < options.groups; group++) {
    const test: number[] = [];
    for (let index = ranges[group].start; index < ranges[group].end; index++) test.push(index);
    const train = purgedTrainIndexes(options.count, test, options.horizon, options.embargo)
      .filter(index => index < ranges[group].start);
    folds.push({ train, test });
  }
  return folds;
}
