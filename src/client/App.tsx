import { useEffect, useState } from 'react';
import PriceChart from './PriceChart';
import AranhaPanel, { AranhaBrief } from './AranhaPanel';
import { CanonicalCandle, TechnicalIndicators } from '../../shared/types';
import type { ResearchSignal } from '../../server/signals';

type Tab = 'mercado' | 'paper' | 'backtest' | 'aranha';

interface PaperView {
  equity: number;
  cash: number;
  qty: number;
  side: 'long' | 'short' | 'flat';
  realizedPnl: number;
  feesPaid: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  lastPrice: number | null;
  signal: ResearchSignal | null;
  signalPending: boolean;
  equityCurve: { t: number; equity: number }[];
  recentEvents: { at: string; type: string; action?: string; reason?: string; simulated?: boolean }[];
  breaker: {
    tripped: boolean;
    inCooldown: boolean;
    feedStale: boolean;
    consecutiveLosses: number;
    dailyPnlPct: number;
    reason: string;
  };
}

interface HistoryView {
  historyCount: number;
  retainedHistoryCount: number;
  historyCap: number;
  latestOpenTime: number | null;
}

interface BacktestView {
  disclaimer?: string;
  sampling?: { context: number; horizon: number; stride: number; decisionCount: number; candleCount: number };
  forecast?: { directionalAccuracy: number | null; mae: number | null; mape: number | null; directionalSamples: number };
  strategies?: Record<string, {
    label: string;
    returnPct: number;
    maxDrawdownPct: number;
    winRatePct: number | null;
    closedTrades: number;
    sharpe: number | null;
    feesPaid: number;
  }>;
  limitations?: string[];
  signalRules?: string[];
  runtime?: { inferenceMs: number; forecasts: number };
}

