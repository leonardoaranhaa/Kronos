import { loadEnvFile } from './load-env';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { KronosBridge } from './kronos-bridge';
import { MarketFeed } from './market-feed';
import { Candle, CanonicalCandle, TechnicalIndicators } from '../shared/types';
import { auditCandleSeries, intervalToMilliseconds, validateCanonicalCandle } from './candle-validation';
import { backfillGap } from './gap-backfill';
import { getHealthSnapshot } from './health';
import { computeIndicators } from './indicators';
import { decideSignal, ResearchSignal } from './signals';
import { researchAction } from './research-eval';
import { loadPromotion, paperDecisionDue, selectPaperStrategy } from './paper-strategy';
import { SAMPLE_COUNT, researchPaperStride } from './research-protocol';
import { displayedForecastProbability } from './calibration';
import { sampleStd } from './research-stats';
import { readResearchConfig } from './research-config';
import { describeHistory, createHistoryWindow, preloadHistory, acceptCandle } from './history-window';
import { PaperSession } from './paper-session';
import { formatResearchAlert, sendTelegramMessage } from './telegram';
import { AranhaRuntime } from './aranha/runtime';
import { CrawlerRuntime } from './crawler/runtime';
import { readCrawlerConfig } from './crawler/config';
import { toCanonical } from './crawler/score';
import { isPublicInterval, parsePublicKlines } from './market/public-klines';
import { readAranhaConfig } from './aranha/config';
import { sendTeia } from './teia/handler';
import { FuturesLiveCollector, readFuturesLiveConfig } from './futures/live';
import { futuresRoot } from './futures/paths';
import { overlayPayload } from './futures/overlay';

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
const config = readResearchConfig();
const aranha = new AranhaRuntime();
const paperChoice = selectPaperStrategy(
  process.env.PAPER_STRATEGY,
  loadPromotion('reports/research-m2.json'),
  { symbol: SYMBOL, interval: TIMEFRAME }
);
console.log(`[Paper] ${paperChoice.reason}`);

const bridge = new KronosBridge(paperChoice.id === 'pesquisa'
  ? { sampleCount: SAMPLE_COUNT, horizon: 6, maxContext: 256 }
  : {});
const crawlerConfig = readCrawlerConfig();
const teiaPaths = {
  crawlerDir: crawlerConfig.snapshotDir,
  aranhaDir: readAranhaConfig().snapshotDir
};
const futuresLive = new FuturesLiveCollector(readFuturesLiveConfig());
const crawler = new CrawlerRuntime(crawlerConfig, {
  forecaster: {
    ready: () => bridge.getStatus() === 'ready',
    predict: async (symbol, bars) => bridge.forecastIfIdle(toCanonical(symbol, bars))
  },
});
const feed = new MarketFeed(FEED_MODE);
const MAX_HISTORY = 600;
let history = createHistoryWindow(MAX_HISTORY);
const session = new PaperSession(
  config.costs,
  config.breaker,
  config.startingEquity,
  config.auditPath,
  config.statePath
);

let latestIndicators: TechnicalIndicators | null = null;
let latestCandle: CanonicalCandle | null = null;
let latestForecast: number[] = [];
let latestDistribution: { p10?: number[]; p90?: number[]; pUp?: number; probabilityNote?: string } | null = null;
let startupInferenceRequested = false;
const decisions = new Map<number, { close: number; indicators: TechnicalIndicators }>();
let ingestQueue = Promise.resolve();

crawler.setOnUpdate(() => {
  const paper = session.getSnapshot();
  broadcast({
    type: 'ARANHA_LIVE',
    payload: crawler.live({
      symbol: SYMBOL,
      events: paper.recentEvents.map(event => ({
        at: event.at,
        type: event.type,
        purpose: typeof event.purpose === 'string' ? event.purpose : undefined,
        side: typeof event.side === 'string' ? event.side : undefined,
        price: typeof event.price === 'number' ? event.price : undefined,
        action: typeof event.action === 'string' ? event.action : undefined
      }))
    })
  });
});

