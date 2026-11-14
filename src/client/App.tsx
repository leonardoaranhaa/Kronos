import { useEffect, useState } from 'react';
import PriceChart from './PriceChart';
import { AranhaBrief } from './AranhaPanel';
import type { AranhaLivePayload } from './AranhaLive';
import Desk from './Desk';
import AranhaPanel from './AranhaPanel';
import { CanonicalCandle, TechnicalIndicators } from '../../shared/types';
import type { ResearchSignal } from '../../server/signals';
import { researchSocketUrl } from './socket-url';

type Tab = 'mercado' | 'paper' | 'backtest' | 'aranha' | 'pesquisa';

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
  const [tab, setTab] = useState<Tab>('aranha');
  const [connected, setConnected] = useState(false);
  const [model, setModel] = useState('iniciando');
  const [feed, setFeed] = useState('iniciando');
  const [closes, setCloses] = useState<number[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [forecast, setForecast] = useState<number[]>([]);
  const [bandLow, setBandLow] = useState<number[]>([]);
  const [bandHigh, setBandHigh] = useState<number[]>([]);
  const [pUp, setPUp] = useState<number | null>(null);
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [paper, setPaper] = useState<PaperView | null>(null);
  const [history, setHistory] = useState<HistoryView | null>(null);
  const [backtest, setBacktest] = useState<BacktestView | null>(null);
  const [backtestError, setBacktestError] = useState('');
  const [live, setLive] = useState<AranhaLivePayload | null>(null);
  const [research, setResearch] = useState<{
    summaryPt?: string;
    promoteToPaper?: boolean;
    promotionReasons?: string[];
    tuning?: { tried: number; eligible: number };
    multipleTesting?: { outOfSampleDirectionTests: number; bonferroniAlpha: number };
    directional?: { symbol: string; interval: string; split: string; accuracy: number | null; hits: number; compared: number; pValue: number | null; mae: number | null }[];
    rows?: { symbol: string; interval: string; split: string; strategy: string; returnPct: number; maxDrawdownPct: number; winRatePct: number | null; closedTrades: number; sharpe: number | null }[];
  } | null>(null);
  const [researchError, setResearchError] = useState('');
  const [patchCompare, setPatchCompare] = useState<{
    before?: { accuracy: number; pValue: number; tunedReturnPct: number; buyAndHoldReturnPct: number };
    after?: { accuracy: number | null; pValue: number | null; tunedReturnPct: number; buyAndHoldReturnPct: number; tunedTrades: number };
    reliability?: { pUp: number; count: number; realizedUpRate: number | null }[];
  } | null>(null);

  useEffect(() => {
    const apply = (payload: { indicators?: TechnicalIndicators; forecast?: number[]; paper?: PaperView; history?: HistoryView; candle?: CanonicalCandle | null }) => {
      if (payload.indicators) setIndicators(payload.indicators);
      if (payload.forecast) setForecast(payload.forecast);
      const initialBand = (payload as { quantileBand?: { p10?: number[]; p90?: number[] }; pUp?: number }).quantileBand;
      if (initialBand) {
        setBandLow(Array.isArray(initialBand.p10) ? initialBand.p10 : []);
        setBandHigh(Array.isArray(initialBand.p90) ? initialBand.p90 : []);
      }
      const initialP = (payload as { pUp?: number }).pUp;
      if (typeof initialP === 'number') setPUp(initialP);
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

    fetch('/api/aranha-live').then(response => response.json()).then(body => setLive(body as AranhaLivePayload)).catch(() => undefined);

    fetch('/api/research-m3').then(async response => {
      if (!response.ok) return;
      setPatchCompare(await response.json());
    }).catch(() => undefined);

    fetch('/api/research').then(async response => {
      const body = await response.json();
      if (!response.ok) setResearchError(body.error || 'Pesquisa indisponível.');
      else setResearch(body);
    }).catch(() => setResearchError('Não foi possível ler o relatório de pesquisa.'));

    fetch('/api/backtest').then(async response => {
      const body = await response.json();
      if (!response.ok) setBacktestError(body.error || 'Relatório indisponível.');
      else setBacktest(body);
    }).catch(() => setBacktestError('Não foi possível ler o relatório de backtest.'));

    const socket = new WebSocket(researchSocketUrl(location));
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
        const band = message.payload.quantileBand;
        setBandLow(Array.isArray(band?.p10) ? band.p10 : []);
        setBandHigh(Array.isArray(band?.p90) ? band.p90 : []);
        setPUp(typeof message.payload.pUp === 'number' ? message.payload.pUp : null);
        if (message.payload.signal) {
          setPaper(current => current ? { ...current, signal: message.payload.signal, signalPending: true } : current);
        }
      } else if (message.type === 'KRONOS_MODEL_STATUS') {
        setModel(modelLabel(String(message.payload.status || '')));
      } else if (message.type === 'FEED_STATUS') {
        setFeed(feedLabel(String(message.payload.status || '')));
      } else if (message.type === 'ARANHA_LIVE') {
        setLive(message.payload as AranhaLivePayload);
      }
    };
    return () => socket.close();
  }, []);

  const signal = paper?.signal;
  const strategies = backtest?.strategies
    ? ['kronos', 'buyAndHold', 'persistence', 'random'].map(key => backtest.strategies?.[key]).filter(Boolean)
    : [];

  return (
    <div className={tab === 'aranha' ? 'app app-wide' : 'app'}>
      <div className="banner">
        Pesquisa e simulação. Este programa não envia ordens e não promete lucro.
      </div>
      <header>
        <div>
          <h1>Crypto Crawling</h1>
          <p className="muted">Pesquisa e paper trading. A Aranha lê o gráfico. Nenhuma ordem é enviada.</p>
        </div>
        <div className="pills">
          <span className="pill">Conexão <strong className={connected ? 'ok' : 'bad'}>{connected ? 'ligada' : 'desligada'}</strong></span>
          <span className="pill">Feed <strong className={feed === 'conectado' ? 'ok' : 'warn'}>{feed}</strong></span>
          <span className="pill">Modelo <strong className={model === 'pronto' ? 'ok' : 'warn'}>{model}</strong></span>
        </div>
      </header>

      <div className="tabs" role="tablist">
        {([['aranha', 'Aranha'], ['mercado', 'Mercado'], ['paper', 'Paper'], ['backtest', 'Backtest'], ['pesquisa', 'Pesquisa']] as const).map(([id, label]) => (
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
            <p className="muted">{pUp === null ? 'P(alta) aparece quando há mais de uma amostra.' : `P(alta) das amostras: ${pct.format(pUp * 100)}%.`}</p>
          </section>
          <section className="card">
            <h2>Preço e previsão</h2>
            <div className="signal">{price === null || price === undefined ? '—' : `${money.format(price)} USDT`}</div>
            <PriceChart closes={closes} forecast={forecast} bandLow={bandLow} bandHigh={bandHigh} />
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

      {tab === 'aranha' && <Desk live={live} paper={paper} />}

      {tab === 'pesquisa' && <AranhaPanel />}

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

      {tab === 'pesquisa' && (
        <section className="card">
          <h2>Pesquisa de vantagem</h2>
          {researchError && <p>{researchError}</p>}
          {research && (
            <>
              <p>{research.summaryPt}</p>
              <p className="muted">
                Combinações testadas na amostra: {research.tuning?.tried ?? '—'}.
                Testes de direção fora da amostra: {research.multipleTesting?.outOfSampleDirectionTests ?? '—'}.
                Estratégia opcional: {research.promoteToPaper ? 'disponível em BTCUSDT 1h' : 'não habilitada'}.
              </p>
              <h2>Direção fora da amostra</h2>
              <table>
                <thead>
                  <tr><th>Par</th><th>Intervalo</th><th>Acurácia</th><th>p-valor</th><th>MAE</th></tr>
                </thead>
                <tbody>
                  {(research.directional || []).filter(row => row.split === 'out_of_sample').map(row => (
                    <tr key={`${row.symbol}-${row.interval}-dir`}>
                      <td>{row.symbol}</td>
                      <td>{row.interval}</td>
                      <td>{row.accuracy === null ? '—' : `${pct.format(row.accuracy * 100)}%`}</td>
                      <td>{row.pValue === null ? '—' : row.pValue.toFixed(3)}</td>
                      <td>{row.mae === null ? '—' : money.format(row.mae)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2>Operação fora da amostra</h2>
              <table>
                <thead>
                  <tr><th>Par</th><th>Intervalo</th><th>Estratégia</th><th>Retorno</th><th>Drawdown</th><th>Trades</th><th>Sharpe</th></tr>
                </thead>
                <tbody>
                  {(research.rows || []).filter(row => row.split === 'out_of_sample').slice().sort((a, b) => {
                    const order = ['regra-atual', 'regra-atual-so-compra', 'escolhida-na-amostra', 'comprar-e-segurar', 'ultimo-candle', 'aleatorio'];
                    return a.symbol.localeCompare(b.symbol) || a.interval.localeCompare(b.interval) || order.indexOf(a.strategy) - order.indexOf(b.strategy);
                  }).map(row => (
                    <tr key={`${row.symbol}-${row.interval}-${row.strategy}`}>
                      <td>{row.symbol}</td>
                      <td>{row.interval}</td>
                      <td>{row.strategy}</td>
                      <td>{pct.format(row.returnPct)}%</td>
                      <td>{pct.format(row.maxDrawdownPct)}%</td>
                      <td>{row.closedTrades}</td>
                      <td>{row.sharpe === null ? '—' : pct.format(row.sharpe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="callout">
                {(research.promotionReasons || []).map(line => <p key={line}>{line}</p>)}
              </div>
              {patchCompare?.before && patchCompare.after && (
                <>
                  <h2>Depois do conserto de RoPE</h2>
                  <p>
                    Mesma regra, sem nova busca. Direção {pct.format((patchCompare.before.accuracy ?? 0) * 100)}% (p={patchCompare.before.pValue.toFixed(3)})
                    passou a {pct.format((patchCompare.after.accuracy ?? 0) * 100)}% (p={(patchCompare.after.pValue ?? 0).toFixed(3)}).
                    A regra foi de {pct.format(patchCompare.before.tunedReturnPct)}% para {pct.format(patchCompare.after.tunedReturnPct)}%.
                    Comprar e segurar continuou em {pct.format(patchCompare.after.buyAndHoldReturnPct)}%.
                  </p>
                  <table>
                    <thead><tr><th>P(alta)</th><th>Previsões</th><th>Preço subiu</th></tr></thead>
                    <tbody>
                      {(patchCompare.reliability || []).map(bin => (
                        <tr key={bin.pUp}>
                          <td>{pct.format(bin.pUp * 100)}%</td>
                          <td>{bin.count}</td>
                          <td>{bin.realizedUpRate === null ? '—' : `${pct.format(bin.realizedUpRate * 100)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
