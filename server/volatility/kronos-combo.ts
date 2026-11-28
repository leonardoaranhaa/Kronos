import { join } from 'node:path';
import { loadForecastCache } from '../forecast-cache';
import type { FundingPrint, KlineBar } from '../futures/parse';
import { futuresRoot, symbolDir } from '../futures/paths';
import { readJsonl } from '../futures/store';
import { readTrials, trialId, upsertTrial } from '../validation/trials';
import { buildKronosObservations, kronosCacheFile, kronosDecisionIndexes, type KronosObservation } from './kronos-vol';
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
