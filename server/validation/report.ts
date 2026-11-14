import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrategyEvaluation } from './evaluate';
import { decideVerdict, VERDICT_RULES, VerdictLabel } from './protocol';
import { restateDeflatedSharpe } from './sharpe';
import { recordedSharpes, trialCount, TrialEntry } from './trials';

export interface ValidationDataset {
  symbol: string;
  interval: string;
  candles: number;
  firstOpenTime: number | null;
  lastOpenTime: number | null;
  sha256: string | null;
  source: string;
}

export interface ValidationStrategy {
  id: string;
  family: string;
  name: string;
  verdict: VerdictLabel;
  reason: string;
  note: string;
  metrics: StrategyEvaluation['metrics'] | null;
}

export interface ValidationReport {
  generatedAt: string;
  disclaimer: string;
  gates: {
    minIndependentDecisions: number;
    deflatedSharpeMin: number;
    maxProbabilityOfOverfit: number;
    directionalAlpha: number;
  };
  trialLog: string;
  trialsByFamily: Record<string, number>;
  datasets: ValidationDataset[];
  strategies: ValidationStrategy[];
  notes: string[];
}

function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/d';
  return value.toFixed(digits);
}

function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/d';
  return `${value.toFixed(digits)}%`;
}

export function renderValidationMarkdown(report: ValidationReport): string {
  const lines = [
    '# Validação offline',
    '',
    report.disclaimer,
    '',
    `Gerado em ${report.generatedAt}. O registro de tentativas está em \`${report.trialLog}\`.`,
    '',
    '## Regra do veredito',
    '',
    ...VERDICT_RULES.flatMap(rule => [rule, '']),
    'O comando `npm run validate` mede Aranha e crawler. Para o Kronos, numa máquina com o worker Python e os pesos:',
    '',
    '```bash',
    'npm run validate -- --strategy kronos-m2',
    'npm run validate -- --strategy kronos-m3',
    'npm run validate -- --strategy kronos-rule',
    '```',
    '',
    'Cada um baixa BTCUSDT 1h, grava o cache de previsões e substitui só essa linha do relatório.',
    '',
    '## Vereditos',
    '',
    '| Estratégia | Veredito | Excesso no teste | Sharpe | DSR | PBO | Acerto | IC |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'
  ];
  for (const strategy of report.strategies) {
    const metrics = strategy.metrics;
    const accuracy = metrics?.directionalAccuracy === null || metrics?.directionalAccuracy === undefined
      ? 'n/d'
      : `${(metrics.directionalAccuracy * 100).toFixed(2)}% (${metrics.directionalHits}/${metrics.directionalCompared})`;
    lines.push(`| ${strategy.name} | ${strategy.verdict} | ${pct(metrics?.excessReturnPct)} | ${num(metrics?.sharpe)} | ${num(metrics?.deflatedSharpeRatio, 3)} | ${num(metrics?.probabilityOfBacktestOverfitting, 3)} | ${accuracy} | ${num(metrics?.informationCoefficient, 3)} |`);
  }
  lines.push('', '## Por estratégia', '');
  for (const strategy of report.strategies) {
    const metrics = strategy.metrics;
    lines.push(`### ${strategy.name}`, '', `**${strategy.verdict}.** ${strategy.reason}`, '', strategy.note, '');
    if (!metrics) {
      lines.push('Nenhum número novo foi calculado nesta corrida.', '');
      continue;
    }
    lines.push(
      `- Retorno no teste: ${pct(metrics.strategyReturnPct)}. Comprar e segurar: ${pct(metrics.buyAndHoldReturnPct)}. Excesso: ${pct(metrics.excessReturnPct)}. Excesso no treino do walk-forward: ${pct(metrics.trainExcessReturnPct)}.`,
      `- Sharpe anualizado: ${num(metrics.sharpe)}. Sharpe por período: ${num(metrics.sharpePerPeriod, 4)}. Sharpe deflacionado: ${num(metrics.deflatedSharpeRatio, 3)} (referência ${num(metrics.deflatedSharpeBenchmark, 4)}, ${metrics.deflatedSharpeTrials ?? 'n/d'} tentativas, dispersão: ${metrics.deflatedSharpeDispersion ?? 'n/d'}).`,
      `- PBO por CSCV: ${num(metrics.probabilityOfBacktestOverfitting, 3)} em ${metrics.pboSplits ?? 0} divisões.`,
      `- Acerto direcional: ${metrics.directionalAccuracy === null ? 'n/d' : `${(metrics.directionalAccuracy * 100).toFixed(2)}%`} em ${metrics.directionalCompared ?? 0} decisões, ${metrics.independentCompared ?? 0} sem sobreposição. p-valor ${num(metrics.directionPValue, 4)} (${metrics.directionMethod ?? 'n/d'}).`,
      `- IC: ${num(metrics.informationCoefficient, 3)} (p=${num(metrics.informationCoefficientPValue, 4)}, n=${metrics.informationCoefficientObservations ?? 0}).`,
      `- Brier: ${num(metrics.brier, 4)}. Brier da taxa-base: ${num(metrics.climatologyBrier, 4)}.`,
      `- Walk-forward: ${metrics.walkForwardFolds ?? 0} blocos de teste. CPCV com purga e embargo: ${metrics.cpcvFolds ?? 0} divisões, mediana do Sharpe por período ${num(metrics.cpcvMedianSharpe, 4)}.`,
      `- Observações de retorno no teste: ${metrics.observations ?? 0}.`,
      ''
    );
    const bins = metrics.reliability.filter(bin => bin.count > 0);
    if (bins.length) {
      lines.push('| P(alta) de | até | previsões | média prevista | frequência realizada |', '| --- | --- | --- | --- | --- |');
      for (const bin of bins) {
        lines.push(`| ${pct(bin.binLow * 100, 0)} | ${pct(bin.binHigh * 100, 0)} | ${bin.count} | ${pct((bin.meanPredicted ?? 0) * 100)} | ${bin.realizedUpRate === null ? 'n/d' : pct(bin.realizedUpRate * 100)} |`);
      }
      lines.push('');
    }
  }
  lines.push('## Dados', '');
  for (const dataset of report.datasets) {
    const first = dataset.firstOpenTime === null ? 'n/d' : new Date(dataset.firstOpenTime).toISOString();
    const last = dataset.lastOpenTime === null ? 'n/d' : new Date(dataset.lastOpenTime).toISOString();
    lines.push(`- ${dataset.symbol} ${dataset.interval}: ${dataset.candles} candles, ${first} a ${last}. SHA-256 ${dataset.sha256 ?? 'n/d'}. Fonte: ${dataset.source}.`);
  }
  lines.push('', '## Tentativas registradas', '');
  for (const [family, count] of Object.entries(report.trialsByFamily)) {
    lines.push(`- ${family}: ${count}`);
  }
  lines.push('', '## Notas', '');
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push('');
  return lines.join('\n');
}

