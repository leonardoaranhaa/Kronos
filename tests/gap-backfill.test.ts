import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillGap, gapOpenTimes } from '../server/gap-backfill';

test('lists only the open times strictly between two candles', () => {
  assert.deepEqual(gapOpenTimes(0, 300_000, 300_000), []);
  assert.deepEqual(gapOpenTimes(0, 900_000, 300_000), [300_000, 600_000]);
});

test('backfill returns the contiguous public candles and stops at the first hole', async () => {
  const row = (openTime: number) => [
    openTime, '100', '101', '99', '100.5', '1',
    openTime + 299_999, '100', 1, '0.4', '40'
  ];
  const calls: string[] = [];
  const candles = await backfillGap({
    lastOpenTime: 0,
    nextOpenTime: 1_200_000,
    symbol: 'BTCUSDT',
    interval: '5m',
    intervalMs: 300_000,
    restBaseUrl: 'https://example.test',
    now: 2_000_000,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify([row(300_000), row(900_000)]), { status: 200 });
    }
  });
  assert.equal(candles.length, 1);
  assert.equal(candles[0].openTime, 300_000);
  assert.equal(candles[0].source, 'historical');
  assert.match(calls[0], /startTime=300000/);
  assert.match(calls[0], /symbol=BTCUSDT/);
});
