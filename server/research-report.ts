import { TradeMetrics } from './research-eval';
import { PromotionDecision, TunedChoice } from './research-eval';
import { PRIMARY_ALPHA, tuneGridSize } from './research-protocol';

export interface ResearchRow {
  symbol: string;
  interval: string;
  split: 'in_sample' | 'out_of_sample';
  strategy: string;
  returnPct: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  closedTrades: number;
  winRatePct: number | null;
}

export interface DirectionRow {
  symbol: string;
  interval: string;
  split: 'in_sample' | 'out_of_sample';
  hits: number;
  compared: number;
  accuracy: number | null;
  pValue: number | null;
  mae: number | null;
}

export interface DatasetRow {
  symbol: string;
  interval: string;
  normalizedPath: string;
  normalizedSha256: string;
  candleCount: number;
  firstOpenTime: number;
  lastOpenTime: number;
}

export interface ResearchReport {
  generatedAt: string;
  disclaimer: string;
  summaryPt: string;
  promoteToPaper: boolean;
  promotionReasons: string[];
  tunedParams: TunedChoice['params'];
  tunedInSample: TradeMetrics | null;
  tuning: { tried: number; eligible: number; series: string };
  multipleTesting: {
    inSampleConfigs: number;
    outOfSampleDirectionTests: number;
    primaryAlpha: number;
    bonferroniAlpha: number;
  };
  directional: DirectionRow[];
  rows: ResearchRow[];
  datasets: DatasetRow[];
  sampling: { context: number; sampleCount: number; specs: { interval: string; horizon: number; stride: number }[] };
  limitations: string[];
}

function num(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return 'n/d';
  return value.toFixed(digits);
}

export function buildSummary(report: Pick<ResearchReport, 'promoteToPaper' | 'promotionReasons' | 'directional' | 'rows' | 'tuning' | 'multipleTesting' | 'tunedInSample'>): string {
  const primary = report.directional.find(row =>
    row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample'
  );
  const tuned = report.rows.find(row =>
    row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample' && row.strategy === 'escolhida-na-amostra'
  );
  const hold = report.rows.find(row =>
    row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample' && row.strategy === 'comprar-e-segurar'
  );
  const accuracy = primary?.accuracy === null || primary?.accuracy === undefined
    ? 'sem medida'
    : `${(primary.accuracy * 100).toFixed(1)}% (${primary.hits}/${primary.compared}, p=${primary.pValue?.toFixed(3) ?? 'n/d'})`;
  const tunedText = tuned ? `${tuned.returnPct.toFixed(2)}%` : 'não houve configuração elegível';
  const holdText = hold ? `${hold.returnPct.toFixed(2)}%` : 'n/d';
  const verdict = report.promoteToPaper
    ? 'A regra escolhida na amostra passou no teste combinado e pode ser ligada no paper com PAPER_STRATEGY=pesquisa. O padrão continua sendo a regra atual.'
    : 'Nenhuma regra foi promovida para o paper. O padrão continua sendo a regra atual.';
  return [
    'Este estudo pergunta se o Kronos-small acerta a direção melhor do que uma moeda e se alguma regra de operação, depois de taxas, fica melhor do que comprar e segurar.',
    `A resposta principal usa só BTCUSDT em candles de 1 hora, no período guardado desde 12 de agosto de 2026. A direção nesse período foi ${accuracy}.`,
    `A configuração escolhida só com dados anteriores rendeu ${tunedText} fora da amostra. Comprar e segurar rendeu ${holdText}.`,
    report.tunedInSample
      ? `Na amostra de treino essa mesma regra tinha rendido ${report.tunedInSample.returnPct.toFixed(2)}%. Esse ganho não se repetiu fora da amostra.`
      : 'Não houve regra de treino com trades suficientes para levar adiante.',
    verdict,
    `Na amostra de treino foram comparadas ${report.tuning.tried} combinações, todas em BTCUSDT 1h. Fora da amostra a direção foi medida em ${report.multipleTesting.outOfSampleDirectionTests} séries. O limite do teste principal é ${report.multipleTesting.primaryAlpha}. Um p-valor pequeno numa série secundária, sozinho, não conta como descoberta.`,
    'Um número negativo é um resultado. Ele não foi refeito para ficar bonito.'
  ].join(' ');
}

