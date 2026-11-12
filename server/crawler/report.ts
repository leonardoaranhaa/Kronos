import type { CrawlerBacktestResult, HorizonScore, VariantScore } from './backtest';

export interface CrawlerReport extends CrawlerBacktestResult {
  generatedAt: string;
  disclaimer: string;
  rules: string[];
  limitations: string[];
  candleCount: number;
}

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'n/d';
  return `${value.toFixed(3)}%`;
}

function rate(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'n/d';
  return `${(value * 100).toFixed(1)}%`;
}

function table(variant: VariantScore): string[] {
  return [
    `### ${variant.label}`,
    '',
    '| Horizonte | Vezes | Top 3 líquido | Universo líquido | Diferença | Top 3 ganhou |',
    '| --- | --- | --- | --- | --- | --- |',
    ...variant.horizons.map((row: HorizonScore) => `| ${row.label} | ${row.decisions} | ${pct(row.topNetPct)} | ${pct(row.universeNetPct)} | ${pct(row.excessPct)} | ${rate(row.topBeatRate)} |`),
    ''
  ];
}

export function crawlerLimitationLines(): string[] {
  return [
    'Isto é uma simulação de pesquisa. Nenhuma ordem real foi enviada.',
    'Foram comparadas 3 fórmulas, escritas antes de ver este arquivo. As três estão na tabela. Nenhuma foi apagada por ter ido mal.',
    'A lista de moedas é fixa (BTC, ETH, BNB, SOL, XRP, DOGE, ADA, AVAX, LINK, DOT, LTC, BCH). Não é o ranking de volume de hoje, para não escolher o passado com o que está grande agora.',
    'Cada lado paga 30 bps de ida e volta (0,1% de taxa e 0,05% de slippage em cada execução). A diferença entre o top 3 e o universo não muda com essa taxa, porque os dois pagam. O número líquido mostra se o top 3 ganhou dinheiro de verdade.',
    'A pressão de baleia neste estudo é a parcela de taker-buy dos candles da Binance. Não é a fita de negócios grandes nem a cadeia. Isso não estava disponível ponto a ponto sem um arquivo enorme.',
    'Transações on-chain não entram aqui. Elas passam a ser gravadas ao vivo em data/crawler, para um estudo futuro. Não foi inventado histórico de baleia na cadeia.',
    'O modelo Kronos não entra neste ranking. Ele é lento demais para todas as moedas.',
    'Um resultado fraco continua publicado.'
  ];
}

export function renderCrawlerMarkdown(report: CrawlerReport): string {
  return [
    '# Crawler — as moedas do topo rendem mais?',
    '',
    report.disclaimer,
    '',
    'A pergunta: se, a cada hora, a gente comprasse as 3 moedas com maior score e comparasse com comprar todas as moedas da lista, o topo ganharia nas 1 hora, 4 horas e 24 horas seguintes?',
    '',
    `- Gerado em: ${report.generatedAt}`,
    `- Moedas: ${report.universe.join(', ')}`,
    `- Candles de 5 minutos usados: ${report.candleCount}`,
    `- Decisões: ${report.decisions}`,
    `- Primeiro openTime: ${report.firstOpenTime ?? 'n/d'}`,
    `- Último openTime: ${report.lastOpenTime ?? 'n/d'}`,
    `- Fórmulas comparadas: ${report.variantsTried}`,
    `- Taxa de ida e volta: ${report.feeBps.toFixed(0)} bps`,
    '',
    '## Resultado',
    '',
    ...report.variants.flatMap(table),
    '## Regras',
    '',
    ...report.rules.map(line => `- ${line}`),
    '',
    '## O que não foi medido',
    '',
    ...report.limitations.map(line => `- ${line}`),
    ''
  ].join('\n');
}
