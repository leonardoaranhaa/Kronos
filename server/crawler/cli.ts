import { loadEnvFile } from '../load-env';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BACKTEST_UNIVERSE, readCrawlerConfig } from './config';
import { runCrawlerBacktest } from './backtest';
import { CrawlerReport, crawlerLimitationLines, renderCrawlerMarkdown } from './report';
import type { MarketBar } from './types';

loadEnvFile();

const FIVE_MINUTES = 300_000;

async function fetchKlines(base: string, symbol: string, start: number, end: number): Promise<MarketBar[]> {
  const bars: MarketBar[] = [];
  let cursor = start;
  while (cursor < end) {
    const url = new URL(`${base}/api/v3/klines`);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', '5m');
    url.searchParams.set('startTime', String(cursor));
    url.searchParams.set('endTime', String(end));
    url.searchParams.set('limit', '1000');
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${symbol} klines HTTP ${response.status}`);
    const page = await response.json() as unknown[];
    if (!Array.isArray(page) || page.length === 0) break;
    for (const row of page) {
      if (!Array.isArray(row) || row.length < 11) continue;
      const openTime = Number(row[0]);
      const closeTime = Number(row[6]);
      if (closeTime >= Date.now()) continue;
      bars.push({
        openTime,
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        quoteVolume: Number(row[7]),
        takerBuyQuote: Number(row[10])
      });
    }
    const last = Number((page[page.length - 1] as unknown[])[0]);
    const next = last + FIVE_MINUTES;
    if (!(next > cursor)) break;
    cursor = next;
    if (page.length < 1000) break;
  }
  bars.sort((a, b) => a.openTime - b.openTime);
  return bars;
}

async function main(): Promise<void> {
  const config = readCrawlerConfig();
  const end = Date.now();
  const start = end - 21 * 24 * 60 * 60 * 1000;
  const series: Record<string, MarketBar[]> = {};
  let candles = 0;
  for (const symbol of BACKTEST_UNIVERSE) {
    process.stdout.write(`[crawler] baixando ${symbol}...\n`);
    series[symbol] = await fetchKlines(config.restBase, symbol, start, end);
    candles += series[symbol].length;
    process.stdout.write(`[crawler] ${symbol}: ${series[symbol].length} candles\n`);
  }
  const started = Date.now();
  const result = runCrawlerBacktest(series);
  const report: CrawlerReport = {
    ...result,
    generatedAt: new Date().toISOString(),
    disclaimer: 'Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado.',
    candleCount: candles,
    rules: [
      'A cada hora, as moedas com barra naquele instante entram na conta.',
      'O score usa tendência de 1h e 4h, rompimento, volume, trechos parecidos, força contra o BTC, taker-buy e um desconto se a volatilidade está alta.',
      'As outras duas fórmulas são só o retorno da última hora, e o volume anormal com o sinal da vela.',
      'Compra as 3 primeiras em partes iguais. A comparação é a média de todas as moedas disponíveis naquela hora.',
      'O que acontece depois da hora da decisão não entra no score.'
    ],
    limitations: crawlerLimitationLines()
  };
  mkdirSync(dirname(config.reportPath), { recursive: true });
  writeFileSync(config.reportPath, `${JSON.stringify(report)}\n`);
  const mdPath = config.reportPath.replace(/\.json$/i, '.md');
  writeFileSync(mdPath, renderCrawlerMarkdown(report));
  const primary = report.variants[0];
  console.log(`[crawler] ${report.decisions} decisões em ${((Date.now() - started) / 1000).toFixed(1)}s`);
  for (const row of primary.horizons) {
    console.log(`[crawler] ${row.label}: excesso ${row.excessPct?.toFixed(3) ?? 'n/d'} pp, top líquido ${row.topNetPct?.toFixed(3) ?? 'n/d'}%`);
  }
  console.log(`[crawler] relatório em ${mdPath}`);
}

main().catch(error => {
  console.error('[crawler]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
