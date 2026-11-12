import { useEffect, useState } from 'react';
import type { BookWall, CrawlerRow, CrawlerSnapshot, OnchainEvent, WhalePrint } from '../../server/crawler/types';

interface BacktestVariant {
  id: string;
  label: string;
  horizons: { label: string; decisions: number; topNetPct: number | null; universeNetPct: number | null; excessPct: number | null; topBeatRate: number | null }[];
}

interface CrawlerReport {
  disclaimer?: string;
  variantsTried?: number;
  variants?: BacktestVariant[];
  limitations?: string[];
  error?: string;
}

const num = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return num.format(value);
}

function signed(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '—';
  const text = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  return value > 0 ? `+${text}` : text;
}

function when(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(time);
}

function kronosLabel(row: CrawlerRow): string {
  if (row.kronos === 'rodou' && row.kronosBps !== null) return `${signed(row.kronosBps, 0)} bps`;
  if (row.kronos === 'fila') return 'na fila';
  if (row.kronos === 'indisponivel') return 'sem modelo';
  return 'não entra';
}

export default function CrawlerPanel({ onOpen }: { onOpen: (symbol: string) => void }) {
  const [data, setData] = useState<CrawlerSnapshot | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'ranking' | 'baleias'>('ranking');
  const [report, setReport] = useState<CrawlerReport | null>(null);
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    let stop = false;
    const pull = () => {
      fetch('/api/crawler').then(async response => {
        if (!response.ok) throw new Error('ruim');
        return response.json() as Promise<CrawlerSnapshot>;
      }).then(body => {
        if (!stop) {
          setData(body);
          setError('');
        }
      }).catch(() => {
        if (!stop) setError('O crawler não respondeu. O servidor local está no ar?');
      });
    };
    pull();
    const timer = window.setInterval(pull, 15_000);
    fetch('/api/crawler-backtest').then(async response => {
      const body = await response.json() as CrawlerReport;
      if (!response.ok) setReportError(body.error || 'Estudo ainda não gerado.');
      else setReport(body);
    }).catch(() => setReportError('Não foi possível ler o estudo do crawler.'));
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  if (error) return <section className="card"><h2>Crawler</h2><p>{error}</p></section>;
  if (!data) return <section className="card"><h2>Crawler</h2><p className="muted">Varrendo as moedas…</p></section>;

  return (
    <div className="stack">
      <section className="card">
        <h2>Crawler</h2>
        <p>{data.disclaimer}</p>
        <p className="muted">{data.kronosNote}</p>
        <div className="tabs" role="tablist">
          <button className="tab" type="button" aria-selected={view === 'ranking'} onClick={() => setView('ranking')}>Oportunidades</button>
          <button className="tab" type="button" aria-selected={view === 'baleias'} onClick={() => setView('baleias')}>Baleias</button>
        </div>
        {data.errors.length > 0 && (
          <div className="callout">
            {data.errors.slice(0, 3).map(item => <p key={item} className="muted">{item}</p>)}
          </div>
        )}
      </section>

      {view === 'ranking' && (
        <section className="card">
          <h2>Ranking</h2>
          <p className="muted">{data.universeSize} moedas. Clique numa linha para abrir o gráfico na aba Aranha.</p>
          <table>
            <thead>
              <tr><th>#</th><th>Moeda</th><th>Score</th><th>Motivo</th><th>Preço</th><th>24h</th><th>Tendência</th><th>Kronos</th></tr>
            </thead>
            <tbody>
              {data.rows.map((row, index) => (
                <tr key={row.symbol}>
                  <td>{index + 1}</td>
                  <td><button className="linkish" type="button" onClick={() => onOpen(row.symbol)}>{row.symbol.replace('USDT', '')}</button></td>
                  <td>{signed(row.score, 1)}</td>
                  <td>{row.reason}</td>
                  <td>{money(row.lastPrice)}</td>
                  <td>{signed(row.change24hPct, 2)}%</td>
                  <td>{row.regime}</td>
                  <td>{kronosLabel(row)}</td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={8}>Ainda não há moedas no ranking. A primeira varredura pode levar um minuto.</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {view === 'baleias' && (
        <>
          <WhaleList prints={data.whales} walls={data.walls} />
          <OnchainList events={data.onchain} />
        </>
      )}

      <section className="card">
        <h2>Estudo do ranking</h2>
        {reportError && <p>{reportError}</p>}
        {report?.disclaimer && <p>{report.disclaimer}</p>}
        {report?.variantsTried !== undefined && <p className="muted">Fórmulas comparadas: {report.variantsTried}. Todas ficam na tabela.</p>}
        {report?.variants?.map(variant => (
          <div key={variant.id}>
            <h2>{variant.label}</h2>
            <table>
              <thead>
                <tr><th>Horizonte</th><th>Top 3 líquido</th><th>Universo líquido</th><th>Diferença</th><th>Top 3 ganhou</th></tr>
              </thead>
              <tbody>
                {variant.horizons.map(row => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td>{row.topNetPct === null ? '—' : `${pct.format(row.topNetPct)}%`}</td>
                    <td>{row.universeNetPct === null ? '—' : `${pct.format(row.universeNetPct)}%`}</td>
                    <td>{row.excessPct === null ? '—' : `${pct.format(row.excessPct)} pp`}</td>
                    <td>{row.topBeatRate === null ? '—' : `${pct.format(row.topBeatRate * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <div className="callout">
          {(report?.limitations || []).slice(0, 4).map(line => <p key={line}>{line}</p>)}
        </div>
      </section>
    </div>
  );
}

function WhaleList({ prints, walls }: { prints: WhalePrint[]; walls: BookWall[] }) {
  return (
    <section className="card">
      <h2>Negócios grandes na Binance</h2>
      <p className="muted">Um negócio entra aqui quando passa do valor em dólares configurado. Compra significa que o agressor comprou.</p>
      <ul className="events">
        {prints.map(print => (
          <li key={print.id}>
            <strong>{print.symbol.replace('USDT', '')}</strong> {print.side} {money(print.usd)} USDT
            <span className="muted"> · {when(print.time)} · preço {money(print.price)}</span>
          </li>
        ))}
        {prints.length === 0 && <li className="muted">Nenhum negócio grande desde que esta sessão abriu.</li>}
      </ul>
      <h2>Paredes no livro</h2>
      <ul className="events">
        {walls.map(wall => (
          <li key={`${wall.symbol}-${wall.side}-${wall.price}`}>
            {wall.symbol.replace('USDT', '')}: parede de {wall.side} em {money(wall.price)} ({money(wall.usd)} USDT)
          </li>
        ))}
        {walls.length === 0 && <li className="muted">Nenhuma parede marcada agora.</li>}
      </ul>
    </section>
  );
}

function OnchainList({ events }: { events: OnchainEvent[] }) {
  return (
    <section className="card">
      <h2>Cadeia</h2>
      <p className="muted">Fontes públicas, sem chave. A lista de endereços de corretora é parcial. Isto não tem backtest: passa a ser gravado agora.</p>
      <ul className="events">
        {events.map(event => (
          <li key={event.id}>
            <a href={event.url} target="_blank" rel="noreferrer">{event.asset} · {event.amount}</a>
            <div className="muted">{when(event.time)} · {event.direction}{event.label ? ` · ${event.label}` : ''} · {event.source}</div>
          </li>
        ))}
        {events.length === 0 && <li className="muted">Nenhuma transação grande nesta sessão.</li>}
      </ul>
    </section>
  );
}
