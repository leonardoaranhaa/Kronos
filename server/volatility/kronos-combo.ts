import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadForecastCache } from '../forecast-cache';
import type { FundingPrint, KlineBar } from '../futures/parse';
import { futuresRoot, symbolDir } from '../futures/paths';
import { readJsonl } from '../futures/store';
import { readTrials, trialId, upsertTrial } from '../validation/trials';
import { buildKronosObservations, judgeKronosVol, kronosCacheFile, kronosDecisionIndexes, type KronosObservation } from './kronos-vol';
import { dieboldMariano, qlike } from './losses';
import { fitRidgeVol, predictRidgeVol } from './models';
import { KRONOS_VOL_PROTOCOL, VOL_PROTOCOL, kronosVolFloor, volKronosFamily } from './protocol';

/**
 * Phase 2 of docs/PLANO.md. Does the Kronos dispersion add anything the HAR-RV does not have?
 * Frozen before it was scored. Same points, same target and same cache as kronos-vol-v2.
 *
 * base:  log RV(next 6h) ~ log rvDay + log rvWeek + log rvMonth          (ridge, standardized, λ = 1)
 * combo: the same regressors + log(Kronos sample variance)
 * Both refit at every decision on earlier decisions only (labels closed: stride 12 > horizon 6),
 * both forecast exp(xβ) with the same floor. The only difference is the Kronos column.
 *
 * Passes only if the combo has lower mean QLIKE than the base, one-sided Diebold-Mariano
 * p < 0.05, on at least 30 points. Counted as one trial in the vol-kronos family.
 */
export const KRONOS_COMBO_PROTOCOL = Object.freeze({
  id: 'kronos-combo-v1',
  registeredAt: '2026-11-28T09:42:00.000Z',
  base: KRONOS_VOL_PROTOCOL.id,
  minTrainRows: VOL_PROTOCOL.minTrainRows,
  minTestObservations: KRONOS_VOL_PROTOCOL.minTestObservations,
  dmAlpha: KRONOS_VOL_PROTOCOL.dmAlpha
});

export interface ComboResult {
  verdict: 'aprovada' | 'reprovada' | 'inconclusiva';
  points: number;
  qlikeCombo: number | null;
  qlikeBase: number | null;
  pValue: number | null;
  /** Standardized coefficient of log Kronos in the last combo fit. */
  kronosBeta: number | null;
  sentence: string;
}

function baseRow(row: KronosObservation): number[] | null {
  const values = [row.harDay, row.harWeek, row.harMonth];
  if (values.some(value => !(value > 0))) return null;
  return values.map(value => Math.log(value));
}

function comboRow(row: KronosObservation): number[] | null {
  const base = baseRow(row);
  return base && row.forecast > 0 ? [...base, Math.log(row.forecast)] : null;
}

function floor(value: number | null): number | null {
  return value === null ? null : Math.max(kronosVolFloor(), value);
}

