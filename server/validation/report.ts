import { StrategyEvaluation } from './evaluate';

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
  verdict: 'aprovada' | 'inconclusiva' | 'reprovada (provável sorte/overfit)';
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
    'Uma estratégia só fica **aprovada** com pelo menos 30 decisões independentes no teste walk-forward, retorno depois das taxas acima de comprar e segurar, Sharpe deflacionado de pelo menos 0,95 e probabilidade de backtest overfitting abaixo de 0,50. Se ela emite direção, o teste dependente também precisa ficar abaixo de 0,05. Se emite P(alta), o Brier precisa bater a taxa-base.',
    '',
    '**Reprovada (provável sorte/overfit)** é um ganho que não se repetiu no teste, um Sharpe positivo que o número de tentativas esvazia, ou um menu cujo vencedor de um bloco perde no bloco complementar. O resto fica **inconclusiva**.',
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
