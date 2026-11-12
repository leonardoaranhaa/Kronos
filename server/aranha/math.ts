export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function quantile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] * (high - index) + sorted[high] * (index - low);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** Population z-score. A flat series becomes zeros, not NaN. */
export function zscore(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  let sum = 0;
  for (const value of values) sum += value;
  const avg = sum / values.length;
  let square = 0;
  for (const value of values) square += (value - avg) ** 2;
  const std = Math.sqrt(square / values.length);
  if (!(std > 0)) return values.map(() => 0);
  return values.map(value => (value - avg) / std);
}

export function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}
