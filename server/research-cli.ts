import { loadEnvFile } from './load-env';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanonicalCandle } from '../shared/types';
import { sha256Content } from './binance-import-core';
import { auditCandleSeries } from './candle-validation';
import { appendForecastCache, loadForecastCache } from './forecast-cache';
import { KronosProcess } from './kronos-process';
import {
  CachedForecast,
  StudyRecord,
  TradeMetrics,
  buildStudyRecords,
  decisionIndexes,
  directionStats,
  promotionDecision,
  scoreWindow,
  seriesSeed,
  tuneInSample
} from './research-eval';
import {
  CURRENT_RULE,
  CURRENT_RULE_LONG_ONLY,
  OOS_START_MS,
  PRIMARY_ALPHA,
  PRIMARY_SERIES,
  RESEARCH_SYMBOLS,
  SAMPLE_COUNT,
  SERIES_SPECS,
  STUDY_START_MS,
  SeriesSpec,
  tuneGridSize
} from './research-protocol';
import {
  DatasetRow,
  DirectionRow,
  ResearchReport,
  ResearchRow,
  buildSummary,
  emptyLimitations,
  renderResearchMarkdown
} from './research-report';

loadEnvFile();

interface ManifestFile {
  symbol: string;
  interval: string;
  startTime: number;
  candleCount: number;
  normalizedPath: string;
  normalizedSha256: string;
  quality?: { valid?: boolean };
}

function loadCandles(manifest: ManifestFile): CanonicalCandle[] {
  const content = readFileSync(manifest.normalizedPath, 'utf8');
  const hash = sha256Content(content);
  if (hash !== manifest.normalizedSha256) {
    throw new Error(`Hash mismatch for ${manifest.normalizedPath}`);
  }
  const candles = content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as CanonicalCandle);
  const quality = auditCandleSeries(candles);
  if (!quality.valid) throw new Error(`Invalid series ${manifest.normalizedPath}: ${quality.errors.join('; ')}`);
  return candles;
}

function pickManifest(symbol: string, interval: string, intervalMs: number): ManifestFile {
  const dir = join('data', 'manifests');
  const files = readdirSync(dir).filter(name => name.endsWith('.manifest.json') || name.endsWith('.json'));
  const matches = files.map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')) as ManifestFile)
    .filter(manifest =>
      manifest.symbol === symbol &&
      manifest.interval === interval &&
      manifest.quality?.valid === true &&
      manifest.startTime <= STUDY_START_MS + intervalMs
    )
    .sort((a, b) => b.candleCount - a.candleCount);
  if (matches.length === 0) {
    throw new Error(`No valid ${symbol} ${interval} manifest covering ${new Date(STUDY_START_MS).toISOString()}. Run the importer with START_TIME=${STUDY_START_MS}.`);
  }
  return matches[0];
}

function cacheFile(symbol: string, spec: SeriesSpec, commit: string, datasetSha256: string): string {
  return join(
    'data',
    'research-cache',
    `${symbol}_${spec.interval}_c${spec.context}_h${spec.horizon}_n${SAMPLE_COUNT}_${commit.slice(0, 12)}_${datasetSha256.slice(0, 12)}.jsonl`
  );
}

function endIndexFor(candles: readonly CanonicalCandle[], split: 'in_sample' | 'out_of_sample'): number {
  if (split === 'out_of_sample') return candles.length;
  const index = candles.findIndex(candle => candle.openTime >= OOS_START_MS);
  return index === -1 ? candles.length : index;
}

function previousClose(candles: readonly CanonicalCandle[], record: StudyRecord): number {
  return record.index > 0 ? candles[record.index - 1].close : record.close;
}

function toRow(symbol: string, interval: string, split: ResearchRow['split'], metrics: TradeMetrics): ResearchRow {
  return {
    symbol,
    interval,
    split,
    strategy: metrics.label,
    returnPct: metrics.returnPct,
    maxDrawdownPct: metrics.maxDrawdownPct,
    sharpe: metrics.sharpe,
    closedTrades: metrics.closedTrades,
    winRatePct: metrics.winRatePct
  };
}

