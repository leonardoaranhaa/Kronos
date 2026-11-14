/**
 * Position indexes used by rotary embeddings.
 * The unpatched Kronos code builds the table from the query length. A single
 * query therefore broadcasts position 0 onto every key. The patched code
 * (patches/kronos-rope-425.patch) uses 0..kLen-1 for keys and the last qLen
 * positions for the query.
 */
export function ropePositions(qLen: number, kLen: number, patched: boolean): { query: number[]; keys: number[] } {
  if (qLen < 1 || kLen < 1) throw new Error('lengths must be positive');
  if (!patched) {
    if (qLen === 1) return { query: [0], keys: Array.from({ length: kLen }, () => 0) };
    if (qLen !== kLen) throw new Error('unpatched RoPE only broadcasts when the query length is 1 or equal to the keys');
    const positions = Array.from({ length: qLen }, (_, index) => index);
    return { query: positions, keys: positions.slice() };
  }
  const table = Math.max(qLen, kLen);
  return {
    query: Array.from({ length: qLen }, (_, index) => table - qLen + index),
    keys: Array.from({ length: kLen }, (_, index) => index)
  };
}
