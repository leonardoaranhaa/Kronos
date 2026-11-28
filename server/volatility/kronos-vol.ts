import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendForecastCache, loadForecastCache } from '../forecast-cache';
import type { FundingPrint, KlineBar } from '../futures/parse';
import { futuresRoot, symbolDir } from '../futures/paths';
import { readJsonl } from '../futures/store';
import { KronosProcess } from '../kronos-process';
import type { CachedForecast } from '../research-eval';
import type { CanonicalCandle } from '../../shared/types';
import { evaluateFamily, type StrategySeries } from '../validation/evaluate';
import { spearmanTest } from '../validation/correlation';
import { VALIDATION_GATES } from '../validation/protocol';
import {
  readValidationReport,
  writeValidationReport,
  type ValidationReport,
  type ValidationStrategy
} from '../validation/report';
import { readTrials, trialId, upsertTrial } from '../validation/trials';
import { composeHeadline, fmt, type VolatilityBlock } from './headlines';
import { coverageRate, dieboldMariano, empiricalQuantile, maxDrawdownPct, qlike } from './losses';
import { KRONOS_VOL_PROTOCOL, VOL_PROTOCOL, kronosVolFloor, kronosVolTrialPlans, volKronosFamily } from './protocol';
import { fitHar, predictHar } from './models';
import { exposureReturns, outerTestIndexes } from './study';
import type { VolDecision } from './build';

const HOUR_MS = 3_600_000;

export function kronosCheckoutPresent(modulePath = join('external', 'Kronos', 'model', '__init__.py')): boolean {
  return existsSync(modulePath);
}

/** Variance of the sampled terminal log returns. This is the Kronos vol forecast. */
export function sampleVarianceForecast(close: number, sampleEnds: readonly number[]): number | null {
  if (!(close > 0) || sampleEnds.length < 2) return null;
  const logs: number[] = [];
  for (const end of sampleEnds) {
    if (!(end > 0)) return null;
    logs.push(Math.log(end / close));
  }
  const center = logs.reduce((sum, value) => sum + value, 0) / logs.length;
  let square = 0;
  for (const value of logs) square += (value - center) ** 2;
  const variance = square / (logs.length - 1);
  if (!(variance > 0) || !Number.isFinite(variance)) return null;
  return variance;
}

