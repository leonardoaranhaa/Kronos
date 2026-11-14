import { loadEnvFile } from './load-env';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanonicalCandle } from '../shared/types';
import { sha256Content } from './binance-import-core';
import { reliabilityTable, pUpFromEnds } from './calibration';
import { auditCandleSeries } from './candle-validation';
import { appendForecastCache, loadForecastCache } from './forecast-cache';
import { KronosProcess } from './kronos-process';
import {
  buildStudyRecords,
  directionStats,
  runParams,
  simulateDecisions
} from './research-eval';
import {
  OOS_START_MS,
  PRIMARY_SERIES,
  RESEARCH_COSTS,
  SAMPLE_COUNT,
  SERIES_SPECS,
  ResearchParams
} from './research-protocol';
import { recordedM2Dataset } from './validation/m2-dataset';

loadEnvFile();

/**
 * The rule chosen in milestone 2. Copied from reports/research-m2.json.
 * This script does not search the grid again.
 */
const FROZEN_M2_PARAMS: ResearchParams = {
  id: 'escolhida-na-amostra',
  mode: 'long_short',
  trendFilter: false,
  minMoveBps: 50,
  atrMultiple: 0,
  maxDispersionBps: 10_000
};

const SPEC = SERIES_SPECS.find(spec => spec.interval === '1h') ?? SERIES_SPECS[1];

function loadBtc1h(): { candles: CanonicalCandle[]; sha256: string; path: string } {
  const report = JSON.parse(readFileSync('reports/research-m2.json', 'utf8')) as {
    datasets?: { symbol: string; interval: string; normalizedPath: string; normalizedSha256: string }[];
  };
  const dataset = recordedM2Dataset(report, 'BTCUSDT', '1h');
  if (!existsSync(dataset.normalizedPath)) {
    throw new Error(`O snapshot BTCUSDT 1h do M2 não está em ${dataset.normalizedPath}. A comparação não usa outro arquivo.`);
  }
  const content = readFileSync(dataset.normalizedPath, 'utf8');
  if (sha256Content(content) !== dataset.normalizedSha256) {
    throw new Error('O arquivo BTCUSDT 1h não tem o hash registrado no M2. A comparação foi interrompida.');
  }
  const candles = content.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as CanonicalCandle);
  const quality = auditCandleSeries(candles);
  if (!quality.valid) throw new Error(quality.errors.join('; '));
  return { candles, sha256: dataset.normalizedSha256, path: dataset.normalizedPath };
}

