import { useEffect, useMemo, useState } from 'react';
import type { AranhaLivePayload } from './AranhaLive';
import ProChart from './ProChart';
import { depthSteps } from './chart/depth';
import type { NewsItem } from '../../server/aranha/types';

interface DeskPaper {
  equity: number;
  cash: number;
  qty: number;
  side: 'long' | 'short' | 'flat';
  realizedPnl: number;
  feesPaid: number;
  closedTrades: number;
  winRate: number | null;
  equityCurve: { t: number; equity: number }[];
  recentEvents: { at: string; type: string; action?: string; reason?: string }[];
}

interface NewsPayload {
  web?: {
    fearGreed?: { value: number; labelPt: string } | null;
    items?: NewsItem[];
  };
}

const price = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function signed(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'sem dados';
  const text = price.format(value);
  return value > 0 ? `+${text}` : text;
}

function clock(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(time);
}

function sideLabel(side: DeskPaper['side']): string {
  if (side === 'long') return 'comprado';
  if (side === 'short') return 'vendido simulado';
  return 'zerado';
}

export default function Desk({ live, paper }: { live: AranhaLivePayload | null; paper: DeskPaper | null }) {
  const [symbol, setSymbol] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(250);
  const [rightWidth, setRightWidth] = useState(320);
  const [news, setNews] = useState<NewsPayload | null>(null);

  useEffect(() => {
    if (window.innerWidth < 960) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, []);

  useEffect(() => {
    let cancel = false;
    const load = () => {
      fetch('/api/aranha')
        .then(response => response.ok ? response.json() : null)
        .then(body => { if (!cancel && body) setNews(body as NewsPayload); })
        .catch(() => { if (!cancel) setNews(null); });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, []);

  const selected = symbol && (live?.charts[symbol] || live?.rows.some(row => row.symbol === symbol))
    ? symbol
    : live?.rows[0]?.symbol ?? live?.paperSymbol ?? null;
  const chart = selected ? live?.charts[selected] : undefined;
  const row = live?.rows.find(item => item.symbol === selected);
  const queryText = query.trim().toUpperCase();
  const matches = (live?.rows ?? []).filter(item => !queryText || item.symbol.includes(queryText) || item.symbol.replace('USDT', '').includes(queryText));

  const overview = useMemo(() => {
    const rows = (live?.rows ?? []).filter(item => item.change24hPct !== null);
    const btc = rows.find(item => item.symbol === 'BTCUSDT')?.change24hPct ?? null;
    const alts = rows.filter(item => item.symbol !== 'BTCUSDT').map(item => item.change24hPct as number).sort((a, b) => a - b);
    const mid = alts.length ? alts[Math.floor(alts.length / 2)] : null;
    const ranked = [...rows].sort((a, b) => (b.change24hPct ?? 0) - (a.change24hPct ?? 0));
    return {
      btc,
      alts: mid,
      spread: btc !== null && mid !== null ? btc - mid : null,
      gainers: ranked.slice(0, 3),
      losers: ranked.slice(-3).reverse()
    };
  }, [live]);

  function dragWidth(side: 'left' | 'right', event: React.PointerEvent) {
    const startX = event.clientX;
    const start = side === 'left' ? leftWidth : rightWidth;
    const move = (ev: PointerEvent) => {
      const next = side === 'left' ? start + (ev.clientX - startX) : start - (ev.clientX - startX);
      const width = Math.min(460, Math.max(200, next));
      if (side === 'left') setLeftWidth(width);
      else setRightWidth(width);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const book = selected ? live?.books?.[selected] : undefined;
  const bids = book ? depthSteps(book.bids, 'compra') : [];
  const asks = book ? depthSteps(book.asks, 'venda') : [];
  const depthMax = Math.max(1, ...bids.map(step => step.usd), ...asks.map(step => step.usd));
  const tape = (live?.tape ?? []).filter(item => !selected || item.symbol === selected).slice(0, 12);
  const whales = (live?.whales ?? []).filter(item => !selected || item.symbol === selected).slice(0, 8);
  const chain = (live?.onchain ?? []).filter(item => !selected || selected.startsWith(item.asset)).slice(0, 8);
  const fear = news?.web?.fearGreed ?? null;
  const headlines = news?.web?.items ?? [];

  return (
    <div className="desk-wrap">
      <div className="statbar">
        <strong>{selected ? selected.replace('USDT', '') : 'sem dados'}</strong>
        <span>Preço <b>{row ? price.format(row.lastPrice) : 'sem dados'}</b></span>
        <span>24h <b>{row?.change24hPct === null || row?.change24hPct === undefined ? 'sem dados' : `${signed(row.change24hPct)}%`}</b></span>
        <span>Máxima <b>{row?.high24h ? price.format(row.high24h) : 'sem dados'}</b></span>
        <span>Mínima <b>{row?.low24h ? price.format(row.low24h) : 'sem dados'}</b></span>
        <span>Volume <b>{row?.quoteVolume24h ? compact.format(row.quoteVolume24h) : 'sem dados'}</b></span>
        <span>Score <b>{row ? signed(row.score) : 'sem dados'}</b></span>
        <span className="muted">{live?.disclaimer}</span>
      </div>
    <div
      className="desk"
      style={{
        gridTemplateColumns: `${leftOpen ? `${leftWidth}px` : '0px'} 8px minmax(0, 1fr) 8px ${rightOpen ? `${rightWidth}px` : '0px'}`
      }}
    >
      <aside className={leftOpen ? 'desk-side' : 'desk-side shut'}>
        <section className="card">
          <h2>Universo</h2>
          <input
            className="search"
            value={query}
            placeholder="Buscar moeda"
            aria-label="Buscar moeda"
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && matches[0]) setSymbol(matches[0].symbol);
            }}
          />
          <ul className="rank-list">
            {matches.slice(0, 40).map(item => (
              <li key={item.symbol}>
                <button type="button" className={item.symbol === selected ? 'rank-button on' : 'rank-button'} onClick={() => setSymbol(item.symbol)}>
                  <strong>{item.symbol.replace('USDT', '')}</strong>
                  <span>{signed(item.score)}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="muted">sem dados</li>}
          </ul>
        </section>
      </aside>
      <div className="gutter" role="separator" aria-orientation="vertical" onPointerDown={event => dragWidth('left', event)} />
      <section className="card desk-chart">
        <div className="desk-toggle">
          <button type="button" className="tool" onClick={() => setLeftOpen(value => !value)}>{leftOpen ? 'Ocultar ranking' : 'Mostrar ranking'}</button>
          <button type="button" className="tool" onClick={() => setRightOpen(value => !value)}>{rightOpen ? 'Ocultar painéis' : 'Mostrar painéis'}</button>
        </div>
        {selected ? (
          <ProChart
            symbol={selected}
            annotations={chart?.annotations ?? []}
            zones={chart?.zones ?? []}
            walls={chart?.walls ?? []}
            forecastBps={live?.forecastBps?.[selected] ?? null}
          />
        ) : <p className="muted">sem dados</p>}
      </section>
      <div className="gutter" role="separator" aria-orientation="vertical" onPointerDown={event => dragWidth('right', event)} />
      <aside className={rightOpen ? 'desk-side stack' : 'desk-side shut'}>
        <section className="card">
          <h2>Mercado</h2>
          {overview.btc === null ? <p className="muted">sem dados</p> : (
            <>
              <p>BTC {signed(overview.btc)}% nas 24h. Mediana das outras: {signed(overview.alts)}%. Diferença {signed(overview.spread)} pontos. Isto é um proxy, não dominância de mercado.</p>
              <p>Medo e ganância: {fear ? `${fear.value} · ${fear.labelPt}` : 'sem dados'}</p>
              <h2>Maiores altas</h2>
              {overview.gainers.length === 0 && <p className="muted">sem dados</p>}
              <ul className="events">
                {overview.gainers.map(item => <li key={item.symbol}>{item.symbol.replace('USDT', '')} {signed(item.change24hPct)}%</li>)}
              </ul>
              <h2>Maiores baixas</h2>
              <ul className="events">
                {overview.losers.map(item => <li key={item.symbol}>{item.symbol.replace('USDT', '')} {signed(item.change24hPct)}%</li>)}
              </ul>
            </>
          )}
        </section>
        <section className="card">
          <h2>Baleias e cadeia</h2>
          {whales.length === 0 && chain.length === 0 && <p className="muted">sem dados</p>}
          <ul className="events">
            {whales.map(item => <li key={item.id}><span className="muted">{clock(item.time)} </span>{item.symbol.replace('USDT', '')} {item.side} {compact.format(item.usd)}</li>)}
            {chain.map(item => <li key={item.id}><span className="muted">{clock(item.time)} </span>{item.asset} {item.direction} {item.amount}</li>)}
          </ul>
        </section>
        <section className="card">
          <h2>Livro</h2>
          {bids.length === 0 && asks.length === 0 ? <p className="muted">sem dados</p> : (
            <svg className="depth" viewBox="0 0 280 80" role="img" aria-label="Profundidade do livro">
              {bids.map((step, index) => {
                const x = 140 - ((index + 1) / Math.max(bids.length, 1)) * 130;
                const h = (step.usd / depthMax) * 70;
                return <rect key={`b${step.price}`} x={x} y={75 - h} width={130 / Math.max(bids.length, 1)} height={h} fill="#26a69a" opacity="0.8" />;
              })}
              {asks.map((step, index) => {
                const x = 140 + (index / Math.max(asks.length, 1)) * 130;
                const h = (step.usd / depthMax) * 70;
                return <rect key={`a${step.price}`} x={x} y={75 - h} width={130 / Math.max(asks.length, 1)} height={h} fill="#ef5350" opacity="0.8" />;
              })}
            </svg>
          )}
        </section>
        <section className="card">
          <h2>Negócios</h2>
          {tape.length === 0 ? <p className="muted">sem dados</p> : (
            <ul className="events">
              {tape.map((item, index) => (
                <li key={`${item.time}-${item.price}-${index}`}><span className={item.side === 'compra' ? 'ok' : 'bad'}>{item.side}</span> {price.format(item.price)} · {compact.format(item.usd)}</li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Paper</h2>
          {!paper ? <p className="muted">sem dados</p> : (
            <>
              <p>{sideLabel(paper.side)} · quantidade {paper.qty ? paper.qty.toLocaleString('pt-BR', { maximumFractionDigits: 6 }) : '0'}</p>
              <p>Patrimônio {price.format(paper.equity)} · caixa {price.format(paper.cash)}</p>
              <p>Resultado {price.format(paper.realizedPnl)} · taxas {price.format(paper.feesPaid)} · fechados {paper.closedTrades}</p>
              <p>Acerto {paper.winRate === null ? 'sem dados' : `${price.format(paper.winRate * 100)}%`}</p>
              {paper.equityCurve.length < 2 ? <p className="muted">sem dados da curva</p> : <Equity points={paper.equityCurve} />}
              <ul className="events">
                {paper.recentEvents.slice().reverse().slice(0, 6).map((event, index) => (
                  <li key={`${event.at}-${index}`}>{event.type} {event.action || ''} <span className="muted">{event.reason || clock(event.at)}</span></li>
                ))}
                {paper.recentEvents.length === 0 && <li className="muted">sem dados</li>}
              </ul>
            </>
          )}
        </section>
        <section className="card">
          <h2>O que a Aranha está vendo</h2>
          <ul className="events">
            {(chart?.feed ?? live?.feed ?? []).slice(0, 8).map((item, index) => <li key={`${item.id}-${index}`}><span className="muted">{clock(item.time)} </span>{item.text}</li>)}
            {(chart?.feed ?? live?.feed ?? []).length === 0 && <li className="muted">sem dados</li>}
          </ul>
        </section>
        <section className="card">
          <h2>Notícias</h2>
          {headlines.length === 0 ? <p className="muted">sem dados</p> : (
            <ul className="events">
              {headlines.slice(0, 6).map(item => (
                <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> <span className="muted">{item.source}</span></li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
    </div>
  );
}

function Equity({ points }: { points: { t: number; equity: number }[] }) {
  const min = Math.min(...points.map(point => point.equity));
  const max = Math.max(...points.map(point => point.equity));
  const span = max - min || 1;
  const path = points.map((point, index) => {
    const x = (index / (points.length - 1)) * 280;
    const y = 46 - ((point.equity - min) / span) * 36;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return <svg className="equity-line" viewBox="0 0 280 52" role="img" aria-label="Curva de patrimônio simulado"><path d={path} fill="none" stroke="#38bdf8" strokeWidth="2" /></svg>;
}
