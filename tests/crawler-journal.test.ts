import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendJournalLines } from '../server/crawler/journal';
import { rankingLines, wallLine } from '../server/crawler/journal-records';
import { CrawlerRuntime } from '../server/crawler/runtime';
import { readCrawlerConfig } from '../server/crawler/config';
import type { CoinScore, MarketBar, OnchainEvent } from '../server/crawler/types';

function score(symbol: string, whalePoints: number): CoinScore {
  return {
    symbol,
    score: 10 + whalePoints,
    reason: 'teste',
    parts: [
      { id: 'regime', label: 'Tendência', points: 10, sentence: '' },
      { id: 'whale', label: 'Baleias', points: whalePoints, sentence: '' }
    ],
    lastPrice: 100,
    changeLookbackPct: 1,
    regime1h: 'alta',
    regime4h: 'alta',
    analogCount: 8,
    analogMedianBps: 5,
    relativeStrength: 0.2,
    whalePressure: 0.4
  };
}

const chain: OnchainEvent = {
  id: 'tx',
  asset: 'ETH',
  time: '2026-11-12T12:00:00.000Z',
  amount: '100 ETH',
  txid: 'tx',
  url: 'https://example.test/tx',
  direction: 'entrada na corretora',
  label: 'Binance',
  source: 'fixture'
};

test('a ranking line keeps the whale component and the on-chain counts', () => {
  const lines = rankingLines('2026-11-12T12:00:00.000Z', [score('ETHUSDT', 6), score('BTCUSDT', 0)], [chain]);
  const rows = lines.trim().split('\n').map(line => JSON.parse(line) as { symbol: string; rank: number; parts: { whale: number }; onchainIn: number; price: number });
  assert.equal(rows[0].symbol, 'ETHUSDT');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].price, 100);
  assert.equal(rows[0].parts.whale, 6);
  assert.equal(rows[0].onchainIn, 1);
  assert.equal(rows[1].onchainIn, 0);
  const walls = JSON.parse(wallLine('2026-11-12T12:00:00.000Z', [{
    symbol: 'ETHUSDT', side: 'compra', price: 99, usd: 250000, distancePct: 0.4
  }]).trim()) as { walls: { usd: number }[] };
  assert.equal(walls.walls[0].usd, 250000);
});

test('journals rotate by day and by size, and drop old days', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kronos-journal-'));
  const day = new Date('2026-11-12T12:00:00.000Z');
  const first = appendJournalLines(dir, 'rankings', '{"n":1}\n', day, 12, 10);
  appendJournalLines(dir, 'rankings', '{"n":2}\n{"n":3}\n', day, 12, 10);
  const nextDay = appendJournalLines(dir, 'rankings', '{"n":4}\n', new Date('2026-11-13T00:00:00.000Z'), 12, 10);
  assert.match(first, /rankings-2026-11-12\.jsonl$/);
  assert.match(nextDay, /rankings-2026-11-13\.jsonl$/);
  const rolled = readFileSync(join(dir, 'rankings-2026-11-12.1.jsonl'), 'utf8');
  assert.match(rolled, /"n":2/);
  writeFileSync(join(dir, 'rankings-2026-10-01.jsonl'), '{"old":true}\n');
  appendJournalLines(dir, 'rankings', '{"n":5}\n', day, 12, 10);
  assert.throws(() => readFileSync(join(dir, 'rankings-2026-10-01.jsonl'), 'utf8'));
});

test('the runtime writes one ranking line per coin and one wall snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kronos-crawler-log-'));
  const config = readCrawlerConfig({
    CRAWLER_ENABLED: '0',
    CRAWLER_KRONOS_TOP: '0',
    CRAWLER_SNAPSHOT_DIR: dir
  } as NodeJS.ProcessEnv);
  const app = new CrawlerRuntime(config);
  const start = 1_704_067_200_000;
  const series = (seed: number): MarketBar[] => Array.from({ length: 80 }, (_, index) => {
    const close = 100 + seed + index * 0.01;
    return {
      openTime: start + index * 300_000,
      open: close,
      high: close + 0.2,
      low: close - 0.2,
      close,
      volume: 10,
      quoteVolume: close * 10,
      takerBuyQuote: close * 6
    };
  });
  app.setBars('BTCUSDT', series(1));
  app.setBars('ETHUSDT', series(3));
  await app.refreshRanks();
  app.notePrint({
    id: 'p1',
    symbol: 'ETHUSDT',
    time: '2026-11-12T12:00:00.000Z',
    usd: 200_000,
    side: 'compra',
    price: 103
  });
  const now = new Date('2026-11-12T18:00:00.000Z');
  app.writeCycleLog(now);
  const rankings = readFileSync(join(dir, 'rankings-2026-11-12.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as { symbol: string; parts: { whale: number }; whalePressure: number | null });
  assert.equal(rankings.length, 2);
  assert.ok(rankings.every(row => typeof row.parts.whale === 'number'));
  assert.ok(rankings.some(row => row.symbol === 'ETHUSDT' && row.whalePressure !== null));
  const walls = JSON.parse(readFileSync(join(dir, 'walls-2026-11-12.jsonl'), 'utf8')) as { t: string; walls: unknown[] };
  assert.equal(walls.t, now.toISOString());
  assert.ok(Array.isArray(walls.walls));
});