const money = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatMoney(value: number): string {
  const cents = Math.round((value + Number.EPSILON) * 100) / 100;
  return money.format(Math.abs(cents) < 0.005 ? 0 : cents);
}
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatTime(value: number | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

function signalLabel(action: string | undefined): string {
  if (action === 'BUY') return 'Compra';
  if (action === 'SELL') return 'Venda';
  if (action === 'HOLD') return 'Manter';
  return 'Manter';
}

function feedLabel(status: string): string {
  if (status === 'connected') return 'conectado';
  if (status === 'connecting') return 'conectando';
  if (status === 'reconnecting') return 'reconectando';
  if (status === 'replay-complete') return 'replay concluído';
  if (status === 'error') return 'erro';
  if (status === 'stopped') return 'parado';
  return status || 'desconhecido';
}

function modelLabel(status: string): string {
  const value = status.toLowerCase();
  if (value === 'ready') return 'pronto';
  if (value === 'error') return 'erro';
  if (value === 'stopped') return 'parado';
  return 'iniciando';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('mercado');
  const [connected, setConnected] = useState(false);
  const [model, setModel] = useState('iniciando');
  const [feed, setFeed] = useState('iniciando');
  const [closes, setCloses] = useState<number[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [forecast, setForecast] = useState<number[]>([]);
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [paper, setPaper] = useState<PaperView | null>(null);
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [backtest, setBacktest] = useState<BacktestView | null>(null);
  const [backtestError, setBacktestError] = useState('');

  useEffect(() => {
    const apply = (payload: { indicators?: TechnicalIndicators; forecast?: number[]; paper?: PaperView; history?: HistoryView; candle?: CanonicalCandle | null }) => {
      if (payload.indicators) setIndicators(payload.indicators);
      if (payload.forecast) setForecast(payload.forecast);
      if (payload.paper) setPaper(payload.paper);
      if (payload.history) setHistory(payload.history);
      if (payload.candle) setPrice(payload.candle.close);
    };

    fetch('/api/health').then(response => response.json()).then(health => {
      setFeed(feedLabel(String(health.feedStatus || '')));
      setModel(modelLabel(String(health.modelStatus || '')));
    }).catch(() => undefined);

    fetch('/api/paper').then(response => response.json()).then(payload => {
      apply(payload);
      return fetch('/api/history');
    }).then(response => response.json()).then(payload => {
      const candles = (payload.candles || []) as CanonicalCandle[];
      setCloses(candles.map(candle => candle.close));
      if (candles.length) setPrice(candles[candles.length - 1].close);
    }).catch(() => undefined);

    fetch('/api/backtest').then(async response => {
      const body = await response.json();
      if (!response.ok) setBacktestError(body.error || 'Relatório indisponível.');
      else setBacktest(body);
    }).catch(() => setBacktestError('Não foi possível ler o relatório de backtest.'));

    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:3000`);
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.type === 'MARKET_TICK' || message.type === 'PAPER_STATE') {
        apply(message.payload);
        if (message.type === 'MARKET_TICK' && message.payload.candle) {
          setCloses(current => [...current, message.payload.candle.close].slice(-180));
        }
      } else if (message.type === 'KRONOS_AI_PREDICTION') {
        const predicted = message.payload.predictedCloses || message.payload.predictions || [];
        setForecast(predicted);
        if (message.payload.signal) {
          setPaper(current => current ? { ...current, signal: message.payload.signal, signalPending: true } : current);
        }
      } else if (message.type === 'KRONOS_MODEL_STATUS') {
        setModel(modelLabel(String(message.payload.status || '')));
      } else if (message.type === 'FEED_STATUS') {
        setFeed(feedLabel(String(message.payload.status || '')));
      }
    };
    return () => socket.close();
  }, []);

  const signal = paper?.signal;
  const strategies = backtest?.strategies
    ? ['kronos', 'buyAndHold', 'persistence', 'random'].map(key => backtest.strategies?.[key]).filter(Boolean)
    : [];

  return (
    <div className="app">
      <div className="banner">
        Pesquisa e simulação. Este programa não envia ordens e não promete lucro.
      </div>
      <header>
        <div>
          <h1>Kronos</h1>
          <p className="muted">Pesquisa de previsão e paper trading de BTCUSDT 5m</p>
        </div>
        <div className="pills">
          <span className="pill">Conexão <strong className={connected ? 'ok' : 'bad'}>{connected ? 'ligada' : 'desligada'}</strong></span>
          <span className="pill">Feed <strong className={feed === 'conectado' ? 'ok' : 'warn'}>{feed}</strong></span>
          <span className="pill">Modelo <strong className={model === 'pronto' ? 'ok' : 'warn'}>{model}</strong></span>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {([['mercado', 'Mercado'], ['paper', 'Paper'], ['backtest', 'Backtest'], ['aranha', 'Aranha']] as const).map(([id, label]) => (
          <button key={id} className="tab" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'mercado' && (
        <div className="layout">
          <section className="card">
            <h2>Sinal atual</h2>
            <div className={`signal ${signal?.action === 'BUY' ? 'buy' : signal?.action === 'SELL' ? 'sell' : 'hold'}`}>
              {signalLabel(signal?.action)}
            </div>
            <p className="reason">{signal?.reason || 'Ainda não há uma previsão para transformar em sinal.'}</p>
            <AranhaBrief />
            <p className="muted">
              Força heurística: {signal ? pct.format(signal.heuristicScore * 100) : '0,00'}%. Isto não é probabilidade de acerto.
            </p>
            <p className="muted">{paper?.signalPending ? 'Sinal aguardando a próxima abertura para simular a execução.' : 'Sem execução pendente.'}</p>
          </section>
          <section className="card">
            <h2>Preço e previsão</h2>
            <div className="signal">{price === null || price === undefined ? '—' : `${money.format(price)} USDT`}</div>
            <PriceChart closes={closes} forecast={forecast} />
            <div className="legend">
              <span><i className="swatch price" /> Fechamento</span>
              <span><i className="swatch forecast" /> Previsão do modelo</span>
            </div>
            <div className="metrics">
              <div className="metric"><span>EMA 9</span><strong>{indicators?.ema9 ?? '—'}</strong></div>
              <div className="metric"><span>EMA 20</span><strong>{indicators?.ema20 ?? '—'}</strong></div>
              <div className="metric"><span>RSI 14</span><strong>{indicators?.rsi14 ?? '—'}</strong></div>
              <div className="metric"><span>ATR 14</span><strong>{indicators?.atr14 ?? '—'}</strong></div>
            </div>
            <p className="muted">
              Janela em memória: {history ? `${history.retainedHistoryCount} de ${history.historyCap}` : '—'}.
              Candles aceitos: {history?.historyCount ?? '—'}.
              Último candle: {formatTime(history?.latestOpenTime ?? null)}.
            </p>
          </section>
        </div>
      )}

      {tab === 'paper' && (
        <section className="card">
          <h2>Carteira simulada</h2>
          <div className="metrics">
            <div className="metric"><span>Patrimônio</span><strong>{formatMoney(paper?.equity ?? 0)} USDT</strong></div>
            <div className="metric"><span>Caixa</span><strong>{formatMoney(paper?.cash ?? 0)}</strong></div>
            <div className="metric"><span>Posição</span><strong>{paper?.side === 'long' ? 'comprado' : paper?.side === 'short' ? 'vendido (simulado)' : 'zerado'}</strong></div>
            <div className="metric"><span>Quantidade</span><strong>{paper ? paper.qty.toFixed(6) : '—'}</strong></div>
            <div className="metric"><span>Resultado realizado</span><strong>{formatMoney(paper?.realizedPnl ?? 0)}</strong></div>
            <div className="metric"><span>Taxas</span><strong>{formatMoney(paper?.feesPaid ?? 0)}</strong></div>
            <div className="metric"><span>Trades fechados</span><strong>{paper?.closedTrades ?? 0}</strong></div>
            <div className="metric"><span>Taxa de acerto</span><strong>{paper?.winRate === null || paper?.winRate === undefined ? '—' : `${pct.format(paper.winRate * 100)}%`}</strong></div>
          </div>
          <div className="callout">
            <h2>Trava de risco</h2>
            <p className={paper?.breaker.tripped ? 'bad' : paper?.breaker.inCooldown || paper?.breaker.feedStale ? 'warn' : 'ok'}>
              {paper?.breaker.reason || 'Aguardando o servidor.'}
            </p>
            <p className="muted">Resultado do dia: {pct.format(paper?.breaker.dailyPnlPct ?? 0)}%. Limite: -2%.</p>
            <p className="muted">Perdas seguidas: {paper?.breaker.consecutiveLosses ?? 0} de 3. Depois de 3, pausa de 30 minutos.</p>
            <p className="muted">Feed: {paper?.breaker.feedStale ? 'sem heartbeat recente' : 'heartbeat dentro do limite'}.</p>
          </div>
          <h2>Registro recente</h2>
          <ul className="events">
            {(paper?.recentEvents || []).slice().reverse().slice(0, 8).map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <strong>{event.type}</strong> {event.action ? signalLabel(event.action).toLowerCase() : ''} <span className="muted">{event.reason || event.at}</span>
              </li>
            ))}
            {(paper?.recentEvents || []).length === 0 && <li className="muted">Nenhum evento de paper ainda.</li>}
          </ul>
        </section>
      )}

      {tab === 'aranha' && <AranhaPanel />}

      {tab === 'backtest' && (
        <section className="card">
          <h2>Resultado do backtest</h2>
          {backtestError && <p>{backtestError}</p>}
          {backtest && (
            <>
              <p>{backtest.disclaimer}</p>
              <p className="muted">
                {backtest.sampling?.candleCount} candles, uma decisão a cada {backtest.sampling?.stride} candles,
                contexto {backtest.sampling?.context}, horizonte {backtest.sampling?.horizon}.
                {backtest.sampling?.decisionCount} previsões
                {backtest.runtime ? ` em ${(backtest.runtime.inferenceMs / 1000).toFixed(0)} s.` : '.'}
              </p>
              <div className="metrics">
                <div className="metric"><span>Acurácia direcional</span><strong>{backtest.forecast?.directionalAccuracy === null || backtest.forecast?.directionalAccuracy === undefined ? '—' : `${pct.format(backtest.forecast.directionalAccuracy * 100)}%`}</strong></div>
                <div className="metric"><span>MAE</span><strong>{backtest.forecast?.mae === null || backtest.forecast?.mae === undefined ? '—' : money.format(backtest.forecast.mae)}</strong></div>
                <div className="metric"><span>MAPE</span><strong>{backtest.forecast?.mape === null || backtest.forecast?.mape === undefined ? '—' : `${pct.format(backtest.forecast.mape * 100)}%`}</strong></div>
              </div>
              <table>
                <thead>
                  <tr><th>Estratégia</th><th>Retorno</th><th>Drawdown</th><th>Acerto</th><th>Trades</th><th>Sharpe</th></tr>
                </thead>
                <tbody>
                  {strategies.map(item => item && (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td>{pct.format(item.returnPct)}%</td>
                      <td>{pct.format(item.maxDrawdownPct)}%</td>
                      <td>{item.winRatePct === null ? '—' : `${pct.format(item.winRatePct)}%`}</td>
                      <td>{item.closedTrades}</td>
                      <td>{item.sharpe === null ? '—' : pct.format(item.sharpe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="callout">
                {(backtest.limitations || []).map(line => <p key={line}>{line}</p>)}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
