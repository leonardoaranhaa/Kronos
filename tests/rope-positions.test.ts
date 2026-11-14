import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ropePositions } from '../server/rope-positions';
import { pUpFromEnds, reliabilityTable } from '../server/calibration';

test('a length-1 query puts every unpatched key at position 0', () => {
  const buggy = ropePositions(1, 8, false);
  assert.deepEqual(buggy.query, [0]);
  assert.deepEqual(buggy.keys, [0, 0, 0, 0, 0, 0, 0, 0]);
  const fixed = ropePositions(1, 8, true);
  assert.deepEqual(fixed.query, [7]);
  assert.deepEqual(fixed.keys, [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('equal query and key lengths stay the same after the patch', () => {
  assert.deepEqual(ropePositions(5, 5, false), ropePositions(5, 5, true));
});

test('the vendored patch is the unmerged RoPE fix and does not move the pin', () => {
  const patch = readFileSync(new URL('../patches/kronos-rope-425.patch', import.meta.url), 'utf8');
  const notes = readFileSync(new URL('../patches/README.md', import.meta.url), 'utf8');
  assert.match(patch, /max\(q_len, k_len\)/);
  assert.match(patch, /k_cos, k_sin = cos\[\.\.\., :k_len, :\]/);
  assert.match(notes, /67b630e/);
  assert.match(notes, /#253/);
  assert.match(notes, /#307/);
  assert.doesNotMatch(patch, /checkout/);
});

test('reliability bins compare stated P(up) with how often price rose', () => {
  const table = reliabilityTable([
    { pUp: 1, wentUp: true },
    { pUp: 1, wentUp: false },
    { pUp: 0, wentUp: false },
    { pUp: 0.5, wentUp: true }
  ]);
  assert.deepEqual(table, [
    { pUp: 0, count: 1, realizedUpRate: 0 },
    { pUp: 0.5, count: 1, realizedUpRate: 1 },
    { pUp: 1, count: 2, realizedUpRate: 0.5 }
  ]);
  assert.equal(pUpFromEnds([11, 9, 12, 8], 10), 0.5);
});