async function main(): Promise<void> {
  // Match the milestone-2 worker: model.eval() and tokenizer left in train().
  // The RoPE patch is the only model change in this comparison.
  process.env.KRONOS_TOKENIZER_EVAL = '0';
  const { candles, sha256, path } = loadBtc1h();
  const before = JSON.parse(readFileSync('reports/research-m2.json', 'utf8')) as {
    directional: { symbol: string; interval: string; split: string; accuracy: number; hits: number; compared: number; pValue: number; mae: number }[];
    rows: { symbol: string; interval: string; split: string; strategy: string; returnPct: number; maxDrawdownPct: number; closedTrades: number; sharpe: number | null; winRatePct: number | null }[];
    tunedInSample: { returnPct: number; closedTrades: number; sharpe: number | null };
  };
  const beforeDirection = before.directional.find(row => row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample');
  const beforeTuned = before.rows.find(row => row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample' && row.strategy === 'escolhida-na-amostra');
  const beforeHold = before.rows.find(row => row.symbol === 'BTCUSDT' && row.interval === '1h' && row.split === 'out_of_sample' && row.strategy === 'comprar-e-segurar');
  if (!beforeDirection || !beforeTuned || !beforeHold) throw new Error('milestone 2 primary rows are missing');

  const kronos = new KronosProcess();
  const ready = await kronos.start();
  if (ready && process.env.KRONOS_TOKENIZER_EVAL !== '0') {
    throw new Error('comparison must leave the tokenizer in train mode');
  }
  const cachePath = join('data', 'research-cache', `BTCUSDT_1h_c${SPEC.context}_h${SPEC.horizon}_n${SAMPLE_COUNT}_rope425_tokentrain_${sha256.slice(0, 12)}.jsonl`);
  const cache = loadForecastCache(cachePath, sha256);
  const indexes: number[] = [];
  for (let t = SPEC.context - 1; t + SPEC.horizon < candles.length; t += SPEC.stride) indexes.push(t);
  const missing = indexes.filter(index => !cache.has(candles[index].openTime));
  console.log(`[m3] BTCUSDT 1h decisions ${indexes.length}, missing ${missing.length}`);
  const fresh = [];
  const started = Date.now();
  try {
    for (let n = 0; n < missing.length; n++) {
      const index = missing[n];
      const window = candles.slice(index - SPEC.context + 1, index + 1);
      const response = await kronos.infer({
        requestId: String(candles[index].openTime),
        timestamp: candles[index].openTime,
        interval: '1h',
        horizon: SPEC.horizon,
        sampleCount: SAMPLE_COUNT,
        candles: window
      });
      const sampleEnds = Array.isArray(response.sampleEnds) ? response.sampleEnds.map(Number) : [];
      const meanCloses = response.predictions.map(Number);
      if (sampleEnds.length !== SAMPLE_COUNT) throw new Error(`expected ${SAMPLE_COUNT} samples`);
      const official = meanCloses[SPEC.horizon - 1];
      const sampleMean = sampleEnds.reduce((sum, value) => sum + value, 0) / sampleEnds.length;
      if (Math.abs(sampleMean - official) / official > 0.02) {
        throw new Error(`sample mean ${sampleMean} disagrees with ${official}`);
      }
      const row = { openTime: candles[index].openTime, meanCloses, sampleEnds, datasetSha256: sha256 };
      cache.set(row.openTime, row);
      fresh.push(row);
      if (fresh.length >= 25) appendForecastCache(cachePath, fresh.splice(0, fresh.length));
      if (n === 0 || (n + 1) % 25 === 0 || n + 1 === missing.length) {
        console.log(`[m3] ${n + 1}/${missing.length} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
      }
    }
  } finally {
    kronos.stop();
    appendForecastCache(cachePath, fresh);
  }

  const records = buildStudyRecords(candles, cache, SPEC, OOS_START_MS);
  const oos = records.filter(record => record.split === 'out_of_sample');
  const direction = directionStats(oos, { horizon: SPEC.horizon, stride: SPEC.stride });
  const endIndex = candles.length;
  const tuned = runParams(candles, oos, FROZEN_M2_PARAMS, SPEC.intervalMs, endIndex);
  const holdMap = new Map<number, 'BUY' | 'SELL' | 'HOLD'>();
  if (oos[0]) holdMap.set(oos[0].fillIndex, 'BUY');
  const hold = simulateDecisions(candles, holdMap, 'long_only', SPEC.intervalMs, RESEARCH_COSTS, 'comprar-e-segurar', endIndex);
  const reliability = reliabilityTable(oos.map(record => ({
    pUp: pUpFromEnds(record.sampleEnds, record.close),
    wentUp: record.actualEnd > record.close
  })));
  const mae = oos.length
    ? oos.reduce((sum, record) => sum + Math.abs(record.meanEnd - record.actualEnd), 0) / oos.length
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    protocol: {
      symbol: PRIMARY_SERIES.symbol,
      interval: PRIMARY_SERIES.interval,
      oosStart: new Date(OOS_START_MS).toISOString(),
      context: SPEC.context,
      horizon: SPEC.horizon,
      stride: SPEC.stride,
      sampleCount: SAMPLE_COUNT,
      retuned: false,
      frozenParams: FROZEN_M2_PARAMS,
      tokenizerEval: false,
      ropePatch: 'patches/kronos-rope-425.patch',
      upstreamCommit: '67b630e67f6a18c9e9be918d9b4337c960db1e9a',
      datasetSha256: sha256,
      datasetPath: path
    },
    variantsTried: 0,
    note: 'No new trading rule was searched. One already chosen rule was scored again after the RoPE patch.',
    before: {
      accuracy: beforeDirection.accuracy,
      hits: beforeDirection.hits,
      compared: beforeDirection.compared,
      pValue: beforeDirection.pValue,
      mae: beforeDirection.mae,
      tunedReturnPct: beforeTuned.returnPct,
      tunedTrades: beforeTuned.closedTrades,
      buyAndHoldReturnPct: beforeHold.returnPct
    },
    after: {
      accuracy: direction.accuracy,
      hits: direction.hits,
      compared: direction.compared,
      pValue: direction.pValue,
      mae,
      tunedReturnPct: tuned.returnPct,
      tunedTrades: tuned.closedTrades,
      tunedSharpe: tuned.sharpe,
      tunedDrawdownPct: tuned.maxDrawdownPct,
      buyAndHoldReturnPct: hold.returnPct
    },
    reliability,
    promoted: false
  };
  mkdirSync('reports', { recursive: true });
  writeFileSync('reports/research-m3.json', JSON.stringify(report, null, 2) + '\n');
  writeFileSync('reports/research-m3.md', render(report));
  console.log(JSON.stringify({ before: report.before, after: report.after, reliability }, null, 2));
}

function pct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'n/d';
  return `${(value * 100).toFixed(2)}%`;
}

function render(report: {
  before: { accuracy: number; hits: number; compared: number; pValue: number; mae: number; tunedReturnPct: number; tunedTrades: number; buyAndHoldReturnPct: number };
  after: { accuracy: number | null; hits: number; compared: number; pValue: number | null; mae: number | null; tunedReturnPct: number; tunedTrades: number; tunedSharpe: number | null; tunedDrawdownPct: number; buyAndHoldReturnPct: number };
  reliability: { pUp: number; count: number; realizedUpRate: number | null }[];
  protocol: { retuned: boolean; tokenizerEval: boolean };
}): string {
  const lines = [
    '# Pesquisa M3 — correção do RoPE e a mesma prova',
    '',
    'O modelo oficial continua no commit 67b630e. Por cima dele entrou um patch local, o conserto de RoPE do pull request 425, que ainda não foi mergeado. A regra de operação não foi escolhida de novo. É a mesma da pesquisa anterior: long/short, sem filtro de média, movimento mínimo de 50 bps, sem filtro de ATR e sem filtro de dispersão.',
    '',
    `No BTCUSDT de 1 hora, depois de 12 de agosto de 2026, a direção era ${pct(report.before.accuracy)} (${report.before.hits}/${report.before.compared}, p=${report.before.pValue.toFixed(3)}) antes do patch e ficou ${pct(report.after.accuracy)} (${report.after.hits}/${report.after.compared}, p=${report.after.pValue === null ? 'n/d' : report.after.pValue.toFixed(3)}) depois. A regra congelada rendeu ${report.before.tunedReturnPct.toFixed(2)}% antes e ${report.after.tunedReturnPct.toFixed(2)}% depois. Comprar e segurar rendeu ${report.before.buyAndHoldReturnPct.toFixed(2)}% antes e ${report.after.buyAndHoldReturnPct.toFixed(2)}% depois.`,
    '',
    'Essa comparação deixa o tokenizer em modo de treino, como na pesquisa anterior, para a única mudança medida ser o RoPE. O worker normal agora coloca modelo e tokenizer em eval. Isso não entra nesta tabela. Nenhuma regra nova foi testada: a contagem de variantes desta etapa é zero.',
    '',
    'Os pesos baixados do Hugging Face podem ser anteriores à correção de vazamento discutida nas issues 307 e 422. Este patch não troca esses pesos.',
    '',
    '| | Antes (sem o patch) | Depois (RoPE #425) |',
    '| --- | --- | --- |',
    `| Acurácia direcional | ${pct(report.before.accuracy)} | ${pct(report.after.accuracy)} |`,
    `| p-valor contra 50% | ${report.before.pValue.toFixed(4)} | ${report.after.pValue === null ? 'n/d' : report.after.pValue.toFixed(4)} |`,
    `| MAE no fim do horizonte | ${report.before.mae.toFixed(2)} | ${report.after.mae === null ? 'n/d' : report.after.mae.toFixed(2)} |`,
    `| Retorno da regra congelada | ${report.before.tunedReturnPct.toFixed(2)}% | ${report.after.tunedReturnPct.toFixed(2)}% |`,
    `| Trades | ${report.before.tunedTrades} | ${report.after.tunedTrades} |`,
    `| Drawdown da regra | n/d nesta coluna | ${report.after.tunedDrawdownPct.toFixed(2)}% |`,
    `| Sharpe da regra | n/d nesta coluna | ${report.after.tunedSharpe === null ? 'n/d' : report.after.tunedSharpe.toFixed(2)} |`,
    `| Comprar e segurar | ${report.before.buyAndHoldReturnPct.toFixed(2)}% | ${report.after.buyAndHoldReturnPct.toFixed(2)}% |`,
    '',
    '## Calibração de P(alta)',
    '',
    'P(alta) é a fração das 4 amostras cujo preço final fica acima do fechamento da decisão. A tabela é só o período fora da amostra, no modelo já corrigido. Com 4 amostras os valores possíveis são 0, 0,25, 0,50, 0,75 e 1.',
    '',
    '| P(alta) declarada | Previsões | Vezes em que o preço subiu |',
    '| --- | --- | --- |',
    ...report.reliability.map(bin => `| ${(bin.pUp * 100).toFixed(0)}% | ${bin.count} | ${bin.realizedUpRate === null ? 'n/d' : `${(bin.realizedUpRate * 100).toFixed(1)}%`} |`),
    '',
    'Uma P(alta) calibrada acompanharia a coluna da direita. Quando o modelo disse 0%, o preço ainda subiu na maioria desses casos. A probabilidade não está calibrada. Esta tabela não foi usada para escolher regra.',
    '',
    '## O que mais mudou no worker',
    '',
    '- Modelo e tokenizer ficam em eval no uso normal, como nos pull requests 382 e 407. O pull request 253 não foi aplicado.',
    '- Várias séries do mesmo tamanho podem ir em um predict_batch. Nesta CPU, 3 janelas de 256 candles de 1 hora, horizonte 6, uma amostra: uma por vez levou 0,696 s, 0,725 s e 0,664 s (média 0,695 s). O lote levou 0,913 s, 0,577 s e 0,559 s (média 0,683 s). O lote só fica mais rápido depois da primeira chamada. Não é um ganho grande para três pares.',
    '- A previsão pode devolver a banda de 10/50/90 e P(alta). O cache de amostras não usa o KV cache do pull request 393.',
    ''
  ];
  return lines.join('\n');
}

main().catch(error => {
  console.error('[m3]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
