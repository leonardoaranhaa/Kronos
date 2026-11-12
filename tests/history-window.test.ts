import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptCandle, createHistoryWindow, describeHistory } from '../server/history-window';
import { candleAt } from './fixtures';

test('accepted count keeps growing after the retained window is full', () => {
  let window = createHistoryWindow(3);
  const evicted = [];
  for (let i = 0; i < 5; i++) {
    const step = acceptCandle(window, candleAt(i, 100 + i));
    window = step.window;
    if (step.evicted) evicted.push(step.evicted.openTime);
  }

  const view = describeHistory(window);
  assert.equal(view.historyCount, 5);
  assert.equal(view.retainedHistoryCount, 3);
  assert.equal(view.historyCap, 3);
  assert.equal(view.historyCapped, true);
  assert.equal(view.latestOpenTime, candleAt(4, 104).openTime);
  assert.deepEqual(window.retained.map(candle => candle.close), [102, 103, 104]);
  assert.equal(evicted.length, 2);
});