function broadcast(data: unknown) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

function toIndicatorCandle(candle: CanonicalCandle): Candle {
  return {
    timestamp: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume
  };
}

function snapshotPayload() {
  return {
    candle: latestCandle,
    indicators: latestIndicators,
    forecast: latestForecast,
    quantileBand: latestDistribution?.p10 || latestDistribution?.p90
      ? { p10: latestDistribution.p10, p90: latestDistribution.p90 }
      : undefined,
    pUp: latestDistribution?.pUp,
    probabilityNote: latestDistribution?.probabilityNote,
    paper: session.getSnapshot(),
    history: describeHistory(history)
  };
}

async function notify(text: string): Promise<void> {
  try {
    await sendTelegramMessage(text, {
      token: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID
    });
  } catch (error) {
    console.error('[Telegram]', error instanceof Error ? error.message : error);
  }
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
  aranha.setCandles(candles);
  if (FEED_MODE === 'replay') {
    feed.setReplayCandles(candles);
  } else {
    history = preloadHistory(history, candles);
    latestCandle = history.retained[history.retained.length - 1] ?? null;
    if (history.retained.length) {
      latestIndicators = computeIndicators(history.retained.map(toIndicatorCandle));
    }
  }
  console.log(`[Data] Validated ${candles.length} historical candles; retained ${history.retained.length}; accepted ${history.acceptedCount}`);
}

/** Pulls completed public candles that closed after the snapshot and before the process started. */
async function catchUpHistory(): Promise<void> {
  if (FEED_MODE !== 'binance' || history.retained.length === 0) return;
  const last = history.retained[history.retained.length - 1];
  const intervalMs = intervalToMilliseconds(last.interval);
  if (intervalMs === null) return;
  const filled = await backfillGap({
    lastOpenTime: last.openTime,
    nextOpenTime: Date.now(),
    symbol: last.symbol,
    interval: last.interval,
    intervalMs,
    restBaseUrl: process.env.BINANCE_REST_BASE_URL || 'https://data-api.binance.vision'
  });
  for (const candle of filled) {
    history = acceptCandle(history, candle).window;
    aranha.append(candle);
  }
  latestCandle = history.retained[history.retained.length - 1] ?? null;
  if (history.retained.length) {
    latestIndicators = computeIndicators(history.retained.map(toIndicatorCandle));
  }
  if (filled.length) console.log(`[Data] Caught up ${filled.length} completed candles from the public REST API`);
}

function rememberDecision(candle: CanonicalCandle, indicators: TechnicalIndicators): void {
  decisions.set(candle.openTime, { close: candle.close, indicators });
  if (decisions.size > 8) {
    const oldest = decisions.keys().next().value;
    if (oldest !== undefined) decisions.delete(oldest);
  }
}

function requestForecast(candle: CanonicalCandle, indicators: TechnicalIndicators): void {
  if (!paperDecisionDue(paperChoice, history.acceptedCount, researchPaperStride())) return;
  rememberDecision(candle, indicators);
  if (bridge.processTick(candle, history.retained)) startupInferenceRequested = true;
}

