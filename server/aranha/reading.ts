import type { Bias, ChartReading, PatternContext } from './types';
import { analogBias } from './gates';

function bps(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'sem mediana';
  const digits = value.toFixed(1).replace('.', ',');
  return `${value > 0 ? '+' : ''}${digits} bps`;
}

function pct(value: number | null): string {
  if (value === null) return 'sem taxa';
  return `${Math.round(value * 100)}%`;
}

/** Short pt-BR reading built only from the measured stats. */
export function mechanicalReading(pattern: Pick<PatternContext, 'analogSummary' | 'patterns' | 'regime' | 'regimes'>): ChartReading {
  const summary = pattern.analogSummary;
  const bias = analogBias(summary);
  const caveats: string[] = [];
  const sentences: string[] = [];

  if (summary.count === 0) {
    sentences.push('Ainda não há trechos antigos parecidos, com o resultado já conhecido, para comparar com o gráfico de agora.');
    caveats.push('Sem análogos.');
  } else {
    sentences.push(`O gráfico recente se parece com ${summary.count} trechos antigos. Nesses trechos, cerca de 1 hora depois, o preço subiu em ${pct(summary.hitRateUp)} dos casos e caiu em ${pct(summary.hitRateDown)}. A mediana foi ${bps(summary.medianForwardReturnBps)}.`);
    if (summary.count < 8) caveats.push('Poucos trechos parecidos.');
  }

  const active = pattern.patterns.filter(item => item.activeNow && !item.id.startsWith('regime-'));
  if (active.length === 0) {
    sentences.push('Nenhum padrão clássico de candle está marcado neste fechamento.');
  } else {
    const bits = active.slice(0, 3).map(item => {
      if (item.sampleCount === 0 || item.hitRateUp === null) {
        return `${item.name} sem histórico bastante neste arquivo`;
      }
      const small = item.sampleCount < 20 ? ', amostra pequena' : '';
      return `${item.name}: alta em ${pct(item.hitRateUp)} de ${item.sampleCount} casos no horizonte de ${item.horizonLabel}${small}`;
    });
    sentences.push(`Agora aparece: ${bits.join('; ')}.`);
  }

  const regimes = pattern.regimes.map(item => `${item.timeframe} ${item.label}`).join(', ');
  sentences.push(`Regime: ${regimes || pattern.regime.label}.`);
  sentences.push('Isto é uma leitura mecânica. Não é probabilidade de ganho.');
  if (pattern.patterns.some(item => item.activeNow && item.sampleCount > 0 && item.sampleCount < 20)) {
    caveats.push('Há padrão ativo com amostra pequena.');
  }

  return {
    text: sentences.join(' '),
    bias,
    caveats,
    llmText: null,
    llmBias: null,
    llmMode: 'desligado'
  };
}

export function chartAnalystPrompt(summary: string): { system: string; user: string } {
  return {
    system: [
      'Você lê um gráfico de pesquisa de BTCUSDT. Escreva em português claro, para uma pessoa que não programa.',
      'Use só os números que vierem no resumo. Não invente taxa de acerto, retorno nem notícia.',
      'A leitura mecânica já decidiu o viés. Você explica; não troca o viés para melhorar a história.',
      'Responda apenas um JSON: {"leitura":"2 a 4 frases","vies":"alta|baixa|neutro","ressalvas":["..."]}.',
      'vies deve repetir o viés mecânico informado.'
    ].join(' '),
    user: summary
  };
}

export function compactChartSummary(pattern: PatternContext): string {
  const active = pattern.patterns
    .filter(item => item.activeNow)
    .map(item => `${item.name}: n=${item.sampleCount}, alta=${item.hitRateUp === null ? 'n/d' : item.hitRateUp.toFixed(2)}, mediana=${item.medianForwardReturnBps ?? 'n/d'} bps`)
    .join('\n');
  const last = pattern.recent.slice(-12).map(candle => `${candle.o.toFixed(1)},${candle.h.toFixed(1)},${candle.l.toFixed(1)},${candle.c.toFixed(1)}`);
  return [
    `Viés mecânico: ${pattern.chartReading.bias}.`,
    pattern.chartReading.text,
    `Análogos: ${pattern.analogSummary.count}, mediana ${pattern.analogSummary.medianForwardReturnBps ?? 'n/d'} bps, alta ${pattern.analogSummary.hitRateUp ?? 'n/d'}.`,
    `Padrões ativos:\n${active || 'nenhum'}`,
    `Últimos candles (abertura, máxima, mínima, fechamento):\n${last.join('\n')}`
  ].join('\n');
}

export function parseChartAnalyst(text: string, mechanicalBias: Bias): { text: string; bias: Bias; caveats: string[] } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as { leitura?: unknown; vies?: unknown; ressalvas?: unknown };
  if (typeof record.leitura !== 'string' || !record.leitura.trim()) return null;
  const bias: Bias = record.vies === 'alta' || record.vies === 'baixa' || record.vies === 'neutro'
    ? record.vies
    : mechanicalBias;
  const caveats = Array.isArray(record.ressalvas)
    ? record.ressalvas.filter((item): item is string => typeof item === 'string').slice(0, 4)
    : [];
  if (bias !== mechanicalBias) caveats.push('O modelo sugeriu outro viés; o painel mantém o viés mecânico.');
  return { text: record.leitura.trim(), bias: mechanicalBias, caveats };
}
