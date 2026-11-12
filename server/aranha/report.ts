import { TradingMetrics } from '../backtest';
import { CostConfig } from '../trading-math';
import { ARANHA_GATES } from './gates';
import type { AranhaBacktestResult } from './backtest';

export interface AranhaReport extends AranhaBacktestResult {
  generatedAt: string;
  disclaimer: string;
  symbol: string;
  interval: string;
  range: { firstOpenTime: number; lastOpenTime: number; candleCount: number };
  dataset: { normalizedPath: string; normalizedSha256: string };
  costs: CostConfig;
  rules: string[];
  limitations: string[];
}

function pct(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return 'n/d';
  return `${value.toFixed(digits)}%`;
}

function num(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return 'n/d';
  return value.toFixed(digits);
}

function row(metrics: TradingMetrics): string {
  return `| ${metrics.label} | ${pct(metrics.returnPct)} | ${pct(metrics.maxDrawdownPct)} | ${pct(metrics.winRatePct)} | ${metrics.closedTrades} | ${num(metrics.sharpe)} | ${metrics.feesPaid.toFixed(2)} |`;
}

export function aranhaRuleLines(costs: CostConfig): string[] {
  return [
    `Análogos: compra se houver pelo menos ${ARANHA_GATES.minAnalogs} trechos, a mediana da hora seguinte for de pelo menos +${ARANHA_GATES.entryMedianBps} bps e a taxa de alta for de pelo menos ${Math.round(ARANHA_GATES.entryHitRate * 100)}%. A venda é o espelho. Os números foram escolhidos antes de ver este resultado.`,
    'Estruturas: segue a tendência de 1 hora, e fica de fora se o gráfico de 5 minutos acabou de romper para o lado contrário. A taxa histórica de cada padrão é só informada; ela não escolhe o padrão.',
    'Filtro de análogos, a parte que dá para medir: segura a compra do último candle quando os trechos parecidos estão claramente para baixo, e o contrário na venda. O filtro completo ao vivo também exige que o tom das notícias discorde. Aqui não há notícia ponto a ponto, então essa metade não entra na simulação.',
    `Taxa de ${costs.feeRate * 100}% e slippage de ${costs.slippageRate * 100}% por execução. A posição usa ${costs.positionFraction * 100}% do caixa.`,
    'A ordem simulada entra na abertura do candle seguinte. As estratégias da Aranha usam a trava diária de -2% e a pausa após 3 perdas. As baselines não usam a trava.',
    'Janela de comparação: 48 candles de 5 minutos. O horizonte medido dos análogos é 12 candles, cerca de 1 hora. Decisão a cada 12 candles.'
  ];
}

export function aranhaLimitationLines(): string[] {
  return [
    'Isto é uma simulação de pesquisa. Nenhuma ordem real foi enviada.',
    'A perna da web não entra neste backtest. Notícia histórica, ponto a ponto, não está disponível. Não foi inventado um sentimento do passado. Os snapshots ao vivo ficam em data/aranha/snapshots para uma avaliação futura.',
    'O filtro completo (análogos e sentimento juntos) está coberto por teste com exemplos fixos. A linha "Persistência com filtro de análogos" mede só a metade dos análogos.',
    'O sinal do modelo Kronos não foi refiltrado aqui. A estratégia padrão do Kronos continua igual, com o filtro desligado.',
    'Um trecho parecido só entra se a janela dele não cruza a janela de agora e se o que aconteceu depois já era conhecido naquele instante.',
    'Taxa de acerto dos padrões é a fração de casos passados em que o preço subiu no horizonte. Amostra pequena continua amostra pequena.',
    'Um resultado negativo ou fraco continua publicado. Este arquivo não foi refeito para melhorar o número.',
    'Um único par e uma única janela não dizem como isso se comporta em outros mercados.'
  ];
}

export function renderAranhaMarkdown(report: AranhaReport): string {
  const accuracy = report.analogForecast.directionalAccuracy === null
    ? 'n/d'
    : `${(report.analogForecast.directionalAccuracy * 100).toFixed(2)}% (${report.analogForecast.directionalHits}/${report.analogForecast.directionalSamples})`;
  const strategies = [
    report.strategies.analogs,
    report.strategies.structures,
    report.strategies.persistenceFiltered,
    report.strategies.persistence,
    report.strategies.buyAndHold,
    report.strategies.random
  ];
  return [
    '# Aranha Digital — backtest do gráfico',
    '',
    report.disclaimer,
    '',
    'A Aranha lê o gráfico. Esta página mede só essa leitura. A web fica de fora de propósito.',
    '',
    `- Gerado em: ${report.generatedAt}`,
    `- Par / intervalo: ${report.symbol} ${report.interval}`,
    `- Candles: ${report.range.candleCount}`,
    `- Primeiro openTime: ${report.range.firstOpenTime}`,
    `- Último openTime: ${report.range.lastOpenTime}`,
    `- Arquivo: \`${report.dataset.normalizedPath}\``,
    `- SHA-256 normalizado: \`${report.dataset.normalizedSha256}\``,
    `- Janela / horizonte / vizinhos / stride: ${report.sampling.window} / ${report.sampling.horizon} / ${report.sampling.neighbors} / ${report.sampling.stride}`,
    `- Decisões: ${report.sampling.decisionCount}`,
    '',
    '## Regras',
    '',
    ...report.rules.map(line => `- ${line}`),
    '',
    '## O que os trechos parecidos acertaram',
    '',
    'Isto não é taxa de acerto de trade. É a mediana dos trechos parecidos contra o movimento real da hora seguinte, só quando havia pelo menos 8 trechos.',
    '',
    `- Direção da mediana: ${accuracy}`,
    `- Erro absoluto médio da mediana: ${num(report.analogForecast.maeBps, 1)} bps`,
    `- Vezes em que o filtro de análogos segurou o último candle: ${report.filter.skippedByAnalogFilter} de ${report.filter.decisions} decisões`,
    '',
    '## Negociação simulada',
    '',
    '| Estratégia | Retorno | Drawdown máx. | Taxa de acerto | Trades | Sharpe | Taxas |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...strategies.map(row),
    '',
    'Sharpe usa o retorno por candle de 5 minutos, anualizado com 365,25 dias, no trecho entre a primeira decisão e o fim. Taxa de acerto é trades fechados com lucro dividido por trades fechados. A posição aberta no fim é encerrada no último fechamento.',
    '',
    '## O que não foi medido',
    '',
    ...report.limitations.map(line => `- ${line}`),
    ''
  ].join('\n');
}