bridge.on('model-status', data => {
  broadcast({ type: 'KRONOS_MODEL_STATUS', payload: data });
  if (data.status === 'READY' && !startupInferenceRequested && latestCandle && latestIndicators && history.retained.length >= 32) {
    requestForecast(latestCandle, latestIndicators);
  }
});
bridge.on('model-error', data => broadcast({ type: 'KRONOS_MODEL_ERROR', payload: data }));
bridge.on('prediction', prediction => {
  const predicted = Array.isArray(prediction.predictions) ? prediction.predictions as number[] : [];
  latestForecast = predicted;
  const displayed = displayedForecastProbability(prediction as {
    sampleCount?: unknown;
    probabilityAvailable?: unknown;
    probabilityNote?: unknown;
    pUp?: unknown;
    quantileBand?: { p10?: number[]; p90?: number[] } | null;
  });
  latestDistribution = {
    p10: displayed.quantileBand?.p10,
    p90: displayed.quantileBand?.p90,
    pUp: displayed.pUp,
    probabilityNote: displayed.probabilityNote ?? undefined
  };
  const decisionOpenTime = Number(prediction.timestamp);
  const decision = decisions.get(decisionOpenTime);
  let signal: ResearchSignal | null = null;
  if (decision) {
    if (paperChoice.id === 'pesquisa') {
      const sampleEnds = Array.isArray(prediction.sampleEnds) ? prediction.sampleEnds as number[] : [];
      const meanEnd = predicted[predicted.length - 1];
      const predictedReturnBps = ((meanEnd - decision.close) / decision.close) * 10_000;
      const dispersionBps = sampleStd(sampleEnds.map(value => ((value - decision.close) / decision.close) * 10_000));
      const action = researchAction({
        close: decision.close,
        predictedReturnBps,
        dispersionBps,
        atr: decision.indicators.atr14,
        ema9: decision.indicators.ema9,
        ema20: decision.indicators.ema20,
        rsi14: decision.indicators.rsi14
      }, paperChoice.params);
      signal = {
        action,
        reason: `Estratégia pesquisa: ${action === 'BUY' ? 'compra' : action === 'SELL' ? 'venda' : 'manter'}. Movimento previsto ${predictedReturnBps.toFixed(1)} bps, dispersão ${dispersionBps.toFixed(1)} bps.`,
        forecastReturnBps: predictedReturnBps,
        heuristicScore: 0,
        indicators: decision.indicators
      };
    } else {
      signal = decideSignal({
        close: decision.close,
        predictedCloses: predicted,
        ema9: decision.indicators.ema9,
        ema20: decision.indicators.ema20,
        rsi14: decision.indicators.rsi14,
        atr14: decision.indicators.atr14
      }, config.signal);
    }
    aranha.noteSignal(signal);
    const aranhaView = aranha.view();
    signal = aranhaView.usedSignal ?? signal;
    session.queueSignal(signal, decisionOpenTime, Date.now());
    decisions.delete(decisionOpenTime);
    if (signal.action !== 'HOLD') {
      void notify(formatResearchAlert([
        `Par: ${SYMBOL}`,
        `Sinal: ${signal.action}`,
        `Referência: ${decision.close}`,
        `Motivo: ${signal.reason}`
      ]));
    }
  }
  broadcast({
    type: 'KRONOS_AI_PREDICTION',
    payload: {
      ...prediction,
      predictedCloses: predicted,
      pUp: displayed.pUp,
      probabilityNote: displayed.probabilityNote,
      quantileBand: displayed.quantileBand,
      signal,
      aranha: aranha.view()
    }
  });
  broadcast({ type: 'PAPER_STATE', payload: snapshotPayload() });
});

feed.on('status', data => broadcast({ type: 'FEED_STATUS', payload: data }));
feed.on('feed-error', data => broadcast({ type: 'FEED_ERROR', payload: data }));
feed.on('heartbeat', (data: { at?: number }) => session.noteFeedHeartbeat(data.at ?? Date.now()));

feed.on('candle', (candle: CanonicalCandle) => {
  ingestQueue = ingestQueue.then(() => ingestCandle(candle)).catch(error => {
    console.error('[Data] Candle ingest failed', error instanceof Error ? error.message : error);
  });
});

