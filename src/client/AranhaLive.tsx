import { useEffect, useState } from 'react';
import type { CoinView, LiveFeedItem } from '../../server/crawler/live';
import type { CrawlerRow } from '../../server/crawler/types';
import AranhaLiveChart from './AranhaLiveChart';

export interface AranhaLivePayload {
  updatedAt: string;
  disclaimer: string;
  kronosNote: string;
  paperSymbol: string;
  rows: CrawlerRow[];
  feed: LiveFeedItem[];
  charts: Record<string, CoinView>;
}

const price = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function signed(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  const text = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
  return value > 0 ? `+${text}` : text;
}

function clock(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(time);
}

export default function AranhaLive({ payload }: { payload: AranhaLivePayload | null }) {
  const [symbol, setSymbol] = useState<string | null>(null);
  const selected = symbol && payload?.charts[symbol] ? symbol : payload?.rows[0]?.symbol ?? payload?.paperSymbol ?? null;
  const chart = selected ? payload?.charts[selected] : undefined;
  const row = payload?.rows.find(item => item.symbol === selected);
  const feed = chart?.feed ?? [];

  useEffect(() => {
    if (!symbol && payload?.rows[0]) setSymbol(payload.rows[0].symbol);
  }, [payload, symbol]);

  if (!payload) {
    return <section className="card"><h2>Aranha</h2><p className="muted">Conectando o gráfico ao vivo…</p></section>;
  }

  return (
    <div className="aranha-live">
      <section className="card">
        <div className="pills">
          <span className="pill">{selected?.replace('USDT', '') ?? '—'} <strong>{row ? price.format(row.lastPrice) : '—'}</strong></span>
          <span className="pill">24h <strong>{signed(row?.change24hPct ?? null)}%</strong></span>
          <span className="pill">Score <strong>{signed(row?.score ?? null)}</strong></span>
          <span className="pill">Paper <strong>{payload.paperSymbol.replace('USDT', '')}</strong></span>
        </div>
        <p className="muted">{payload.disclaimer}</p>
        <AranhaLiveChart
          candles={chart?.candles ?? []}
          zones={chart?.zones ?? []}
          walls={chart?.walls ?? []}
          annotations={chart?.annotations ?? []}
        />
        <div className="legend">
          <span><i className="swatch price" /> Alta / baixa</span>
          <span>Círculo: baleia, tamanho pelo valor</span>
          <span>Triângulo: estrutura, rompimento ou volume</span>
          <span>Seta clara: paper simulado</span>
          <span>Linha tracejada: parede do livro</span>
        </div>
        <p className="muted">{payload.kronosNote}</p>
      </section>
      <aside className="stack">
        <section className="card">
          <h2>Oportunidades</h2>
          <ul className="rank-list">
            {payload.rows.slice(0, 12).map(item => (
              <li key={item.symbol}>
                <button
                  type="button"
                  className={item.symbol === selected ? 'rank-button on' : 'rank-button'}
                  onClick={() => setSymbol(item.symbol)}
                >
                  <strong>{item.symbol.replace('USDT', '')}</strong>
                  <span>{signed(item.score)}</span>
                </button>
              </li>
            ))}
            {payload.rows.length === 0 && <li className="muted">A primeira varredura ainda está chegando.</li>}
          </ul>
        </section>
        <section className="card">
          <h2>O que a Aranha está vendo agora</h2>
          <ul className="events">
            {feed.slice(0, 8).map(item => (
              <li key={item.id}><span className="muted">{clock(item.time)} </span>{item.text}</li>
            ))}
            {feed.length === 0 && <li className="muted">Nenhuma anotação nova ainda.</li>}
          </ul>
        </section>
      </aside>
    </div>
  );
}
