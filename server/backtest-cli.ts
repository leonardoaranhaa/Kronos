import { loadEnvFile } from './load-env';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CanonicalCandle } from '../shared/types';
import { auditCandleSeries, intervalToMilliseconds } from './candle-validation';
import { sha256Content } from './binance-import-core';
import { readResearchConfig } from './research-config';
import { KronosProcess } from './kronos-process';
import { runWalkForward } from './backtest';
import { BacktestReport, limitationLines, renderBacktestMarkdown, signalRuleLines } from './backtest-report';

loadEnvFile();

function latestNormalizedPath(): string {
  const configured = process.env.HISTORICAL_DATA_PATH;
  if (configured) return configured;
  const dir = join('data', 'normalized');
  const files = readdirSync(dir)
    .filter(name => name.endsWith('.jsonl'))
    .sort();
  if (files.length === 0) throw new Error('No normalized snapshot found. Run npm run import:binance first.');
  return join(dir, files[files.length - 1]);
}

async function main(): Promise<void> {
  const config = readResearchConfig();
  const normalizedPath = latestNormalizedPath();
  const content = readFileSync(normalizedPath, 'utf8');
  const candles = content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as CanonicalCandle);
  const quality = auditCandleSeries(candles);
  if (!quality.valid) {
    throw new Error(`Refusing to backtest an invalid snapshot: ${quality.errors.join('; ')}`);
  }
  const intervalMs = intervalToMilliseconds(candles[0].interval);
  if (intervalMs === null) throw new Error(`Unsupported interval ${candles[0].interval}`);

  const kronos = new KronosProcess();
  const ready = await kronos.start();
  const started = Date.now();
  let inferenceMs = 0;
  try {
    const result = await runWalkForward(candles, {
      context: config.backtest.context,
      horizon: config.backtest.horizon,
      stride: config.backtest.stride,
      costs: config.costs,
      signal: config.signal,
      breaker: config.breaker,
      startingEquity: config.startingEquity,
      intervalMs,
      randomSeed: config.backtest.randomSeed
    }, {
      predict: async window => {
        const t0 = Date.now();
        const response = await kronos.infer({
          requestId: String(window[window.length - 1].openTime),
          timestamp: window[window.length - 1].openTime,
          interval: window[window.length - 1].interval,
          horizon: config.backtest.horizon,
          candles: window
        });
        inferenceMs += Date.now() - t0;
        return response.predictions;
      }
    }, (completed, total) => {
      if (completed === 1 || completed % 25 === 0 || completed === total) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`[backtest] ${completed}/${total} previsões (${elapsed}s)`);
      }
    });

    const report: BacktestReport = {
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
      model: {
        modelId: ready.modelId,
        tokenizerId: ready.tokenizerId,
        upstreamCommit: ready.upstreamCommit,
        device: ready.device
      },
      costs: config.costs,
      signal: config.signal,
      signalRules: signalRuleLines(config.signal, config.costs),
      limitations: limitationLines(result),
      runtime: { forecasts: result.sampling.decisionCount, inferenceMs }
    };

    const jsonPath = config.reportPath;
    const markdownPath = jsonPath.replace(/\.json$/i, '.md');
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
    writeFileSync(markdownPath, renderBacktestMarkdown(report));
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    const archiveDir = join('data', 'backtests');
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(join(archiveDir, `${stamp}.json`), JSON.stringify(report));
    console.log(JSON.stringify({
      report: jsonPath,
      markdown: markdownPath,
      decisions: report.sampling.decisionCount,
      directionalAccuracy: report.forecast.directionalAccuracy,
      kronosReturnPct: report.strategies.kronos.returnPct,
      buyAndHoldReturnPct: report.strategies.buyAndHold.returnPct,
      persistenceReturnPct: report.strategies.persistence.returnPct,
      randomReturnPct: report.strategies.random.returnPct,
      inferenceMs
    }, null, 2));
  } finally {
    kronos.stop();
  }
}

main().catch(error => {
  console.error('[backtest]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