export function renderResearchMarkdown(report: ResearchReport): string {
  const strategyOrder = ['regra-atual', 'regra-atual-so-compra', 'escolhida-na-amostra', 'comprar-e-segurar', 'ultimo-candle', 'aleatorio'];
  const orderedRows = report.rows
    .filter(row => row.split === 'out_of_sample')
    .slice()
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.interval.localeCompare(b.interval) || strategyOrder.indexOf(a.strategy) - strategyOrder.indexOf(b.strategy));
  const directionLines = report.directional
    .filter(row => row.split === 'out_of_sample')
    .map(row => `| ${row.symbol} | ${row.interval} | ${row.accuracy === null ? 'n/d' : `${(row.accuracy * 100).toFixed(2)}%`} | ${row.hits}/${row.compared} | ${row.pValue === null ? 'n/d' : row.pValue.toFixed(4)} | ${row.mae === null ? 'n/d' : row.mae.toFixed(2)} |`);
  const tradeLines = orderedRows
    .map(row => `| ${row.symbol} | ${row.interval} | ${row.strategy} | ${num(row.returnPct)}% | ${num(row.maxDrawdownPct)}% | ${row.winRatePct === null ? 'n/d' : `${num(row.winRatePct)}%`} | ${row.closedTrades} | ${num(row.sharpe)} |`);
  const sampling = report.sampling.specs
    .map(spec => `${spec.interval}: horizonte ${spec.horizon}, uma decisão a cada ${spec.stride} candles`)
    .join('; ');
  const tuned = report.tunedParams;
  return [
    '# Pesquisa M2 — o Kronos tem vantagem?',
    '',
    report.summaryPt,
    '',
    '## Como a prova foi feita',
    '',
    '- Dados públicos da Binance, sem chave. BTCUSDT, ETHUSDT e SOLUSDT. Intervalos de 5 minutos, 1 hora e 4 horas, a partir de 12 de novembro de 2025.',
    '- O período fora da amostra começa em 12 de agosto de 2026. Ele foi marcado antes de olhar qualquer resultado. Decisões cujo futuro atravessa esse corte não entram no treino nem no teste.',
    '- O treino olha só BTCUSDT de 1 hora, antes do corte, e escolhe uma combinação pelo Sharpe, com pelo menos 20 trades. As outras séries não escolhem regra.',
    `- Amostragem fixa antes de ver o resultado. Contexto ${report.sampling.context}, ${report.sampling.sampleCount} amostras por previsão. ${sampling}.`,
    '- Taxa de 0,1% e slippage de 0,05% por execução. A ordem simulada entra na abertura seguinte.',
    '- A direção usa todos os pontos de decisão, não só os trades. O teste é binomial unilateral contra 50%.',
    `- Combinações na amostra: ${report.multipleTesting.inSampleConfigs}. Testes de direção fora da amostra: ${report.multipleTesting.outOfSampleDirectionTests}. Alfa do teste principal: ${PRIMARY_ALPHA}. Alfa de Bonferroni nas ${report.multipleTesting.outOfSampleDirectionTests} séries: ${report.multipleTesting.bonferroniAlpha.toFixed(4)}.`,
    tuned
      ? `- Regra escolhida: modo ${tuned.mode}, filtro de média ${tuned.trendFilter ? 'ligado' : 'desligado'}, movimento mínimo ${tuned.minMoveBps} bps, múltiplo de ATR ${tuned.atrMultiple}, dispersão máxima ${tuned.maxDispersionBps} bps.`
      : '- Nenhuma combinação da amostra teve trades suficientes. Não há regra escolhida.',
    '',
    '## Direção fora da amostra',
    '',
    '| Par | Intervalo | Acurácia | Acertos | p-valor | MAE |',
    '| --- | --- | --- | --- | --- | --- |',
    ...directionLines,
    '',
    '## Operação simulada fora da amostra',
    '',
    '| Par | Intervalo | Estratégia | Retorno | Drawdown | Acerto dos trades | Trades | Sharpe |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...tradeLines,
    '',
    '## Promoção para o paper',
    '',
    ...report.promotionReasons.map(reason => `- ${reason}`),
    '',
    '## Limites',
    '',
    ...report.limitations.map(line => `- ${line}`),
    ''
  ].join('\n');
}

export function emptyLimitations(): string[] {
  return [
    'Isto não é conselho de investimento e nenhuma ordem real foi enviada.',
    'O modelo não é consultado em todo candle. O intervalo entre decisões está na tabela de amostragem e existe para caber em CPU.',
    'Sharpe anualizado com retornos por candle e 365,25 dias. Ele fica instável quando há poucos trades.',
    'Venda a descoberto é simulada.',
    'Nove séries e 108 combinações de treino aumentam a chance de um acaso parecer um achado. Por isso só um teste principal pode habilitar uma estratégia nova.',
    'O p-valor de direção usa só decisões cujo horizonte não se sobrepõe. Quando o horizonte passa do passo entre decisões, um bootstrap em blocos também entra, e o p-valor publicado é o mais alto dos dois.',
    `O alfa de Bonferroni para as nove direções é ${PRIMARY_ALPHA}/9. Ele é um aviso, não o teste que decide a promoção.`
  ];
}

export { tuneGridSize };