async function main(): Promise<void> {
  const loaded: {
    symbol: string;
    spec: SeriesSpec;
    candles: CanonicalCandle[];
    dataset: DatasetRow;
    records: StudyRecord[];
  }[] = [];

  const kronos = new KronosProcess();
  const ready = await kronos.start();
  const started = Date.now();
  try {
    for (const symbol of RESEARCH_SYMBOLS) {
      for (const spec of SERIES_SPECS) {
        const manifest = pickManifest(symbol, spec.interval, spec.intervalMs);
        const candles = loadCandles(manifest);
        const file = cacheFile(symbol, spec, ready.upstreamCommit, manifest.normalizedSha256);
        const cache = loadForecastCache(file, manifest.normalizedSha256);
        const needed = decisionIndexes(candles.length, spec.context, spec.horizon, spec.stride)
          .map(index => ({ candle: candles[index], index }));
        const missing = needed.filter(item => !cache.has(item.candle.openTime));
        console.log(`[research] ${symbol} ${spec.interval}: ${needed.length} decisões, ${missing.length} sem cache`);
        const fresh: CachedForecast[] = [];
        for (let n = 0; n < missing.length; n++) {
          const item = missing[n];
          const window = candles.slice(item.index - spec.context + 1, item.index + 1);
          const response = await kronos.infer({
            requestId: String(item.candle.openTime),
            timestamp: item.candle.openTime,
            interval: spec.interval,
            horizon: spec.horizon,
            sampleCount: SAMPLE_COUNT,
            candles: window
          });
          const sampleEnds = Array.isArray(response.sampleEnds) ? response.sampleEnds.map(Number) : [];
          const meanCloses = response.predictions.map(Number);
          if (sampleEnds.length !== SAMPLE_COUNT || meanCloses.length < spec.horizon) {
            throw new Error(`Forecast for ${symbol} ${spec.interval} ${item.candle.openTime} did not include ${SAMPLE_COUNT} samples`);
          }
          const official = meanCloses[spec.horizon - 1];
          const sampleMean = sampleEnds.reduce((sum, value) => sum + value, 0) / sampleEnds.length;
          if (!(official > 0) || Math.abs(sampleMean - official) / official > 0.02) {
            throw new Error(`Sample mean ${sampleMean} disagrees with official close ${official}`);
          }
          const row = {
            openTime: item.candle.openTime,
            meanCloses,
            sampleEnds,
            datasetSha256: manifest.normalizedSha256
          };
          cache.set(row.openTime, row);
          fresh.push(row);
          if (fresh.length >= 25) {
            appendForecastCache(file, fresh.splice(0, fresh.length));
          }
          if (n === 0 || (n + 1) % 25 === 0 || n + 1 === missing.length) {
            const elapsed = ((Date.now() - started) / 1000).toFixed(0);
            console.log(`[research] ${symbol} ${spec.interval} ${n + 1}/${missing.length} (${elapsed}s)`);
          }
        }
        appendForecastCache(file, fresh);
        const forecasts: Map<number, CachedForecast> = cache;
        const records = buildStudyRecords(candles, forecasts, spec, OOS_START_MS);
        loaded.push({
          symbol,
          spec,
          candles,
          records,
          dataset: {
            symbol,
            interval: spec.interval,
            normalizedPath: manifest.normalizedPath,
            normalizedSha256: manifest.normalizedSha256,
            candleCount: candles.length,
            firstOpenTime: candles[0].openTime,
            lastOpenTime: candles[candles.length - 1].openTime
          }
        });
      }
    }
  } finally {
    kronos.stop();
  }

  const primary = loaded.find(series => series.symbol === PRIMARY_SERIES.symbol && series.spec.interval === PRIMARY_SERIES.interval);
  if (!primary) throw new Error('Primary BTCUSDT 1h series was not loaded');
  const tuning = tuneInSample(
    primary.candles,
    primary.records.filter(record => record.split === 'in_sample'),
    primary.spec.intervalMs,
    endIndexFor(primary.candles, 'in_sample')
  );

  const rules = [CURRENT_RULE, CURRENT_RULE_LONG_ONLY];
  if (tuning.params) rules.push(tuning.params);

  const rows: ResearchRow[] = [];
  const directional: DirectionRow[] = [];
  for (const series of loaded) {
    for (const split of ['in_sample', 'out_of_sample'] as const) {
      const subset = series.records.filter(record => record.split === split);
      const direction = directionStats(subset, { horizon: series.spec.horizon, stride: series.spec.stride });
      const absolute = subset.map(record => Math.abs(record.meanEnd - record.actualEnd));
      directional.push({
        symbol: series.symbol,
        interval: series.spec.interval,
        split,
        hits: direction.hits,
        compared: direction.compared,
        accuracy: direction.accuracy,
        pValue: direction.pValue,
        mae: absolute.length ? absolute.reduce((sum, value) => sum + value, 0) / absolute.length : null
      });
      if (split === 'in_sample' && !(series.symbol === PRIMARY_SERIES.symbol && series.spec.interval === PRIMARY_SERIES.interval)) {
        continue;
      }
      const endIndex = endIndexFor(series.candles, split);
      let savedBaselines = false;
      for (const params of rules) {
        if (split === 'in_sample' && params.id !== 'escolhida-na-amostra') continue;
        const scored = scoreWindow(
          series.candles,
          subset,
          params,
          series.spec.intervalMs,
          record => previousClose(series.candles, record),
          seriesSeed(series.symbol, series.spec.interval, split),
          endIndex
        );
        rows.push(toRow(series.symbol, series.spec.interval, split, scored[0]));
        if (!savedBaselines) {
          for (const baseline of scored.slice(1)) rows.push(toRow(series.symbol, series.spec.interval, split, baseline));
          savedBaselines = true;
        }
      }
    }
  }

  const primaryOosDirection = directional.find(row =>
    row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample'
  );
  const primaryTuned = rows.find(row =>
    row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample' && row.strategy === 'escolhida-na-amostra'
  );
  const primaryHold = rows.find(row =>
    row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample' && row.strategy === 'comprar-e-segurar'
  );
  const promotion = promotionDecision(
    'BTCUSDT',
    '1h',
    {
      hits: primaryOosDirection?.hits ?? 0,
      compared: primaryOosDirection?.compared ?? 0,
      accuracy: primaryOosDirection?.accuracy ?? null,
      pValue: primaryOosDirection?.pValue ?? null
    },
    primaryTuned ? {
      label: primaryTuned.strategy,
      returnPct: primaryTuned.returnPct,
      maxDrawdownPct: primaryTuned.maxDrawdownPct,
      sharpe: primaryTuned.sharpe,
      closedTrades: primaryTuned.closedTrades,
      wins: 0,
      winRatePct: primaryTuned.winRatePct,
      feesPaid: 0,
      endingEquity: 0
    } : null,
    primaryHold ? {
      label: primaryHold.strategy,
      returnPct: primaryHold.returnPct,
      maxDrawdownPct: primaryHold.maxDrawdownPct,
      sharpe: primaryHold.sharpe,
      closedTrades: primaryHold.closedTrades,
      wins: 0,
      winRatePct: primaryHold.winRatePct,
      feesPaid: 0,
      endingEquity: 0
    } : null
  );

  const directionTests = directional.filter(row => row.split === 'out_of_sample').length;
  const report: ResearchReport = {
    generatedAt: new Date().toISOString(),
    disclaimer: 'Pesquisa. Nenhuma ordem real foi enviada. Um resultado negativo continua publicado.',
    summaryPt: '',
    promoteToPaper: promotion.promoteToPaper,
    promotionReasons: promotion.reasons,
    tunedParams: tuning.params,
    tunedInSample: tuning.inSample,
    tuning: { tried: tuning.tried, eligible: tuning.eligible, series: 'BTCUSDT 1h' },
    multipleTesting: {
      inSampleConfigs: tuneGridSize(),
      outOfSampleDirectionTests: directionTests,
      primaryAlpha: PRIMARY_ALPHA,
      bonferroniAlpha: PRIMARY_ALPHA / Math.max(1, directionTests)
    },
    directional,
    rows,
    datasets: loaded.map(series => series.dataset),
    sampling: {
      context: 256,
      sampleCount: SAMPLE_COUNT,
      specs: SERIES_SPECS.map(spec => ({ interval: spec.interval, horizon: spec.horizon, stride: spec.stride }))
    },
    limitations: emptyLimitations()
  };
  report.summaryPt = buildSummary(report);
  if (tuning.tried !== tuneGridSize()) {
    throw new Error(`Tuning tried ${tuning.tried} configs, protocol declares ${tuneGridSize()}`);
  }

  const jsonPath = 'reports/research-m2.json';
  const markdownPath = 'reports/research-m2.md';
  mkdirSync('reports', { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(markdownPath, renderResearchMarkdown(report));
  console.log(JSON.stringify({
    report: jsonPath,
    promoteToPaper: report.promoteToPaper,
    primaryAccuracy: primaryOosDirection?.accuracy ?? null,
    primaryP: primaryOosDirection?.pValue ?? null,
    tunedReturn: primaryTuned?.returnPct ?? null,
    buyAndHoldReturn: primaryHold?.returnPct ?? null,
    tried: tuning.tried
  }, null, 2));
}

main().catch(error => {
  console.error('[research]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
