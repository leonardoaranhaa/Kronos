import { useEffect, useState } from 'react';
import type { AranhaContext, NewsItem, PatternHit } from '../../server/aranha/types';
import AranhaChart from './AranhaChart';

interface StrategyRow {
  label: string;
  returnPct: number;
  maxDrawdownPct: number;
  winRatePct: number | null;
  closedTrades: number;
  sharpe: number | null;
}

interface AranhaBacktest {
  disclaimer?: string;
  analogForecast?: {
    directionalAccuracy: number | null;
    directionalSamples: number;
    directionalHits: number;
    maeBps: number | null;
  };
  filter?: { skippedByAnalogFilter: number; decisions: number };
  strategies?: Record<string, StrategyRow>;
  limitations?: string[];
  error?: string;
}

const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const price = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function bps(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  const text = pct.format(value);
  return `${value > 0 ? '+' : ''}${text} bps`;
}

function rate(value: number | null, samples: number): string {
  if (value === null || samples === 0) return 'sem casos';
  return `${pct.format(value * 100)}% de ${samples}`;
}

function when(value: number | string | null): string {
  if (value === null) return '—';
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (Number.isNaN(time)) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(time);
}

function llmLabel(context: AranhaContext): string {
  if (context.web.llm === 'anthropic' || context.pattern.chartReading.llmMode === 'anthropic') return 'Claude ligado';
  if (context.web.llm === 'openai' || context.pattern.chartReading.llmMode === 'openai') return 'modelo OpenAI ligado';
  return 'LLM desligado';
}