function sha256File(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function hubRevision(repo: string): string | null {
  const home = process.env.HF_HOME ?? join(homedir(), '.cache', 'huggingface');
  const ref = join(home, 'hub', `models--${repo.replace('/', '--')}`, 'refs', 'main');
  return existsSync(ref) ? readFileSync(ref, 'utf8').trim() : null;
}

function gitHead(directory: string): string | null {
  try {
    return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export interface KronosRunManifest {
  protocol: string;
  registeredAt: string;
  generatedAt: string;
  klinesFile: string;
  klinesSha256: string;
  cacheFile: string;
  cacheSha256: string | null;
  modelId: string;
  modelRevision: string | null;
  tokenizerId: string;
  tokenizerRevision: string | null;
  upstreamCommit: string | null;
  patches: string[];
  repoCommit: string | null;
  inference: { context: number; horizon: number; stride: number; sampleCount: number; device: string };
  forecasts: number;
  points: number;
  verdict: string;
}

/** Binds the published number to the exact inputs that produced it. */
function writeRunManifest(directory: string, input: {
  klinesFile: string;
  cacheFile: string;
  forecasts: number;
  points: number;
  verdict: string;
  modulePath?: string;
}): KronosRunManifest {
  const modelId = process.env.KRONOS_MODEL_ID ?? 'NeoQuasar/Kronos-small';
  const tokenizerId = process.env.KRONOS_TOKENIZER_ID ?? 'NeoQuasar/Kronos-Tokenizer-base';
  const checkout = input.modulePath ? join(input.modulePath, '..', '..') : join('external', 'Kronos');
  const patchDir = 'patches';
  const manifest: KronosRunManifest = {
    protocol: KRONOS_VOL_PROTOCOL.id,
    registeredAt: KRONOS_VOL_PROTOCOL.registeredAt,
    generatedAt: new Date().toISOString(),
    klinesFile: input.klinesFile,
    klinesSha256: sha256File(input.klinesFile) ?? 'n/d',
    cacheFile: input.cacheFile,
    cacheSha256: sha256File(input.cacheFile),
    modelId,
    modelRevision: hubRevision(modelId),
    tokenizerId,
    tokenizerRevision: hubRevision(tokenizerId),
    upstreamCommit: gitHead(checkout),
    patches: existsSync(patchDir)
      ? readdirSync(patchDir).filter(name => name.endsWith('.patch')).sort().map(name => `${name} ${sha256File(join(patchDir, name))}`)
      : [],
    repoCommit: gitHead('.'),
    inference: {
      context: KRONOS_VOL_PROTOCOL.context,
      horizon: KRONOS_VOL_PROTOCOL.horizonBars,
      stride: KRONOS_VOL_PROTOCOL.stride,
      sampleCount: KRONOS_VOL_PROTOCOL.sampleCount,
      device: process.env.KRONOS_DEVICE ?? 'cpu'
    },
    forecasts: input.forecasts,
    points: input.points,
    verdict: input.verdict
  };
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'kronos-vol-run.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

/** Where the frozen-window forecasts live. Shared with the combination study. */
export function kronosCacheFile(klines: readonly KlineBar[], sampleCount: number = VOL_PROTOCOL.kronosSampleCount): { sha: string; path: string } {
  const sha = datasetKey(klines);
  const suffix = sampleCount === VOL_PROTOCOL.kronosSampleCount ? '' : `_s${sampleCount}`;
  return { sha, path: join('data', 'research-cache', `BTCUSDT_1h_vol_kronos_${sha.slice(0, 12)}${suffix}.jsonl`) };
}

/** Decision bars of the frozen spec: every `stride` bars, with a contiguous block on each side. */
export function kronosDecisionIndexes(klines: readonly KlineBar[]): number[] {
  const horizon = VOL_PROTOCOL.kronosHorizonBars;
  const indexes: number[] = [];
  for (let index = VOL_PROTOCOL.kronosContext - 1; index + horizon < klines.length; index += VOL_PROTOCOL.kronosStride) {
    if (klines[index].openTime - klines[index - horizon].openTime !== horizon * HOUR_MS) continue;
    if (klines[index + horizon].openTime - klines[index].openTime !== horizon * HOUR_MS) continue;
    indexes.push(index);
  }
  return indexes;
}

export interface KronosObservation {
  openTime: number;
  priceReturn: number;
  fundingPaidByLong: number;
  /** Kronos sample variance of the 6-hour terminal log return, floored. */
  forecast: number;
  /** Realized variance of the last 24 hours, scaled to 6 hours, floored. */
  naive: number;
  /** HAR-RV on 6-hour blocks, fit on earlier decisions only. Null until 30 of them exist. */
  har: number | null;
  /** Realized variance of the next 6 hours. The v2 target. */
  realized: number;
  /** Squared 6-hour log return. The v1 target, kept for the table. */
  squaredReturn: number;
  absolute: number;
  harDay: number;
  harWeek: number;
  harMonth: number;
}

function floorKronos(value: number): number {
  return Math.max(kronosVolFloor(), value);
}

function squaredSum(returns: readonly number[], from: number, to: number): number | null {
  if (from < 1) return null;
  let sum = 0;
  for (let index = from; index <= to; index++) {
    const value = returns[index];
    if (!Number.isFinite(value)) return null;
    sum += value * value;
  }
  return sum;
}

/**
 * One row per Kronos decision. Everything except the labels stops at the decision close.
 * The HAR fit at row i uses rows j < i only; with stride 12 and horizon 6 their labels are closed.
 */
export function buildKronosObservations(
  klines: readonly KlineBar[],
  indexes: readonly number[],
  cache: ReadonlyMap<number, Pick<CachedForecast, 'sampleEnds'>>,
  funding: readonly FundingPrint[]
): KronosObservation[] {
  const horizon = KRONOS_VOL_PROTOCOL.horizonBars;
  const returns = new Array<number>(klines.length).fill(Number.NaN);
  for (let index = 1; index < klines.length; index++) {
    const previous = klines[index - 1].close;
    const current = klines[index].close;
    if (previous > 0 && current > 0 && klines[index].openTime - klines[index - 1].openTime === HOUR_MS) {
      returns[index] = Math.log(current / previous);
    }
  }
  const rows: KronosObservation[] = [];
  for (const index of indexes) {
    const cached = cache.get(klines[index].openTime);
    if (!cached) continue;
    const raw = sampleVarianceForecast(klines[index].close, cached.sampleEnds);
    const entry = klines[index].close;
    const next = klines[index + horizon]?.close;
    if (raw === null || !(entry > 0) || !(next > 0)) continue;
    const realized = squaredSum(returns, index + 1, index + horizon);
    const recent = squaredSum(returns, index - KRONOS_VOL_PROTOCOL.recentHours + 1, index);
    const day = squaredSum(returns, index - horizon + 1, index);
    const week = squaredSum(returns, index - KRONOS_VOL_PROTOCOL.harWeekBlocks * horizon + 1, index);
    const month = squaredSum(returns, index - KRONOS_VOL_PROTOCOL.harMonthBlocks * horizon + 1, index);
    if (realized === null || recent === null || day === null || week === null || month === null) continue;
    const ahead = Math.log(next / entry);
    rows.push({
      openTime: klines[index].openTime,
      priceReturn: next / entry - 1,
      fundingPaidByLong: fundingBetween(funding, klines[index].closeTime, klines[index + horizon].closeTime),
      forecast: floorKronos(raw),
      naive: floorKronos(recent * horizon / KRONOS_VOL_PROTOCOL.recentHours),
      har: null,
      realized,
      squaredReturn: ahead * ahead,
      absolute: Math.abs(ahead),
      harDay: day,
      harWeek: week / KRONOS_VOL_PROTOCOL.harWeekBlocks,
      harMonth: month / KRONOS_VOL_PROTOCOL.harMonthBlocks
    });
  }
  for (let index = 0; index < rows.length; index++) {
    if (index < KRONOS_VOL_PROTOCOL.minTrainForecasts) continue;
    const train = rows.slice(0, index);
    const model = fitHar(
      train.map(row => row.harDay),
      train.map(row => row.harWeek),
      train.map(row => row.harMonth),
      train.map(row => row.realized)
    );
    const value = model ? predictHar(model, rows[index].harDay, rows[index].harWeek, rows[index].harMonth) : null;
    rows[index].har = value === null ? null : floorKronos(value);
  }
  return rows;
}

export interface KronosComparison {
  qlikeModel: number | null;
  qlikeBase: number | null;
  pValue: number | null;
  beats: boolean;
}

function compare(model: readonly number[], base: readonly number[], realized: readonly number[]): KronosComparison {
  const modelLoss = model.map((value, index) => qlike(value, realized[index]) ?? Number.NaN);
  const baseLoss = base.map((value, index) => qlike(value, realized[index]) ?? Number.NaN);
  const dm = dieboldMariano(modelLoss, baseLoss, KRONOS_VOL_PROTOCOL.dmLag, KRONOS_VOL_PROTOCOL.dmHorizon);
  const qlikeModel = mean(modelLoss);
  const qlikeBase = mean(baseLoss);
  const beats = qlikeModel !== null && qlikeBase !== null && qlikeModel < qlikeBase
    && dm.pValue !== null && dm.pValue < KRONOS_VOL_PROTOCOL.dmAlpha;
  return { qlikeModel, qlikeBase, pValue: dm.pValue, beats };
}

/** The v2 gate: beat the 24h realized vol and the HAR-RV on the same points. */
export function judgeKronosVol(observations: readonly KronosObservation[]): {
  verdict: VolatilityBlock['kronosVerdict'];
  sentence: string;
  points: number;
  versusRecent: KronosComparison;
  versusHar: KronosComparison;
} {
  const scored = observations.filter(row => row.har !== null);
  const realized = scored.map(row => row.realized);
  const forecasts = scored.map(row => row.forecast);
  const versusRecent = compare(forecasts, scored.map(row => row.naive), realized);
  const versusHar = compare(forecasts, scored.map(row => row.har as number), realized);
  const enough = scored.length >= KRONOS_VOL_PROTOCOL.minTestObservations
    && versusRecent.qlikeModel !== null && versusHar.qlikeBase !== null;
  const verdict: VolatilityBlock['kronosVerdict'] = !enough
    ? 'inconclusiva'
    : versusRecent.beats && versusHar.beats ? 'aprovada' : 'reprovada';
  if (!enough) {
    return {
      verdict,
      sentence: `Protocolo ${KRONOS_VOL_PROTOCOL.id}: a dispersão do Kronos-small não fechou ${KRONOS_VOL_PROTOCOL.minTestObservations} pontos comparáveis com o HAR-RV (há ${scored.length}).`,
      points: scored.length,
      versusRecent,
      versusHar
    };
  }
  const rank = spearmanTest(forecasts, realized);
  const cover80 = coverageRate(scored.map(row => row.absolute), forecasts, 0.8);
  const cover95 = coverageRate(scored.map(row => row.absolute), forecasts, 0.95);
  const v1 = mean(scored.map(row => qlike(row.forecast, row.squaredReturn) ?? Number.NaN));
  const pct = (value: number | null) => value === null ? 'n/d' : `${fmt(value * 100, 1)}%`;
  const sentence = [
    `Protocolo ${KRONOS_VOL_PROTOCOL.id}, ${scored.length} pontos, alvo = variância realizada das 6 horas seguintes.`,
    `QLIKE do Kronos ${fmt(versusRecent.qlikeModel, 4)}; vol realizada de 24h ${fmt(versusRecent.qlikeBase, 4)} (p DM ${fmt(versusRecent.pValue, 4)}); HAR-RV ${fmt(versusHar.qlikeBase, 4)} (p DM ${fmt(versusHar.pValue, 4)}).`,
    `Correlação de rank ${fmt(rank.coefficient, 3)} (p=${fmt(rank.pValue, 4)}). Cobertura 80% ${pct(cover80)}, 95% ${pct(cover95)}.`,
    `Contra o alvo antigo (quadrado do retorno de 6h) o QLIKE do Kronos é ${fmt(v1, 4)}; só informativo.`
  ].join(' ');
  return { verdict, sentence, points: scored.length, versusRecent, versusHar };
}

function fundingBetween(funding: readonly FundingPrint[], after: number, until: number): number {
  let paid = 0;
  for (const print of funding) {
    if (print.time <= after) continue;
    if (print.time > until) break;
    paid += print.rate;
  }
  return paid;
}

function toCandle(bar: KlineBar): CanonicalCandle {
  return {
    venue: 'binance-um',
    symbol: 'BTCUSDT',
    interval: '1h',
    openTime: bar.openTime,
    closeTime: bar.closeTime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    quoteVolume: bar.quoteVolume,
    source: 'historical',
    ingestedAt: bar.openTime
  };
}

function datasetKey(klines: readonly KlineBar[]): string {
  const first = klines[0];
  const last = klines[klines.length - 1];
  return createHash('sha256')
    .update(`${klines.length}:${first?.openTime}:${last?.openTime}:${last?.close}`)
    .digest('hex');
}

function expandingHigh(forecasts: readonly number[]): boolean[] {
  const past: number[] = [];
  return forecasts.map(forecast => {
    const cutoff = past.length >= VOL_PROTOCOL.minTrainForecasts
      ? empiricalQuantile(past, VOL_PROTOCOL.filterQuantile)
      : null;
    past.push(forecast);
    return cutoff !== null && forecast > cutoff;
  });
}

function asDecision(row: KronosObservation): VolDecision {
  return {
    openTime: row.openTime,
    barIndex: 0,
    priceReturn: row.priceReturn,
    absoluteLogReturn: row.absolute,
    realizedVariance: row.realized,
    squaredLogReturn: row.realized,
    fundingPaidByLong: row.fundingPaidByLong,
    rvDay: row.naive,
    rvWeek: row.naive,
    rvMonth: row.naive,
    ewmaVariance: row.naive,
    absPast: Math.sqrt(row.naive),
    features: null
  };
}

function mean(values: readonly number[]): number | null {
  const finite = values.filter(value => Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function registerKronosTrials(trialLog: string): void {
  for (const plan of kronosVolTrialPlans()) {
    upsertTrial(trialLog, {
      id: trialId(plan.family, plan.strategy, plan.params),
      family: plan.family,
      strategy: plan.strategy,
      recordedAt: KRONOS_VOL_PROTOCOL.registeredAt,
      trials: 1,
      sharpe: null,
      periods: null,
      source: 'pre-registro antes do teste',
      params: plan.params
    });
  }
}

function remember(trialLog: string, strategy: string, sharpe: number | null, periods: number | null): void {
  const plan = kronosVolTrialPlans().find(item => item.strategy === strategy);
  if (!plan) return;
  upsertTrial(trialLog, {
    id: trialId(plan.family, plan.strategy, plan.params),
    family: plan.family,
    strategy: plan.strategy,
    recordedAt: KRONOS_VOL_PROTOCOL.registeredAt,
    trials: 1,
    sharpe,
    periods,
    source: 'medido depois do pre-registro',
    params: plan.params
  });
}

function patchReport(
  directory: string,
  trialLog: string,
  rows: ValidationStrategy[],
  verdict: VolatilityBlock['kronosVerdict'],
  reason: string
): ValidationReport {
  const existing = readValidationReport(join(directory, 'validation-latest.json'));
  const base: ValidationReport = existing ?? {
    generatedAt: new Date().toISOString(),
    disclaimer: 'Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado. Isto não é conselho de investimento.',
    gates: {
      minIndependentDecisions: VALIDATION_GATES.minIndependentDecisions,
      deflatedSharpeMin: VALIDATION_GATES.deflatedSharpeMin,
      maxProbabilityOfOverfit: VALIDATION_GATES.maxProbabilityOfOverfit,
      directionalAlpha: VALIDATION_GATES.directionalAlpha
    },
    trialLog,
    trialsByFamily: {},
    datasets: [],
    strategies: [],
    notes: []
  };
  const previous = base.volatility;
  const skill = { verdict: previous?.skillVerdict ?? 'inconclusiva' as const, reason: previous?.skillReason ?? 'O estudo de HAR-RV ainda não foi rodado nesta máquina (`npm run validate -- --strategy vol`).' };
  const filter = { verdict: previous?.filterVerdict ?? 'inconclusiva' as const, reason: previous?.filterReason ?? 'O filtro de vol ainda não foi medido.' };
  const block: VolatilityBlock = {
    protocolId: VOL_PROTOCOL.id,
    registeredAt: VOL_PROTOCOL.registeredAt,
    skillVerdict: skill.verdict,
    skillReason: skill.reason,
    filterVerdict: filter.verdict,
    filterReason: filter.reason,
    headline: composeHeadline(skill, filter, reason),
    kronosVerdict: verdict,
    kronosReason: reason,
    cells: previous?.cells ?? [],
    filters: previous?.filters ?? []
  };
  const kept = base.strategies.filter(row => row.id !== 'kronos-vol' && row.id !== 'kronos-vol-naive');
  const report: ValidationReport = {
    ...base,
    // A patched report is a new report: the old timestamp would date this row wrongly.
    generatedAt: new Date().toISOString(),
    trialLog,
    strategies: [...kept, ...rows],
    notes: base.notes.some(note => note.startsWith('Volatilidade: Kronos-small'))
      ? base.notes.map(note => note.startsWith('Volatilidade: Kronos-small') ? `Volatilidade: Kronos-small ${reason}` : note)
      : [...base.notes, `Volatilidade: Kronos-small ${reason}`],
    volatility: block
  };
  writeValidationReport(report, directory);
  return report;
}

function inconclusiveRow(reason: string): ValidationStrategy {
  return {
    id: 'kronos-vol',
    family: volKronosFamily(),
    name: 'Kronos-small: dispersão como vol',
    verdict: 'inconclusiva',
    reason,
    note: 'Sem o checkout do Kronos e sem os pesos não há dispersão para comparar. O comando não inventa amostra.',
    metrics: null
  };
}

export async function runKronosVolValidation(options: {
  root?: string;
  trialLog?: string;
  reportDirectory?: string;
  modulePath?: string;
} = {}): Promise<ValidationReport> {
  const trialLog = options.trialLog ?? 'reports/trial-log.jsonl';
  const directory = options.reportDirectory ?? 'reports';
  const root = options.root ?? futuresRoot();
  const missing = 'O worker do Kronos não está nesta máquina. Rode bash scripts/setup-kronos.sh e depois `npm run validate -- --strategy kronos-vol`. Até lá o veredito fica inconclusivo.';
  if (!kronosCheckoutPresent(options.modulePath)) {
    const already = readTrials(trialLog).some(row => row.strategy === 'kronos-vol');
    if (!already) registerKronosTrials(trialLog);
    return patchReport(directory, trialLog, [inconclusiveRow(missing)], 'inconclusiva', missing);
  }
  registerKronosTrials(trialLog);
  const klines = readJsonl<KlineBar>(join(symbolDir(root, 'BTCUSDT'), 'klines-1h.jsonl'))
    .filter(bar => bar.openTime >= Date.parse(VOL_PROTOCOL.windowStart) && bar.openTime < Date.parse(VOL_PROTOCOL.windowEnd))
    .sort((a, b) => a.openTime - b.openTime);
  const funding = readJsonl<FundingPrint>(join(symbolDir(root, 'BTCUSDT'), 'funding.jsonl')).slice().sort((a, b) => a.time - b.time);
  if (klines.length < VOL_PROTOCOL.kronosContext + VOL_PROTOCOL.kronosHorizonBars + 2) {
    const reason = 'BTCUSDT não tem candles de 1h suficientes na janela congelada. Rode npm run futures:import antes do Kronos.';
    return patchReport(directory, trialLog, [inconclusiveRow(reason)], 'inconclusiva', reason);
  }
  const candles = klines.map(toCandle);
  const { sha, path: cacheFile } = kronosCacheFile(klines);
  const cache = loadForecastCache(cacheFile, sha);
  const horizon = VOL_PROTOCOL.kronosHorizonBars;
  const context = VOL_PROTOCOL.kronosContext;
  const stride = VOL_PROTOCOL.kronosStride;
  const indexes = kronosDecisionIndexes(klines);
  const kronos = new KronosProcess();
  try {
    await kronos.start();
    const fresh: CachedForecast[] = [];
    for (const index of indexes) {
      const openTime = klines[index].openTime;
      if (cache.has(openTime)) continue;
      const response = await kronos.infer({
        requestId: String(openTime),
        timestamp: openTime,
        interval: '1h',
        horizon,
        sampleCount: VOL_PROTOCOL.kronosSampleCount,
        candles: candles.slice(index - context + 1, index + 1)
      });
      const sampleEnds = Array.isArray(response.sampleEnds) ? (response.sampleEnds as number[]).map(Number) : [];
      if (sampleEnds.length < 2) throw new Error(`Previsão em ${openTime} não trouxe amostras suficientes.`);
      const row: CachedForecast = { openTime, meanCloses: response.predictions.map(Number), sampleEnds, datasetSha256: sha };
      cache.set(openTime, row);
      fresh.push(row);
      if (fresh.length >= 25) appendForecastCache(cacheFile, fresh.splice(0, fresh.length));
    }
    appendForecastCache(cacheFile, fresh);
  } catch (error) {
    const reason = `O worker não entregou a dispersão (${error instanceof Error ? error.message : String(error)}). Sem isso o Kronos-small continua inconclusivo.`;
    return patchReport(directory, trialLog, [inconclusiveRow(reason)], 'inconclusiva', reason);
  } finally {
    kronos.stop();
  }

  const observations = buildKronosObservations(klines, indexes, cache, funding);
  const judged = judgeKronosVol(observations);
  const skillVerdict = judged.verdict;
  const manifest = writeRunManifest(directory, {
    klinesFile: join(symbolDir(root, 'BTCUSDT'), 'klines-1h.jsonl'),
    cacheFile,
    forecasts: indexes.filter(index => cache.has(klines[index].openTime)).length,
    points: judged.points,
    verdict: skillVerdict,
    modulePath: options.modulePath
  });
  const skillSentence = `${judged.sentence} Proveniência em reports/kronos-vol-run.json (candles ${manifest.klinesSha256.slice(0, 12)}, cache ${manifest.cacheSha256?.slice(0, 12) ?? 'n/d'}, pesos ${manifest.modelRevision?.slice(0, 12) ?? 'n/d'}).`;

  if (funding.length === 0 || observations.length < VOL_PROTOCOL.minTestObservations) {
    const reason = `${skillSentence} O filtro não foi cobrado: ${funding.length === 0 ? 'falta o funding.' : 'amostra curta.'}`;
    return patchReport(directory, trialLog, [{
      ...inconclusiveRow(reason),
      verdict: skillVerdict === 'aprovada' ? 'inconclusiva' : skillVerdict,
      reason
    }], skillVerdict, reason);
  }

  const readyAt = expandingHigh(observations.map(row => row.forecast));
  const naiveHigh = expandingHigh(observations.map(row => row.naive));
  const used = observations.filter((_, index) => readyAt[index] !== undefined && observations.slice(0, index).length >= VOL_PROTOCOL.minTrainForecasts);
  const usedFlags = readyAt.filter((_, index) => index >= VOL_PROTOCOL.minTrainForecasts);
  const usedNaive = naiveHigh.filter((_, index) => index >= VOL_PROTOCOL.minTrainForecasts);
  const decisions = used.map(asDecision);
  const benchmark = exposureReturns(decisions, decisions.map(() => 1));
  const periodMs = horizon * HOUR_MS;
  const makeSeries = (id: string, name: string, note: string, weights: number[]): StrategySeries => ({
    id,
    family: volKronosFamily(),
    name,
    note,
    returns: exposureReturns(decisions, weights),
    benchmarkReturns: benchmark,
    decisions: decisions.map((_, index) => ({ index, predicted: null, probabilityUp: null, actual: 0, wentUp: null })),
    horizon: 1,
    stride: 1,
    periodMs,
    hasDirection: false,
    hasProbability: false
  });
  const series = [
    makeSeries(
      'kronos-vol',
      'Kronos-small: filtro quando a dispersão está alta',
      `Fica zerado quando a variância das amostras passa do percentil 80 das previsões já vistas, com pelo menos ${VOL_PROTOCOL.minTrainForecasts} previsões anteriores. O peso não usa o futuro. ${skillSentence}`,
      usedFlags.map(high => high ? 0 : 1)
    ),
    makeSeries(
      'kronos-vol-naive',
      'Kronos 6h: filtro da vol realizada de 24h',
      'O mesmo filtro, com a vol realizada das últimas 24 horas no lugar da dispersão. Serve de comparação e entra no PBO.',
      usedNaive.map(high => high ? 0 : 1)
    )
  ];
  const evaluations = evaluateFamily(series, readTrials(trialLog).filter(entry => entry.family === volKronosFamily()));
  const strategies: ValidationStrategy[] = evaluations.map((evaluation, index) => {
    const test = outerTestIndexes(series[index].returns.length);
    const drawdown = maxDrawdownPct(test.map(slot => series[index].returns[slot]));
    const holdDrawdown = maxDrawdownPct(test.map(slot => benchmark[slot]));
    remember(trialLog, evaluation.id, evaluation.metrics.sharpePerPeriod, evaluation.metrics.observations);
    return {
      id: evaluation.id,
      family: evaluation.family,
      name: evaluation.name,
      verdict: evaluation.verdict.label,
      reason: evaluation.verdict.reason,
      note: `${evaluation.note} Drawdown máximo no teste: ${fmt(drawdown)}%. Comprar e segurar no mesmo teste: ${fmt(holdDrawdown)}%.`,
      metrics: evaluation.metrics
    };
  });
  const filterSentence = strategies.map(row => `${row.name}: ${row.verdict}, excesso ${fmt(row.metrics?.excessReturnPct)}%.`).join(' ');
  const reason = `${skillSentence} ${filterSentence}`;
  return patchReport(directory, trialLog, strategies, skillVerdict, reason);
}
