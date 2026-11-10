import { loadEnvFile } from './load-env';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { readFile } from 'node:fs/promises';
import { KronosBridge } from './kronos-bridge';
import { MarketFeed } from './market-feed';
import { CanonicalCandle } from '../shared/types';
import { auditCandleSeries, validateCanonicalCandle } from './candle-validation';
import { getHealthSnapshot } from './health';

loadEnvFile();

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const PORT = Number(process.env.PORT || 3000);
const FEED_MODE = (process.env.FEED_MODE || 'binance') as 'replay' | 'binance';
const SYMBOL = (process.env.SYMBOL || 'BTCUSDT').toUpperCase();
const TIMEFRAME = process.env.TIMEFRAME || '5m';

const bridge = new KronosBridge();
const feed = new MarketFeed(FEED_MODE);
const candleHistory: CanonicalCandle[] = [];
const MAX_HISTORY = 600;

function broadcast(data: unknown) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

async function loadHistoricalData(): Promise<void> {
  const path = process.env.HISTORICAL_DATA_PATH;
  if (!path) return;

  const content = await readFile(path, 'utf8');
  const candles = content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as CanonicalCandle);
  const quality = auditCandleSeries(candles);
  if (!quality.valid) {
    throw new Error(`Historical dataset failed integrity audit: ${quality.errors.join('; ')}`);
  }
  if (candles.some(candle =>
    candle.venue !== 'binance' ||
    candle.source !== 'historical' ||
    candle.symbol !== SYMBOL ||
    candle.interval !== TIMEFRAME
  )) {
    throw new Error('Historical dataset provenance, symbol or timeframe does not match the Binance configuration');
  }
  if (FEED_MODE === 'replay') {
    feed.setReplayCandles(candles);
  } else {
    candleHistory.push(...candles.slice(-MAX_HISTORY));
  }
  console.log(`[Data] Validated ${candles.length} historical candles; preloaded ${candleHistory.length} into live-feed history`);
}

bridge.on('model-status', data => broadcast({ type: 'KRONOS_MODEL_STATUS', payload: data }));
bridge.on('model-error', data => broadcast({ type: 'KRONOS_MODEL_ERROR', payload: data }));
bridge.on('prediction', prediction => broadcast({ type: 'KRONOS_AI_PREDICTION', payload: prediction }));

feed.on('status', data => broadcast({ type: 'FEED_STATUS', payload: data }));
feed.on('feed-error', data => broadcast({ type: 'FEED_ERROR', payload: data }));

feed.on('candle', (candle: CanonicalCandle) => {
  const last = candleHistory[candleHistory.length - 1];
  if (last && candle.openTime <= last.openTime) {
    broadcast({ type: 'DATA_QUALITY_WARNING', payload: { message: 'Duplicate or out-of-order candle ignored', openTime: candle.openTime } });
    return;
  }

  candleHistory.push(candle);
  if (candleHistory.length > MAX_HISTORY) candleHistory.shift();

  const quality = auditCandleSeries(candleHistory);
  if (!quality.valid) {
    broadcast({ type: 'DATA_QUALITY_WARNING', payload: { errors: quality.errors.slice(0, 10) } });
  } else {
    const indicators = bridge.processTick(candle, candleHistory);
    broadcast({ type: 'MARKET_TICK', payload: { candle, indicators } });
  }
});

app.get('/api/health', (_req, res) => {
  const feedStatus = feed.getStatus();
  const modelStatus = bridge.getStatus();
  const health = getHealthSnapshot(FEED_MODE, feedStatus, modelStatus);
  res.status(health.ready ? 200 : 503).json({
    ...health,
    feedMode: FEED_MODE,
    feedStatus,
    modelStatus,
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    historyCount: candleHistory.length
  });
});

app.get('/api/history', (_req, res) => {
  res.json({ candles: candleHistory.slice(-100) });
});

async function bootstrap() {
  await loadHistoricalData();
  bridge.start();
  feed.start();
  httpServer.listen(PORT, () => {
    console.log(`[Kronos Research Server] Listening on http://localhost:${PORT}`);
  });
}

function shutdown() {
  feed.stop();
  bridge.stop();
  httpServer.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootstrap().catch(error => {
  console.error('[Kronos Startup Error]', error);
  process.exitCode = 1;
});