export function kronosDispersionNote(strategies: readonly { family: string; metrics: { deflatedSharpeRatio: number | null } | null }[]): string {
  const measured = strategies.some(strategy => strategy.family === 'kronos' && strategy.metrics?.deflatedSharpeRatio != null);
  if (measured) {
    return 'O DSR do Kronos usa o desvio-padrão dos Sharpes gravados no registro, um por tentativa medida. A grade M2 soma 108 na contagem; aquelas combinações não têm Sharpe individual no arquivo antigo.';
  }
  return 'A grade do Kronos M2 está no registro como 108 tentativas sem Sharpe individual. Sem pelo menos dois Sharpes gravados, a dispersão do DSR dessa família cai no erro-padrão.';
}

export function readValidationReport(filePath = join('reports', 'validation-latest.json')): ValidationReport | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as ValidationReport;
  } catch {
    return null;
  }
}

/** Replace one strategy row. The old id `kronos-regra-atual` is the same row as `kronos-rule`. */
export function replaceStrategy(report: ValidationReport, strategy: ValidationStrategy): ValidationReport {
  const retired = strategy.id === 'kronos-rule' ? 'kronos-regra-atual' : '';
  const strategies: ValidationStrategy[] = [];
  let placed = false;
  for (const row of report.strategies) {
    if (row.id === retired) continue;
    if (row.id === strategy.id) {
      strategies.push(strategy);
      placed = true;
    } else {
      strategies.push(row);
    }
  }
  if (!placed) {
    const firstOther = strategies.findIndex(row => row.family !== strategy.family);
    strategies.splice(firstOther < 0 ? strategies.length : firstOther, 0, strategy);
  }
  return { ...report, generatedAt: new Date().toISOString(), strategies };
}

