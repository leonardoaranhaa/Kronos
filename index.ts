import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { KronosBridge } from './kronos-bridge';
import { MarketFeed } from './market-feed';
import { OrderExecutionManager } from './order_execution';
import { Candle } from '../shared/types';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const PORT = process.env.PORT || 3000;
const FEED_MODE = (process.env.FEED_MODE as 'replay' | 'binance') || 'replay';

const bridge = new KronosBridge();
const feed = new MarketFeed(FEED_MODE);
const candleHistory: Candle[] = [];

const executor = new OrderExecutionManager({
  apiKey: process.env.BINANCE_API_KEY || '',
  apiSecret: process.env.BINANCE_API_SECRET || '',
  baseUrl: process.env.BINANCE_BASE_URL || 'https://testnet.binance.vision'
});

bridge.start();

function broadcast(data: any) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

bridge.on('prediction', (predictionData) => {
  broadcast({
    type: 'KRONOS_AI_PREDICTION',
    payload: {
      timestamp: predictionData.timestamp,
      predictedCloses: predictionData.predictions
    }
  });
});

feed.on('candle', (candle: Candle) => {
  candleHistory.push(candle);
  if (candleHistory.length > 300) candleHistory.shift();

  const vpin = parseFloat((Math.random() * 0.4 + 0.15).toFixed(2));
  const ofi = parseFloat(((Math.random() - 0.48) * 120).toFixed(2));

  const { indicators, signal } = bridge.processTick(candle, candleHistory, false, vpin);

  broadcast({
    type: 'MARKET_TICK',
    payload: {
      candle,
      indicators,
      signal,
      vpin,
      ofi
    }
  });
});

feed.start();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', feedMode: FEED_MODE, historyCount: candleHistory.length });
});

app.get('/api/history', (req, res) => {
  res.json({ candles: candleHistory.slice(-100) });
});

httpServer.listen(PORT, () => {
  console.log(`[Kronos Server] Servidor a executar em http://localhost:${PORT}`);
});
