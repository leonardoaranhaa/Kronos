import { WalkForwardResult, TradingMetrics } from './backtest';
import { CostConfig } from './trading-math';
import { SignalConfig } from './signals';

export interface BacktestReport extends WalkForwardResult {
  generatedAt: string;
  disclaimer: string;
  symbol: string;
  interval: string;
  range: { firstOpenTime: number; lastOpenTime: number; candleCount: number };
  dataset: { normalizedPath: string; normalizedSha256: string };
  model: {
    modelId: string;
    tokenizerId: string;
    upstreamCommit: string;
    device: string;
  };
  costs: CostConfig;
  signal: SignalConfig;
  signalRules: string[];
  limitations: string[];
  runtime: { forecasts: number; inferenceMs: number };
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

export function signalRuleLines(signal: SignalConfig, costs: CostConfig): string[] {
  return [
    `BUY quando a última previsão sobe pelo menos ${signal.minMoveBps} bps, a EMA9 está acima da EMA20 e o RSI está abaixo de ${signal.rsiBuyMax}.`,
    `SELL quando a última previsão cai pelo menos ${signal.minMoveBps} bps, a EMA9 está abaixo da EMA20 e o RSI está acima de ${signal.rsiSellMin}.`,
    'Qualquer outro caso é HOLD. HOLD não altera a posição.',
    `Taxa de ${costs.feeRate * 100}% e slippage de ${costs.slippageRate * 100}% por execução. A posição usa ${costs.positionFraction * 100}% do caixa disponível.`,
    'O mínimo de movimento é um portão fixo, igual ao custo estimado de ida e volta. Ele não foi ajustado neste conjunto de dados.',
    'Uma ordem simulada é preenchida na abertura do candle seguinte. A previsão não entra no preço de execução.',
    'A estratégia Kronos também obedece a trava diária de -2% e a pausa após 3 perdas. As baselines não usam a trava, para continuar sendo baselines.'
  ];
}

export function limitationLines(result: WalkForwardResult): string[] {
  const barMinutes = 5;
  const decisionMinutes = result.sampling.stride * barMinutes;
  return [
    'Isto é uma simulação de pesquisa. Nenhuma ordem real foi enviada.',
    `O modelo foi consultado a cada ${result.sampling.stride} candles de 5 minutos (cerca de ${decisionMinutes} minutos), não em todo candle. Entre as decisões, a última posição simulada permanece aberta.`,
    'A pausa de 30 minutos depois de 3 perdas pode não aparecer neste relatório quando o intervalo entre decisões é maior do que a pausa. A trava diária de -2% é avaliada em todo candle.',
    'O timeout de heartbeat do feed vale para o socket ao vivo. Ele não é reaplicado neste histórico, porque os candles de 5 minutos já passaram na auditoria de continuidade.',
    'Venda a descoberto aqui é simulada. Não há empréstimo, funding nem fila de ordem da corretora.',
    'Um resultado negativo ou fraco é um resultado válido. Este relatório não foi refeito para melhorar o número.',
    'Um único intervalo, um único par e uma única janela não dizem como o modelo se comporta em outros mercados.'
  ];
}

export function renderBacktestMarkdown(report: BacktestReport): string {
  const accuracy = report.forecast.directionalAccuracy === null
    ? 'n/d'
    : `${(report.forecast.directionalAccuracy * 100).toFixed(2)}% (${report.forecast.directionalHits}/${report.forecast.directionalSamples})`;
  const lines = [
    '# Backtest Kronos — pesquisa',
    '',
    report.disclaimer,
    '',
    `- Gerado em: ${report.generatedAt}`,
    `- Par / intervalo: ${report.symbol} ${report.interval}`,
    `- Candles: ${report.range.candleCount}`,
    `- Primeiro openTime: ${report.range.firstOpenTime}`,
    `- Último openTime: ${report.range.lastOpenTime}`,
    `- Arquivo: \`${report.dataset.normalizedPath}\``,
    `- SHA-256 normalizado: \`${report.dataset.normalizedSha256}\``,
    `- Modelo: ${report.model.modelId}`,
    `- Tokenizer: ${report.model.tokenizerId}`,
    `- Commit upstream: \`${report.model.upstreamCommit}\``,
    `- Dispositivo: ${report.model.device}`,
    `- Contexto / horizonte / stride: ${report.sampling.context} / ${report.sampling.horizon} / ${report.sampling.stride}`,
    `- Decisões: ${report.sampling.decisionCount}`,
    `- Tempo de inferência: ${(report.runtime.inferenceMs / 1000).toFixed(1)} s em ${report.runtime.forecasts} previsões`,
    '',
    '## Regras do sinal',
    '',
    ...report.signalRules.map(line => `- ${line}`),
    '',
    '## Previsão',
    '',
    `- Acurácia direcional no horizonte: ${accuracy}`,
    `- MAE do preço previsto: ${num(report.forecast.mae, 4)}`,
    `- MAPE: ${report.forecast.mape === null ? 'n/d' : `${(report.forecast.mape * 100).toFixed(3)}%`}`,
    '',
    '## Negociação simulada',
    '',
    '| Estratégia | Retorno | Drawdown máx. | Taxa de acerto | Trades | Sharpe | Taxas |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    row(report.strategies.kronos),
    row(report.strategies.buyAndHold),
    row(report.strategies.persistence),
    row(report.strategies.random),
    '',
    `- Travas diárias disparadas na estratégia Kronos: ${report.strategies.kronos.breakerTrips}`,
    `- Pausas por perdas seguidas: ${report.strategies.kronos.cooldownEvents}`,
    '',
    'Sharpe usa o retorno por candle de 5 minutos, anualizado com 365,25 dias, no trecho entre a primeira decisão e o fim. Taxa de acerto é trades fechados com lucro dividido por trades fechados. A posição que ainda estiver aberta é encerrada no último fechamento.',
    '',
    '## Limites',
    '',
    ...report.limitations.map(line => `- ${line}`),
    ''
  ];
  return lines.join('\n');
}
