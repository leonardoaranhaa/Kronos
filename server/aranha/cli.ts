import { loadEnvFile } from '../load-env';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CanonicalCandle } from '../../shared/types';
import { sha256Content } from '../binance-import-core';
import { auditCandleSeries, intervalToMilliseconds } from '../candle-validation';
import { readResearchConfig } from '../research-config';
import { ARANHA_GATES } from './gates';
import { readAranhaConfig } from './config';
import { runAranhaBacktest } from './backtest';
import { AranhaReport, aranhaLimitationLines, aranhaRuleLines, renderAranhaMarkdown } from './report';

loadEnvFile();

function latestNormalizedPath(): string {
  const configured = process.env.HISTORICAL_DATA_PATH;
  if (configured) return configured;
  const dir = join('data', 'normalized');
  const files = readdirSync(dir).filter(name => name.endsWith('.jsonl')).sort();
  if (files.length === 0) throw new Error('No normalized snapshot found. Run npm run import:binance first.');
  return join(dir, files[files.length - 1]);
}

function main(): void {
  const research = readResearchConfig();
  const aranha = readAranhaConfig();
  const normalizedPath = latestNormalizedPath();
  const content = readFileSync(normalizedPath, 'utf8');
  const candles = content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as CanonicalCandle);
  const quality = auditCandleSeries(candles);
  if (!quality.valid) throw new Error(`Refusing to backtest an invalid snapshot: ${quality.errors.join('; ')}`);
  const intervalMs = intervalToMilliseconds(candles[0]?.interval ?? '');
  if (intervalMs === null) throw new Error(`Unsupported interval ${candles[0]?.interval}`);

  const started = Date.now();
  const result = runAranhaBacktest(candles, {
    window: aranha.window,
    horizon: aranha.horizon,
    neighbors: aranha.neighbors,
    separation: ARANHA_GATES.separation,
    stride: aranha.stride,
    costs: research.costs,
    breaker: research.breaker,
    startingEquity: research.startingEquity,
    intervalMs,
    randomSeed: research.backtest.randomSeed
  });
  const report: AranhaReport = {
    ...result,
    generatedAt: new Date().toISOString(),
    disclaimer: 'Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado.',
    symbol: candles[0].symbol,
    interval: candles[0].interval,
    range: {
      firstOpenTime: candles[0].openTime,
      lastOpenTime: candles[candles.length - 1].openTime,
      candleCount: candles.length
    },
    dataset: { normalizedPath, normalizedSha256: sha256Content(content) },
    costs: research.costs,
    rules: aranhaRuleLines(research.costs),
    limitations: aranhaLimitationLines()
  };
  const jsonPath = aranha.reportPath;
  const mdPath = jsonPath.replace(/\.json$/i, '.md');
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(mdPath, renderAranhaMarkdown(report));
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[aranha] ${report.sampling.decisionCount} decisões em ${elapsed}s`);
  console.log(`[aranha] análogos ${report.strategies.analogs.returnPct.toFixed(2)}% | estruturas ${report.strategies.structures.returnPct.toFixed(2)}% | filtro ${report.strategies.persistenceFiltered.returnPct.toFixed(2)}%`);
  console.log(`[aranha] direção da mediana ${report.analogForecast.directionalAccuracy === null ? 'n/d' : (report.analogForecast.directionalAccuracy * 100).toFixed(2)}%`);
  console.log(`[aranha] relatório em ${jsonPath}`);
}

main();