async function ingestCandle(candle: CanonicalCandle): Promise<void> {
  const validation = validateCanonicalCandle(candle);
  if (!validation.valid) {
    broadcast({ type: 'DATA_QUALITY_WARNING', payload: { errors: validation.errors } });
    return;
  }
  const intervalMs = intervalToMilliseconds(candle.interval);
  let last = history.retained[history.retained.length - 1];
  if (last && candle.openTime <= last.openTime) {
    broadcast({ type: 'DATA_QUALITY_WARNING', payload: { message: 'Duplicate or out-of-order candle ignored', openTime: candle.openTime } });
    return;
  }
  if (last && intervalMs !== null && candle.openTime > last.openTime + intervalMs) {
    try {
      const filled = await backfillGap({
        lastOpenTime: last.openTime,
        nextOpenTime: candle.openTime,
        symbol: candle.symbol,
        interval: candle.interval,
        intervalMs,
        restBaseUrl: process.env.BINANCE_REST_BASE_URL || 'https://data-api.binance.vision'
      });
      for (const item of filled) history = acceptCandle(history, item).window;
      if (filled.length) console.log(`[Data] Backfilled ${filled.length} candles before ${candle.openTime}`);
    } catch (error) {
      broadcast({ type: 'DATA_QUALITY_WARNING', payload: { message: 'Could not backfill the candle gap', error: error instanceof Error ? error.message : String(error) } });
    }
    last = history.retained[history.retained.length - 1];
    if (last && intervalMs !== null && candle.openTime !== last.openTime + intervalMs) {
      broadcast({ type: 'DATA_QUALITY_WARNING', payload: { message: 'Live candle left a gap and was not added', openTime: candle.openTime, lastOpenTime: last.openTime } });
      return;
    }
  }

  const accepted = acceptCandle(history, candle);
  history = accepted.window;
  latestCandle = candle;
  aranha.append(candle);
  const quality = auditCandleSeries(history.retained);
  if (!quality.valid) {
    broadcast({ type: 'DATA_QUALITY_WARNING', payload: { errors: quality.errors.slice(0, 10) } });
    broadcast({ type: 'MARKET_TICK', payload: snapshotPayload() });
    return;
  }

  latestIndicators = computeIndicators(history.retained.map(toIndicatorCandle));
  const step = session.onCandle(candle, Date.now());
  if (step.flattened) {
    void notify(formatResearchAlert([
      'Trava de risco disparada. A posição simulada foi encerrada.',
      session.getSnapshot().breaker.reason
    ]));
  }
  requestForecast(candle, latestIndicators);
  broadcast({ type: 'MARKET_TICK', payload: snapshotPayload() });
}

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
    ...describeHistory(history)
  });
});

app.get('/api/klines', async (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  const interval = String(req.query.interval || '5m');
  const limit = Math.min(1000, Math.max(50, Number(req.query.limit) || 500));
  const endRaw = req.query.endTime === undefined ? undefined : Number(req.query.endTime);
  if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !isPublicInterval(interval) || (endRaw !== undefined && !Number.isFinite(endRaw))) {
    res.status(400).json({ error: 'Pedido inválido.', candles: [] });
    return;
  }
  try {
    const base = (process.env.BINANCE_REST_BASE_URL || 'https://data-api.binance.vision').replace(/\/$/, '');
    const url = new URL(`${base}/api/v3/klines`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('limit', String(limit));
    if (endRaw !== undefined) url.searchParams.set('endTime', String(Math.trunc(endRaw)));
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) {
      res.status(502).json({ error: `A Binance respondeu HTTP ${response.status}.`, candles: [] });
      return;
    }
    res.json({ symbol, interval, candles: parsePublicKlines(await response.json()) });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : 'Sem dados da Binance.', candles: [] });
  }
});

app.get('/api/history', (_req, res) => {
  res.json({ candles: history.retained.slice(-180) });
});

app.get('/api/paper', (_req, res) => {
  res.json(snapshotPayload());
});

app.get('/api/aranha-live', (_req, res) => {
  const paper = session.getSnapshot();
  res.json(crawler.live({
    symbol: SYMBOL,
    events: paper.recentEvents.map(event => ({
      at: event.at,
      type: event.type,
      purpose: typeof event.purpose === 'string' ? event.purpose : undefined,
      side: typeof event.side === 'string' ? event.side : undefined,
      price: typeof event.price === 'number' ? event.price : undefined,
      action: typeof event.action === 'string' ? event.action : undefined
    }))
  }));
});

app.get('/api/crawler', (_req, res) => {
  res.json(crawler.snapshot());
});

app.get('/api/crawler/symbol/:symbol', (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    res.status(400).json({ error: 'Símbolo inválido.' });
    return;
  }
  res.json(crawler.detail(symbol));
});

