import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commitDrawings,
  emptyMemory,
  loadDrawings,
  redoDrawings,
  saveDrawings,
  storageKey,
  translateDrawing,
  undoDrawings,
  type Drawing,
  type KeyValueStore
} from '../src/client/chart/drawings';

function memoryStore(): KeyValueStore & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: key => dump.get(key) ?? null,
    setItem: (key, value) => { dump.set(key, value); }
  };
}

const line: Drawing = {
  id: 'd1',
  kind: 'tendencia',
  points: [{ time: 10, price: 100 }, { time: 20, price: 110 }]
};

test('drawings persist per symbol and ignore a broken file', () => {
  const store = memoryStore();
  saveDrawings(store, 'BTCUSDT', [line, { id: '', kind: 'nota', points: [] } as Drawing]);
  assert.equal(loadDrawings(store, 'BTCUSDT').length, 1);
  assert.equal(loadDrawings(store, 'ETHUSDT').length, 0);
  assert.equal(store.dump.get(storageKey('BTCUSDT'))?.includes('tendencia'), true);
  store.setItem(storageKey('BTCUSDT'), '{nao');
  assert.deepEqual(loadDrawings(store, 'BTCUSDT'), []);
});

test('undo and redo restore the previous drawing, and a move shifts both points', () => {
  let state = commitDrawings(emptyMemory(), [line]);
  state = commitDrawings(state, []);
  assert.equal(state.items.length, 0);
  state = undoDrawings(state);
  assert.equal(state.items[0]?.id, 'd1');
  state = redoDrawings(state);
  assert.equal(state.items.length, 0);
  const moved = translateDrawing(line, 5, -1);
  assert.equal(moved.points[0].time, 15);
  assert.equal(moved.points[1].price, 109);
  const blank = emptyMemory();
  assert.equal(undoDrawings(blank), blank);
});