function Spark({ past, future }: { past: number[]; future: number[] }) {
  const width = 128;
  const height = 36;
  const steps = Math.max(1, past.length - 1 + Math.max(0, future.length - 1));
  const line = (values: number[], offset: number) => values.map((value, index) => {
    const x = ((offset + index) / steps) * (width - 4) + 2;
    const y = height - 3 - value * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <polyline points={line(past, 0)} fill="none" stroke="#38bdf8" strokeWidth="1.6" />
      {future.length > 1 && <polyline points={line(future, past.length - 1)} fill="none" stroke="#fbbf24" strokeWidth="1.6" />}
    </svg>
  );
}

function patternRows(patterns: PatternHit[]): PatternHit[] {
  const active = patterns.filter(pattern => pattern.activeNow);
  const seasoned = patterns
    .filter(pattern => !pattern.activeNow && pattern.sampleCount >= 5)
    .sort((a, b) => b.sampleCount - a.sampleCount)
    .slice(0, 8);
  const seen = new Set<string>();
  const rows: PatternHit[] = [];
  for (const pattern of [...active, ...seasoned]) {
    const key = `${pattern.timeframe}:${pattern.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(pattern);
  }
  return rows;
}

export function AranhaBrief() {
  const [data, setData] = useState<AranhaContext | null>(null);
  useEffect(() => {
    let stop = false;
    const pull = () => {
      fetch('/api/aranha').then(response => response.json()).then(body => {
        if (!stop) setData(body as AranhaContext);
      }).catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 15_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);
  if (!data) return <p className="muted">Aranha: lendo o gráfico…</p>;
  const summary = data.pattern.analogSummary;
  const hit = summary.count === 0 ? 'ainda sem trechos parecidos' : `alta em ${summary.hitRateUp === null ? '—' : `${Math.round(summary.hitRateUp * 100)}%`} dos ${summary.count} trechos`;
  return <p className="muted">Aranha: viés {data.verdict.bias}. {hit}. {llmLabel(data)}.</p>;
}

function NewsRow({ item }: { item: NewsItem }) {
  return (
    <li>
      <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
      <div className="muted">
        {item.source} · {when(item.publishedAt)} · {item.method === 'llm' ? 'tom do modelo' : 'lista de palavras'}
        {item.sentiment === null ? ' · sem tom' : ` · tom ${item.sentiment > 0 ? '+' : ''}${pct.format(item.sentiment)}`}
        {' · '}{item.eventType}
      </div>
      <div>{item.summary}</div>
    </li>
  );
}

export default function AranhaPanel() {
  const [data, setData] = useState<AranhaContext | null>(null);
  const [error, setError] = useState('');
  const [backtest, setBacktest] = useState<AranhaBacktest | null>(null);
  const [backtestError, setBacktestError] = useState('');

  useEffect(() => {
    let stop = false;
    const pull = () => {
      fetch('/api/aranha').then(async response => {
        if (!response.ok) throw new Error('resposta ruim');
        return response.json() as Promise<AranhaContext>;
      }).then(body => {
        if (!stop) {
          setData(body);
          setError('');
        }
      }).catch(() => {
        if (!stop) setError('Não foi possível ler a Aranha. O servidor local está no ar?');
      });
    };
    pull();
    const timer = window.setInterval(pull, 15_000);
    fetch('/api/aranha-backtest').then(async response => {
      const body = await response.json() as AranhaBacktest;
      if (!response.ok) setBacktestError(body.error || 'Backtest da Aranha ainda não foi gerado.');
      else setBacktest(body);
    }).catch(() => setBacktestError('Não foi possível ler o backtest da Aranha.'));
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  if (error) return <section className="card"><h2>Aranha</h2><p>{error}</p></section>;
  if (!data) return <section className="card"><h2>Aranha</h2><p className="muted">Lendo o gráfico…</p></section>;

  const pattern = data.pattern;
  const rows = patternRows(pattern.patterns);
  const strategies = backtest?.strategies
    ? ['analogs', 'structures', 'persistenceFiltered', 'persistence', 'buyAndHold', 'random'].map(key => backtest.strategies?.[key]).filter(Boolean)
    : [];
  const on = llmLabel(data) !== 'LLM desligado';

  return (
    <div className="stack">
      <section className="card">
        <div className="pills">
          <span className="pill">Veredito <strong className={data.verdict.bias === 'alta' ? 'ok' : data.verdict.bias === 'baixa' ? 'bad' : 'warn'}>{data.verdict.bias}</strong></span>
          <span className="pill">Modelo <strong className={on ? 'ok' : 'warn'}>{llmLabel(data)}</strong></span>
          <span className="pill">Filtro <strong>{data.filterEnabled ? 'ligado' : 'desligado'}</strong></span>
        </div>
        <p>{data.verdict.note}</p>
        <p className="muted">{pattern.chartReading.text}</p>
        {pattern.chartReading.llmText && (
          <div className="callout">
            <h2>Leitura do modelo</h2>
            <p>{pattern.chartReading.llmText}</p>
            <p className="muted">Comentário do modelo. Os números acima são da conta mecânica.</p>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Gráfico</h2>
        <p className="muted">
          Faixa verde: suporte. Faixa vermelha: resistência. O triângulo marca um padrão no último candle.
          Regime: {pattern.regimes.map(item => `${item.timeframe} ${item.label}`).join(' · ')}.
        </p>
        <AranhaChart candles={pattern.recent} zones={pattern.zones} markers={pattern.markers} />
        <div className="legend">
          {pattern.markers.length === 0 && <span>Nenhum padrão clássico no último candle.</span>}
          {pattern.markers.map(marker => <span key={marker.label}>{marker.label}</span>)}
        </div>
        {pattern.zones.length > 0 && (
          <div className="metrics">
            {pattern.zones.slice(0, 4).map(zone => (
              <div className="metric" key={`${zone.timeframe}-${zone.kind}-${zone.low}`}>
                <span>{zone.kind === 'support' ? 'Suporte' : 'Resistência'} {zone.timeframe}</span>
                <strong>{price.format(zone.low)}–{price.format(zone.high)}</strong>
                <span>{zone.touches} toques</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Padrões e o que veio depois</h2>
        <p className="muted">A taxa é do passado já conhecido neste instante. Amostra pequena não vira certeza.</p>
        <table>
          <thead>
            <tr><th>Padrão</th><th>Agora</th><th>Alta</th><th>Mediana</th><th>Horizonte</th></tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={`${row.timeframe}-${row.id}`}>
                <td>{row.name}{row.sampleCount > 0 && row.sampleCount < 20 ? ' · amostra pequena' : ''}</td>
                <td>{row.activeNow ? 'sim' : 'não'}</td>
                <td>{rate(row.hitRateUp, row.sampleCount)}</td>
                <td>{bps(row.medianForwardReturnBps)}</td>
                <td>{row.horizonLabel}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5}>Nenhum padrão com histórico neste arquivo.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Trechos parecidos</h2>
        <p className="muted">{pattern.note}</p>
        <div className="metrics">
          <div className="metric"><span>Trechos</span><strong>{pattern.analogSummary.count}</strong></div>
          <div className="metric"><span>Alta depois</span><strong>{pattern.analogSummary.hitRateUp === null ? '—' : `${pct.format(pattern.analogSummary.hitRateUp * 100)}%`}</strong></div>
          <div className="metric"><span>Baixa depois</span><strong>{pattern.analogSummary.hitRateDown === null ? '—' : `${pct.format(pattern.analogSummary.hitRateDown * 100)}%`}</strong></div>
          <div className="metric"><span>Mediana</span><strong>{bps(pattern.analogSummary.medianForwardReturnBps)}</strong></div>
        </div>
        <table>
          <thead>
            <tr><th>Quando terminou</th><th>Distância</th><th>Depois</th><th>Desenho</th></tr>
          </thead>
          <tbody>
            {pattern.analogs.map(analog => (
              <tr key={analog.endOpenTime}>
                <td>{when(analog.endOpenTime)}</td>
                <td>{pct.format(analog.distance)}</td>
                <td>{analog.direction === 'up' ? 'subiu' : analog.direction === 'down' ? 'caiu' : 'empatou'} {bps(analog.forwardReturnBps)}</td>
                <td><Spark past={analog.spark} future={analog.forward} /></td>
              </tr>
            ))}
            {pattern.analogs.length === 0 && <tr><td colSpan={4}>Ainda não há trechos antigos suficientes.</td></tr>}
          </tbody>
        </table>
        <p className="muted">Linha azul: o trecho parecido. Linha amarela: o que veio depois, cerca de 1 hora.</p>
      </section>

      <section className="card">
        <h2>Web, em apoio</h2>
        <p>{data.web.note}</p>
        <div className="metrics">
          <div className="metric">
            <span>Fear &amp; Greed</span>
            <strong>{data.web.fearGreed ? data.web.fearGreed.value : '—'}</strong>
            <span>{data.web.fearGreed ? data.web.fearGreed.labelPt : 'sem leitura'}</span>
          </div>
          <div className="metric">
            <span>Tom das notícias</span>
            <strong>{data.web.sentiment === null ? 'sem tom' : pct.format(data.web.sentiment)}</strong>
            <span>
              {data.web.sentiment === null
                ? 'sem palavra reconhecida'
                : `${data.web.items.filter(item => item.sentiment !== null).length} de ${data.web.items.length} manchetes`}
              {' · '}
              {data.web.webSearch === 'usado' ? 'busca do modelo usada' : data.web.webSearch === 'indisponível' ? 'busca indisponível' : 'sem busca'}
            </span>
          </div>
        </div>
        <ul className="events">
          {data.web.items.map(item => <NewsRow key={item.id} item={item} />)}
          {data.web.items.length === 0 && <li className="muted">Nenhuma notícia coletada nesta sessão.</li>}
        </ul>
        {data.web.citations.length > 0 && (
          <>
            <h2>Fontes citadas pelo modelo</h2>
            <ul className="events">
              {data.web.citations.map(citation => (
                <li key={citation.url}>
                  <a href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>
                  {citation.citedText && <div className="muted">{citation.citedText}</div>}
                </li>
              ))}
            </ul>
          </>
        )}
        {data.web.errors.length > 0 && (
          <div className="callout">
            {data.web.errors.slice(0, 4).map(item => <p key={item} className="muted">{item}</p>)}
          </div>
        )}
        <p className="muted">Esta parte não tem backtest. Cada coleta fica gravada em data/aranha/snapshots para avaliar depois, quando houver histórico de verdade.</p>
      </section>

      <section className="card">
        <h2>Backtest do gráfico</h2>
        {backtestError && <p>{backtestError}</p>}
        {backtest && (
          <>
            <p>{backtest.disclaimer}</p>
            <p className="muted">
              Direção da mediana dos trechos parecidos: {backtest.analogForecast?.directionalAccuracy === null || backtest.analogForecast?.directionalAccuracy === undefined ? '—' : `${pct.format(backtest.analogForecast.directionalAccuracy * 100)}%`}
              {backtest.analogForecast ? ` (${backtest.analogForecast.directionalHits}/${backtest.analogForecast.directionalSamples})` : ''}.
              Erro médio: {backtest.analogForecast?.maeBps === null || backtest.analogForecast?.maeBps === undefined ? '—' : `${pct.format(backtest.analogForecast.maeBps)} bps`}.
              O filtro de análogos segurou {backtest.filter?.skippedByAnalogFilter ?? 0} decisões.
            </p>
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
              {(backtest.limitations || []).slice(0, 4).map(line => <p key={line}>{line}</p>)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