app.get('/api/crawler-backtest', (_req, res) => {
  const reportPath = process.env.CRAWLER_REPORT_PATH || 'reports/crawler-latest.json';
  if (!existsSync(reportPath)) {
    res.status(404).json({ error: 'Ainda não há estudo do crawler. Rode npm run backtest:crawler.' });
    return;
  }
  res.type('json').send(readFileSync(reportPath, 'utf8'));
});

app.get('/api/aranha', (_req, res) => {
  res.json(aranha.view());
});

app.get('/api/aranha-backtest', (_req, res) => {
  const reportPath = process.env.ARANHA_REPORT_PATH || 'reports/aranha-latest.json';
  if (!existsSync(reportPath)) {
    res.status(404).json({
      error: 'Ainda não há backtest da Aranha. Rode npm run backtest:aranha depois de importar os candles.'
    });
    return;
  }
  res.type('json').send(readFileSync(reportPath, 'utf8'));
});

app.get('/api/research-m3', (_req, res) => {
  const path = 'reports/research-m3.json';
  if (!existsSync(path)) {
    res.status(404).json({ error: 'Ainda não há a comparação do patch. Rode npm run research:m3.' });
    return;
  }
  res.type('json').send(readFileSync(path, 'utf8'));
});

app.get('/api/futures/overlay', (req, res) => {
  const symbol = String(req.query.symbol || '').toUpperCase();
  const startRaw = req.query.startTime === undefined ? null : Number(req.query.startTime);
  const endRaw = req.query.endTime === undefined ? null : Number(req.query.endTime);
  if (!/^[A-Z0-9]{5,20}$/.test(symbol) || (startRaw !== null && !Number.isFinite(startRaw)) || (endRaw !== null && !Number.isFinite(endRaw))) {
    res.status(400).json({ error: 'Pedido inválido.', symbol, funding: [], openInterest: [], note: '' });
    return;
  }
  res.json(overlayPayload(futuresRoot(), symbol, startRaw, endRaw));
});

app.get('/api/futures/status', (_req, res) => {
  res.json({
    live: futuresLive.status(),
    root: futuresRoot(),
    note: 'Coleta pública. Nenhuma ordem é enviada e nenhuma chave é usada.'
  });
});

app.get('/api/validation', (_req, res) => {
  const path = 'reports/validation-latest.json';
  if (!existsSync(path)) {
    res.status(404).json({ error: 'Ainda não há validação. Rode npm run validate.' });
    return;
  }
  res.type('json').send(readFileSync(path, 'utf8'));
});

app.get('/api/research', (_req, res) => {
  const path = 'reports/research-m2.json';
  if (!existsSync(path)) {
    res.status(404).json({ error: 'Ainda não há pesquisa. Rode npm run research depois de importar os candles.' });
    return;
  }
  res.type('json').send(readFileSync(path, 'utf8'));
});

app.get('/api/teia', (req, res) => {
  void sendTeia(req, res, teiaPaths);
});

app.get('/api/backtest', (_req, res) => {
  if (!existsSync(config.reportPath)) {
    res.status(404).json({
      error: 'Ainda não há relatório. Rode npm run backtest depois de importar os candles.'
    });
    return;
  }
  res.type('json').send(readFileSync(config.reportPath, 'utf8'));
});

async function bootstrap() {
  await loadHistoricalData();
  await catchUpHistory();
  aranha.startBackground();
  crawler.start();
  futuresLive.start();
  bridge.start();
  feed.start();
  httpServer.listen(PORT, () => {
    console.log(`[Kronos Research Server] Listening on http://localhost:${PORT}`);
    console.log('[Kronos Research Server] Paper trading only. No orders are submitted.');
  });
}

function shutdown() {
  feed.stop();
  bridge.stop();
  aranha.stop();
  crawler.stop();
  futuresLive.stop();
  httpServer.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootstrap().catch(error => {
  console.error('[Kronos Startup Error]', error);
  process.exitCode = 1;
});
