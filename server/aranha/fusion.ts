import type { ResearchSignal } from '../signals';
import { analogsDisagree, sentimentDisagrees } from './gates';
import type { AranhaContext, AranhaVerdict, Bias, PatternContext, WebContext } from './types';

export function webBiasOf(sentiment: number | null): Bias {
  if (sentiment === null || !Number.isFinite(sentiment)) return 'neutro';
  if (sentiment >= 0.2) return 'alta';
  if (sentiment <= -0.2) return 'baixa';
  return 'neutro';
}

/**
 * Optional filter. Off by default, so the Kronos signal stays as it is.
 * A long is skipped only when the analogs AND the news tone both disagree.
 * Missing news tone does not count as disagreement.
 */
export function applyAranhaFilter(
  signal: ResearchSignal,
  context: Pick<AranhaContext, 'pattern' | 'web'>,
  enabled: boolean
): ResearchSignal {
  if (!enabled || signal.action === 'HOLD') return signal;
  const side = signal.action;
  if (!analogsDisagree(context.pattern.analogSummary, side) || !sentimentDisagrees(context.web.sentiment, side)) {
    return signal;
  }
  const held = side === 'BUY' ? 'compra' : 'venda';
  return {
    ...signal,
    action: 'HOLD',
    heuristicScore: 0,
    reason: `${signal.reason} Filtro da Aranha segurou a ${held}: os trechos parecidos e o tom das notícias discordam forte.`
  };
}

export function fuse(
  pattern: PatternContext,
  web: WebContext,
  signal: ResearchSignal | null,
  filterEnabled: boolean
): AranhaContext {
  const chartBias = pattern.chartReading.bias;
  const webBias = webBiasOf(web.sentiment);
  let note = 'O veredito segue a leitura do gráfico.';
  if (chartBias !== 'neutro' && webBias === chartBias) note = 'O gráfico e as notícias apontam o mesmo lado.';
  else if (chartBias !== 'neutro' && webBias !== 'neutro') {
    note = 'As notícias divergem do gráfico. O veredito continua sendo o do gráfico.';
  } else if (chartBias === 'neutro' && webBias !== 'neutro') {
    note = 'As notícias têm um lado, mas o gráfico não confirmou. O veredito fica neutro.';
  }
  if (!filterEnabled) note += ' O filtro está desligado: o sinal do Kronos não muda.';
  const agrees = chartBias === 'neutro' || webBias === 'neutro' ? null : chartBias === webBias;
  const verdict: AranhaVerdict = { bias: chartBias, note, chartBias, webBias, agrees };
  const context: AranhaContext = {
    asOf: web.asOf,
    symbol: pattern.symbol,
    pattern,
    web,
    verdict,
    filterEnabled,
    signal,
    usedSignal: signal
  };
  if (signal) context.usedSignal = applyAranhaFilter(signal, context, filterEnabled);
  if (signal && context.usedSignal && signal.action !== context.usedSignal.action) {
    context.verdict = { ...verdict, note: `${note} O filtro segurou a operação.` };
  }
  return context;
}