function mean(values: readonly number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export function scoreKronosCombo(rows: readonly KronosObservation[]): ComboResult {
  const comboLoss: number[] = [];
  const baseLoss: number[] = [];
  let kronosBeta: number | null = null;
  for (let index = KRONOS_COMBO_PROTOCOL.minTrainRows; index < rows.length; index++) {
    const train = rows.slice(0, index);
    const basePairs = train.map(row => ({ x: baseRow(row), y: row.realized })).filter(pair => pair.x !== null);
    const comboPairs = train.map(row => ({ x: comboRow(row), y: row.realized })).filter(pair => pair.x !== null);
    const baseModel = fitRidgeVol(basePairs.map(pair => pair.x as number[]), basePairs.map(pair => pair.y));
    const comboModel = fitRidgeVol(comboPairs.map(pair => pair.x as number[]), comboPairs.map(pair => pair.y));
    const xb = baseRow(rows[index]);
    const xc = comboRow(rows[index]);
    if (!baseModel || !comboModel || !xb || !xc) continue;
    const fb = floor(predictRidgeVol(baseModel, xb));
    const fc = floor(predictRidgeVol(comboModel, xc));
    if (fb === null || fc === null) continue;
    const lb = qlike(fb, rows[index].realized);
    const lc = qlike(fc, rows[index].realized);
    if (lb === null || lc === null) continue;
    baseLoss.push(lb);
    comboLoss.push(lc);
    kronosBeta = comboModel.beta[comboModel.beta.length - 1] ?? null;
  }
  const points = comboLoss.length;
  const qlikeCombo = mean(comboLoss);
  const qlikeBase = mean(baseLoss);
  const dm = dieboldMariano(comboLoss, baseLoss, KRONOS_VOL_PROTOCOL.dmLag, KRONOS_VOL_PROTOCOL.dmHorizon);
  const enough = points >= KRONOS_COMBO_PROTOCOL.minTestObservations && qlikeCombo !== null && qlikeBase !== null;
  const verdict = !enough
    ? 'inconclusiva'
    : (qlikeCombo as number) < (qlikeBase as number) && dm.pValue !== null && dm.pValue < KRONOS_COMBO_PROTOCOL.dmAlpha
      ? 'aprovada'
      : 'reprovada';
  const f = (value: number | null, digits = 4) => value === null ? 'n/d' : value.toFixed(digits);
  const sentence = `Protocolo ${KRONOS_COMBO_PROTOCOL.id}, ${points} pontos. HAR em log com o Kronos: QLIKE ${f(qlikeCombo)}; sem o Kronos: ${f(qlikeBase)}; p de Diebold-Mariano ${f(dm.pValue)}. Coeficiente padronizado do log da dispersão no último ajuste: ${f(kronosBeta, 3)}.`;
  return { verdict, points, qlikeCombo, qlikeBase, pValue: dm.pValue, kronosBeta, sentence };
}

function planParams(): Record<string, unknown> {
  return {
    protocol: KRONOS_COMBO_PROTOCOL.id,
    registeredAt: KRONOS_COMBO_PROTOCOL.registeredAt,
    base: KRONOS_COMBO_PROTOCOL.base,
    kind: 'kronos-combinacao',
    symbol: 'BTCUSDT',
    horizon: KRONOS_VOL_PROTOCOL.horizonBars,
    model: 'har-log+kronos'
  };
}

export function registerComboTrial(trialLog: string, sharpe: number | null = null, periods: number | null = null, measured = false): void {
  const params = planParams();
  upsertTrial(trialLog, {
    id: trialId(volKronosFamily(), 'kronos-combo', params),
    family: volKronosFamily(),
    strategy: 'kronos-combo',
    recordedAt: KRONOS_COMBO_PROTOCOL.registeredAt,
    trials: 1,
    sharpe,
    periods,
    source: measured ? 'habilidade medida depois do pre-registro, sem Sharpe de operação' : 'pre-registro antes do teste',
    params
  });
}

export function runKronosCombo(options: { root?: string; trialLog?: string } = {}): ComboResult {
  const trialLog = options.trialLog ?? 'reports/trial-log.jsonl';
  if (!readTrials(trialLog).some(row => row.strategy === 'kronos-combo')) registerComboTrial(trialLog);
  const root = options.root ?? futuresRoot();
  const klines = readJsonl<KlineBar>(join(symbolDir(root, 'BTCUSDT'), 'klines-1h.jsonl'))
    .filter(bar => bar.openTime >= Date.parse(VOL_PROTOCOL.windowStart) && bar.openTime < Date.parse(VOL_PROTOCOL.windowEnd))
    .sort((a, b) => a.openTime - b.openTime);
  const funding = readJsonl<FundingPrint>(join(symbolDir(root, 'BTCUSDT'), 'funding.jsonl'));
  const cache = loadForecastCache(kronosCacheFile(klines).path, kronosCacheFile(klines).sha);
  const rows = buildKronosObservations(klines, kronosDecisionIndexes(klines), cache, funding);
  const result = scoreKronosCombo(rows);
  registerComboTrial(trialLog, null, result.points, true);
  return result;
}

/**
 * The 4-path variance has ~80% relative error; it may hide a real signal. This re-runs both
 * Kronos gates, unchanged, on 32 paths per decision (same seed rule, T and top_p, same points).
 * Frozen before the 32-path cache existed. Two trials in vol-kronos: kronos-vol-s32, kronos-combo-s32.
 */
export const KRONOS_S32_PROTOCOL = Object.freeze({
  id: 'kronos-s32-v1',
  registeredAt: '2026-11-28T09:45:00.000Z',
  sampleCount: 32,
  gates: [KRONOS_VOL_PROTOCOL.id, KRONOS_COMBO_PROTOCOL.id]
});

function s32Params(strategy: string): Record<string, unknown> {
  return {
    protocol: KRONOS_S32_PROTOCOL.id,
    registeredAt: KRONOS_S32_PROTOCOL.registeredAt,
    sampleCount: KRONOS_S32_PROTOCOL.sampleCount,
    gate: strategy === 'kronos-vol-s32' ? KRONOS_VOL_PROTOCOL.id : KRONOS_COMBO_PROTOCOL.id,
    symbol: 'BTCUSDT',
    horizon: KRONOS_VOL_PROTOCOL.horizonBars
  };
}

export function registerS32Trials(trialLog: string, points: number | null = null, measured = false): void {
  for (const strategy of ['kronos-vol-s32', 'kronos-combo-s32']) {
    const params = s32Params(strategy);
    upsertTrial(trialLog, {
      id: trialId(volKronosFamily(), strategy, params),
      family: volKronosFamily(),
      strategy,
      recordedAt: KRONOS_S32_PROTOCOL.registeredAt,
      trials: 1,
      sharpe: null,
      periods: points,
      source: measured ? 'habilidade medida depois do pre-registro, sem Sharpe de operação' : 'pre-registro antes do teste',
      params
    });
  }
}

function frozenKlines(root: string): KlineBar[] {
  return readJsonl<KlineBar>(join(symbolDir(root, 'BTCUSDT'), 'klines-1h.jsonl'))
    .filter(bar => bar.openTime >= Date.parse(VOL_PROTOCOL.windowStart) && bar.openTime < Date.parse(VOL_PROTOCOL.windowEnd))
    .sort((a, b) => a.openTime - b.openTime);
}

/** Job file for scripts/kronos-dispersion-cache.py. */
export function writeS32Job(options: { root?: string; file?: string } = {}): string {
  const root = options.root ?? futuresRoot();
  const klines = frozenKlines(root);
  const cache = kronosCacheFile(klines, KRONOS_S32_PROTOCOL.sampleCount);
  const file = options.file ?? join('data', 'research-cache', 'kronos-s32-job.json');
  mkdirSync(join('data', 'research-cache'), { recursive: true });
  writeFileSync(file, JSON.stringify({
    klinesFile: join(symbolDir(root, 'BTCUSDT'), 'klines-1h.jsonl'),
    windowStartMs: Date.parse(VOL_PROTOCOL.windowStart),
    windowEndMs: Date.parse(VOL_PROTOCOL.windowEnd),
    openTimes: kronosDecisionIndexes(klines).map(index => klines[index].openTime),
    context: VOL_PROTOCOL.kronosContext,
    horizon: VOL_PROTOCOL.kronosHorizonBars,
    sampleCount: KRONOS_S32_PROTOCOL.sampleCount,
    datasetSha256: cache.sha,
    cacheFile: cache.path
  }));
  return file;
}

export function runKronosS32(options: { root?: string; trialLog?: string } = {}): { skill: ReturnType<typeof judgeKronosVol>; combo: ComboResult; forecasts: number; expected: number } {
  const trialLog = options.trialLog ?? 'reports/trial-log.jsonl';
  registerS32Trials(trialLog);
  const root = options.root ?? futuresRoot();
  const klines = frozenKlines(root);
  const funding = readJsonl<FundingPrint>(join(symbolDir(root, 'BTCUSDT'), 'funding.jsonl'));
  const file = kronosCacheFile(klines, KRONOS_S32_PROTOCOL.sampleCount);
  const cache = loadForecastCache(file.path, file.sha);
  const indexes = kronosDecisionIndexes(klines);
  const forecasts = indexes.filter(index => cache.has(klines[index].openTime)).length;
  const rows = buildKronosObservations(klines, indexes, cache, funding);
  const skill = judgeKronosVol(rows);
  const combo = scoreKronosCombo(rows);
  // A partial cache is not a measurement: only a full one is recorded as measured.
  if (forecasts === indexes.length) registerS32Trials(trialLog, rows.length, true);
  return { skill, combo, forecasts, expected: indexes.length };
}
