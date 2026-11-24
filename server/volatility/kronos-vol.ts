import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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
import { coverageRate, dieboldMariano, empiricalQuantile, maxDrawdownPct, mse, qlike } from './losses';
import { VOL_PROTOCOL, volKronosFamily, volTrialPlans } from './protocol';
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
  return Math.max(VOL_PROTOCOL.varianceFloor, variance);
}

interface KronosObservation {
  openTime: number;
  priceReturn: number;
  fundingPaidByLong: number;
  forecast: number;
  naive: number;
  realized: number;
  absolute: number;
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
  for (const plan of volTrialPlans().filter(item => item.family === volKronosFamily())) {
    upsertTrial(trialLog, {
      id: trialId(plan.family, plan.strategy, plan.params),
      family: plan.family,
      strategy: plan.strategy,
      recordedAt: VOL_PROTOCOL.registeredAt,
      trials: 1,
      sharpe: null,
      periods: null,
      source: 'pre-registro antes do teste',
      params: plan.params
    });
  }
}

function remember(trialLog: string, strategy: string, sharpe: number | null, periods: number | null): void {
  const plan = volTrialPlans().find(item => item.strategy === strategy);
  if (!plan) return;
  upsertTrial(trialLog, {
    id: trialId(plan.family, plan.strategy, plan.params),
    family: plan.family,
    strategy: plan.strategy,
    recordedAt: VOL_PROTOCOL.registeredAt,
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
  const sha = datasetKey(klines);
  const cacheFile = join('data', 'research-cache', `BTCUSDT_1h_vol_kronos_${sha.slice(0, 12)}.jsonl`);
  const cache = loadForecastCache(cacheFile, sha);
  const horizon = VOL_PROTOCOL.kronosHorizonBars;
  const context = VOL_PROTOCOL.kronosContext;
  const stride = VOL_PROTOCOL.kronosStride;
  const indexes: number[] = [];
  for (let index = context - 1; index + horizon < klines.length; index += stride) {
    if (klines[index].openTime - klines[index - horizon].openTime !== horizon * HOUR_MS) continue;
    if (klines[index + horizon].openTime - klines[index].openTime !== horizon * HOUR_MS) continue;
    indexes.push(index);
  }
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

  const observations: KronosObservation[] = [];
  for (const index of indexes) {
    const cached = cache.get(klines[index].openTime);
    if (!cached) continue;
    const forecast = sampleVarianceForecast(klines[index].close, cached.sampleEnds);
    const previous = klines[index - horizon].close;
    const next = klines[index + horizon].close;
    const entry = klines[index].close;
    if (forecast === null || !(previous > 0) || !(next > 0) || !(entry > 0)) continue;
    const past = Math.log(entry / previous);
    const ahead = Math.log(next / entry);
    observations.push({
      openTime: klines[index].openTime,
      priceReturn: next / entry - 1,
      fundingPaidByLong: fundingBetween(funding, klines[index].closeTime, klines[index + horizon].closeTime),
      forecast,
      naive: Math.max(VOL_PROTOCOL.varianceFloor, past * past),
      realized: ahead * ahead,
      absolute: Math.abs(ahead)
    });
  }
  const modelLoss = observations.map(row => qlike(row.forecast, row.realized)).filter((value): value is number => value !== null);
  const baseLoss = observations.map(row => qlike(row.naive, row.realized)).filter((value): value is number => value !== null);
  const dm = dieboldMariano(
    observations.map(row => qlike(row.forecast, row.realized) ?? Number.NaN),
    observations.map(row => qlike(row.naive, row.realized) ?? Number.NaN),
    VOL_PROTOCOL.dmLag,
    VOL_PROTOCOL.dmHorizon
  );
  const qlikeModel = mean(modelLoss);
  const qlikeBase = mean(baseLoss);
  const mseModel = mean(observations.map(row => mse(row.forecast, row.realized) ?? Number.NaN));
  const rank = spearmanTest(observations.map(row => row.forecast), observations.map(row => row.realized));
  const cover80 = coverageRate(observations.map(row => row.absolute), observations.map(row => row.forecast), 0.8);
  const cover95 = coverageRate(observations.map(row => row.absolute), observations.map(row => row.forecast), 0.95);
  const enough = observations.length >= VOL_PROTOCOL.minTestObservations && qlikeModel !== null && qlikeBase !== null;
  const beats = enough && (qlikeModel as number) < (qlikeBase as number) && dm.pValue !== null && dm.pValue < VOL_PROTOCOL.dmAlpha;
  const skillVerdict: VolatilityBlock['kronosVerdict'] = !enough ? 'inconclusiva' : beats ? 'aprovada' : 'reprovada';
  const skillSentence = !enough
    ? `A dispersão do Kronos-small não fechou 30 pontos comparáveis (há ${observations.length}).`
    : `QLIKE da dispersão ${fmt(qlikeModel, 4)} contra ${fmt(qlikeBase, 4)} da vol recente do bloco anterior. p de Diebold-Mariano ${fmt(dm.pValue, 4)}. MSE ${fmt(mseModel, 8)}. Correlação de rank ${fmt(rank.coefficient, 3)} (p=${fmt(rank.pValue, 4)}). Cobertura 80% ${cover80 === null ? 'n/d' : fmt(cover80 * 100, 1) + '%'}, 95% ${cover95 === null ? 'n/d' : fmt(cover95 * 100, 1) + '%'}. O alvo é o quadrado do log-retorno de ${horizon} horas, que é o horizonte do modelo, não 4h nem 24h.`;

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
      'Kronos 6h: filtro da vol recente',
      'O mesmo filtro, com o quadrado do log-retorno do bloco anterior no lugar da dispersão. Serve de comparação e entra no PBO.',
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