/**
 * Replace only the deflated Sharpe fields, using the standard deviation of the
 * Sharpes stored one per attempt. Returns, accuracy, IC, PBO and Brier stay.
 */
export function applyStoredTrialDispersion(report: ValidationReport, trials: readonly TrialEntry[]): ValidationReport {
  const strategies = report.strategies.map(strategy => {
    const metrics = strategy.metrics;
    if (!metrics || metrics.deflatedSharpeDispersion !== 'erro-padrao') return strategy;
    if (metrics.sharpePerPeriod === null || metrics.deflatedSharpeRatio === null || metrics.deflatedSharpeBenchmark === null || metrics.observations === null) {
      return strategy;
    }
    const restated = restateDeflatedSharpe({
      observed: metrics.sharpePerPeriod,
      observations: metrics.observations,
      previousBenchmark: metrics.deflatedSharpeBenchmark,
      previousProbability: metrics.deflatedSharpeRatio,
      trials: Math.max(trialCount(trials, strategy.family), metrics.deflatedSharpeTrials ?? 0),
      recordedSharpes: recordedSharpes(trials, strategy.family)
    });
    if (!restated || restated.value === null || restated.benchmark === null) return strategy;
    const nextMetrics = {
      ...metrics,
      deflatedSharpeRatio: restated.value,
      deflatedSharpeBenchmark: restated.benchmark,
      deflatedSharpeTrials: restated.trials,
      deflatedSharpeDispersion: restated.dispersionSource
    };
    const verdict = decideVerdict({
      independentDecisions: metrics.independentDecisions,
      returnObservations: metrics.observations,
      excessReturn: metrics.excessReturnPct === null ? null : metrics.excessReturnPct / 100,
      trainExcessReturn: metrics.trainExcessReturnPct === null ? null : metrics.trainExcessReturnPct / 100,
      perPeriodSharpe: metrics.sharpePerPeriod,
      deflatedSharpe: restated.value,
      probabilityOfOverfit: metrics.probabilityOfBacktestOverfitting,
      directionPValue: metrics.directionPValue,
      hasDirection: (metrics.directionalCompared ?? 0) > 0,
      brier: metrics.brier,
      climatologyBrier: metrics.climatologyBrier,
      hasProbability: metrics.brier !== null
    });
    const note = strategy.family === 'kronos'
      ? strategy.note.replace(
        'O DSR usa as 108 tentativas da grade.',
        'O DSR conta as tentativas do registro, inclusive as 108 da grade, e a dispersão é o desvio-padrão dos Sharpes gravados linha a linha.'
      )
      : strategy.note;
    return { ...strategy, verdict: verdict.label, reason: verdict.reason, note, metrics: nextMetrics };
  });
  const notes = report.notes.filter(note => !note.includes('não inventa um DSR') && !note.includes('desvio-padrão dos Sharpes gravados'));
  if (!notes.some(note => note === kronosDispersionNote(strategies))) notes.push(kronosDispersionNote(strategies));
  return { ...report, generatedAt: new Date().toISOString(), strategies, notes };
}

export function writeValidationReport(report: ValidationReport, directory = 'reports'): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'validation-latest.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(directory, 'validation-latest.md'), renderValidationMarkdown(report));
}
