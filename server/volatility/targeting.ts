import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { FundingPrint, KlineBar } from '../futures/parse';
import { symbolDir } from '../futures/paths';
import { readJsonl } from '../futures/store';
import { returnMoments } from '../validation/moments';
import { annualizeSharpe, deflatedSharpeRatio, sharpeRatio } from '../validation/sharpe';
import type { ValidationReport } from '../validation/report';
import { buildVolSample, type VolDecision } from './build';
import { maxDrawdownPct, median } from './losses';
import { fitHar, predictHar } from './models';
import { VOL_PROTOCOL, volStrategyId } from './protocol';
import { exposureReturns, outerTestIndexes, scoreVolPoints } from './study';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Phase 3/4 of docs/PLANO.md: volatility targeting on buy-and-hold.
 *
 * The book is the one vol-v1 already called "tamanho pela vol (HAR-RV) em comprar e segurar":
 * weight = min(1, median HAR forecast of the training rows / HAR forecast now), long only,
 * fee and slippage on every weight change, funding paid by the long.
 *
 * The gate is new and fixed here. The historical window (2024-11 → 2026-11) was already
 * scored with this book under the old gate, so its numbers under the new gate are
 * RETROSPECTIVE: published, never a decision. The decision is the forward window, which
 * starts after this file was committed and uses the same book with an expanding HAR fit.
 *
 * Gate, per cell (BTC, ETH, SOL × 4h, 24h), all six must pass:
 *   annualized Sharpe above buy-and-hold's on the same returns,
 *   max drawdown below buy-and-hold's,
 *   deflated Sharpe ≥ 0.95,
 *   PBO < 0.50 (retrospective only: the forward book was chosen before its data, there is
 *   no selection inside it to measure), and at least 30 returns.
 *
 * Forward: interim report at 90 days (published, decides nothing), final verdict at 365 days.
 * 90 days of 4-hour returns cannot separate a Sharpe gap of a few tenths from noise;
 * the 365-day checkpoint is fixed now, before any forward data exists.
 */
export const VOL_TARGET_PROTOCOL = Object.freeze({
  id: 'vol-target-v1',
  registeredAt: '2026-11-28T09:35:00.000Z',
  symbols: VOL_PROTOCOL.symbols,
  horizons: VOL_PROTOCOL.horizons,
  model: 'har' as const,
  historyStart: VOL_PROTOCOL.windowStart,
  retrospectiveEnd: VOL_PROTOCOL.windowEnd,
  forwardStart: '2026-11-29T00:00:00.000Z',
  interimDays: 90,
  finalDays: 365,
  /** A forward decision trains on decisions whose label closed at least one block earlier. */
  embargoSteps: 1,
  minTrainRows: VOL_PROTOCOL.minTrainRows,
  minObservations: VOL_PROTOCOL.minTestObservations,
  deflatedSharpeMin: 0.95,
  maxProbabilityOfOverfit: 0.5,
  /** One pre-registered hypothesis per cell. */
  forwardTrials: VOL_PROTOCOL.symbols.length * VOL_PROTOCOL.horizons.length
});

export type TargetVerdict = 'aprovada' | 'reprovada' | 'inconclusiva' | 'aguardando';

export interface TargetCell {
  symbol: string;
  horizonHours: number;
  observations: number;
  sharpe: number | null;
  holdSharpe: number | null;
  maxDrawdownPct: number | null;
  holdDrawdownPct: number | null;
  returnPct: number | null;
  holdReturnPct: number | null;
  averageWeight: number | null;
  deflatedSharpeRatio: number | null;
  probabilityOfBacktestOverfitting: number | null;
  verdict: TargetVerdict;
  reason: string;
}

export interface TargetGateInput {
  observations: number;
  sharpe: number | null;
  holdSharpe: number | null;
  maxDrawdownPct: number | null;
  holdDrawdownPct: number | null;
  deflatedSharpeRatio: number | null;
  /** Null in the forward book, where the gate does not use it. */
  probabilityOfBacktestOverfitting: number | null;
  usePbo: boolean;
}

const fmt = (value: number | null, digits = 2) => value === null ? 'n/d' : value.toFixed(digits);

export function judgeVolTarget(input: TargetGateInput): { verdict: Exclude<TargetVerdict, 'aguardando'>; reason: string } {
  const missing = input.observations < VOL_TARGET_PROTOCOL.minObservations
    || input.sharpe === null || input.holdSharpe === null
    || input.maxDrawdownPct === null || input.holdDrawdownPct === null
    || input.deflatedSharpeRatio === null
    || (input.usePbo && input.probabilityOfBacktestOverfitting === null);
  if (missing) {
    return { verdict: 'inconclusiva', reason: `Faltou série ou amostra (${input.observations} retornos; mínimo ${VOL_TARGET_PROTOCOL.minObservations}).` };
  }
  const failures: string[] = [];
  if (!((input.sharpe as number) > (input.holdSharpe as number))) failures.push(`Sharpe ${fmt(input.sharpe)} não passa o de comprar e segurar (${fmt(input.holdSharpe)})`);
  if (!((input.maxDrawdownPct as number) < (input.holdDrawdownPct as number))) failures.push(`drawdown ${fmt(input.maxDrawdownPct)}% não fica abaixo do de comprar e segurar (${fmt(input.holdDrawdownPct)}%)`);
  if (!((input.deflatedSharpeRatio as number) >= VOL_TARGET_PROTOCOL.deflatedSharpeMin)) failures.push(`DSR ${fmt(input.deflatedSharpeRatio, 3)} abaixo de ${VOL_TARGET_PROTOCOL.deflatedSharpeMin}`);
  if (input.usePbo && !((input.probabilityOfBacktestOverfitting as number) < VOL_TARGET_PROTOCOL.maxProbabilityOfOverfit)) failures.push(`PBO ${fmt(input.probabilityOfBacktestOverfitting, 3)} não fica abaixo de ${VOL_TARGET_PROTOCOL.maxProbabilityOfOverfit}`);
  if (failures.length === 0) {
    return { verdict: 'aprovada', reason: `Sharpe ${fmt(input.sharpe)} contra ${fmt(input.holdSharpe)}, drawdown ${fmt(input.maxDrawdownPct)}% contra ${fmt(input.holdDrawdownPct)}%, DSR ${fmt(input.deflatedSharpeRatio, 3)}.` };
  }
  return { verdict: 'reprovada', reason: `${failures.join('; ')}.` };
}

/** Six cells, every one must pass. One cell short of data makes the whole thing inconclusive. */
export function judgeTargetBook(cells: readonly Pick<TargetCell, 'verdict'>[]): TargetVerdict {
  const expected = VOL_TARGET_PROTOCOL.symbols.length * VOL_TARGET_PROTOCOL.horizons.length;
  if (cells.length < expected || cells.some(cell => cell.verdict === 'inconclusiva')) return 'inconclusiva';
  if (cells.some(cell => cell.verdict === 'aguardando')) return 'aguardando';
  return cells.every(cell => cell.verdict === 'aprovada') ? 'aprovada' : 'reprovada';
}

function compoundPct(returns: readonly number[]): number | null {
  if (returns.length === 0) return null;
  let equity = 1;
  for (const value of returns) equity *= 1 + value;
  return (equity - 1) * 100;
}

function annualSharpe(returns: readonly number[], periodMs: number): number | null {
  const perPeriod = sharpeRatio(returns);
  return perPeriod === null ? null : annualizeSharpe(perPeriod, periodMs);
}

function averageOf(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Written by npm run vol-target:import, next to the frozen-window files. */
export const FORWARD_KLINES = 'klines-1h-forward.jsonl';
export const FORWARD_FUNDING = 'funding-forward.jsonl';

function merged<T>(rows: readonly T[], key: (row: T) => number): T[] {
  return [...new Map(rows.map(row => [key(row), row])).values()].sort((a, b) => key(a) - key(b));
}

/** Frozen window plus forward files. buildVolSample cuts each book to its own window. */
function loadSeries(root: string, symbol: string): { klines: KlineBar[]; funding: FundingPrint[] } {
  const directory = symbolDir(root, symbol);
  const klines = merged([
    ...readJsonl<KlineBar>(join(directory, 'klines-1h.jsonl')),
    ...readJsonl<KlineBar>(join(directory, FORWARD_KLINES))
  ], bar => bar.openTime);
  const funding = merged([
    ...readJsonl<FundingPrint>(join(directory, 'funding.jsonl')),
    ...readJsonl<FundingPrint>(join(directory, FORWARD_FUNDING))
  ], print => print.time);
  return { klines, funding };
}

/**
 * The historical book exactly as vol-v1 scored it (same walk-forward, same weights),
 * read under the new gate. DSR and PBO come from the published vol-v1 row, which carries
 * the full trial count of the family. Sharpe and drawdown are recomputed here and the
 * strategy Sharpe is checked against the published one.
 */
export function retrospectiveCells(root: string, report: ValidationReport | null): TargetCell[] {
  const cells: TargetCell[] = [];
  for (const symbol of VOL_TARGET_PROTOCOL.symbols) {
    const { klines, funding } = loadSeries(root, symbol);
    for (const horizon of VOL_TARGET_PROTOCOL.horizons) {
      const base = { symbol, horizonHours: horizon };
      if (klines.length === 0 || funding.length === 0) {
        cells.push(emptyCell(base, 'inconclusiva', 'Sem candles ou sem funding nesta máquina. Rode npm run futures:import.'));
        continue;
      }
      const sample = buildVolSample({ klines, funding, horizonHours: horizon });
      const points = scoreVolPoints(sample.decisions, sample.hourlyReturns, horizon);
      const decisions = points.map(point => point.decision);
      const weights = points.map(point => point.models.har.forecast === null ? 0 : point.models.har.weight);
      const returns = exposureReturns(decisions, weights);
      const hold = exposureReturns(decisions, decisions.map(() => 1));
      const test = outerTestIndexes(returns.length);
      const testReturns = test.map(slot => returns[slot]);
      const testHold = test.map(slot => hold[slot]);
      const periodMs = horizon * HOUR_MS;
      const published = report?.volatility?.filters.find(row => row.id === volStrategyId(symbol, horizon, 'dimensionar', 'har', 'segurar')) ?? null;
      const sharpe = annualSharpe(testReturns, periodMs);
      const input: TargetGateInput = {
        observations: testReturns.length,
        sharpe,
        holdSharpe: annualSharpe(testHold, periodMs),
        maxDrawdownPct: maxDrawdownPct(testReturns),
        holdDrawdownPct: maxDrawdownPct(testHold),
        deflatedSharpeRatio: published?.deflatedSharpeRatio ?? null,
        probabilityOfBacktestOverfitting: published?.probabilityOfBacktestOverfitting ?? null,
        usePbo: true
      };
      const judged = judgeVolTarget(input);
      const check = published?.sharpe === null || published?.sharpe === undefined || sharpe === null
        ? 'Sem Sharpe publicado para conferir.'
        : Math.abs(published.sharpe - sharpe) < 0.01
          ? `Sharpe da estratégia reproduzido (publicado ${fmt(published.sharpe)}).`
          : `ATENÇÃO: Sharpe recalculado ${fmt(sharpe)} difere do publicado ${fmt(published.sharpe)}.`;
      cells.push({
        ...base,
        observations: input.observations,
        sharpe: input.sharpe,
        holdSharpe: input.holdSharpe,
        maxDrawdownPct: input.maxDrawdownPct,
        holdDrawdownPct: input.holdDrawdownPct,
        returnPct: compoundPct(testReturns),
        holdReturnPct: compoundPct(testHold),
        averageWeight: averageOf(test.map(slot => weights[slot])),
        deflatedSharpeRatio: input.deflatedSharpeRatio,
        probabilityOfBacktestOverfitting: input.probabilityOfBacktestOverfitting,
        verdict: judged.verdict,
        reason: `${judged.reason} ${check}`
      });
    }
  }
  return cells;
}

function emptyCell(base: { symbol: string; horizonHours: number }, verdict: TargetVerdict, reason: string): TargetCell {
  return {
    ...base,
    observations: 0,
    sharpe: null,
    holdSharpe: null,
    maxDrawdownPct: null,
    holdDrawdownPct: null,
    returnPct: null,
    holdReturnPct: null,
    averageWeight: null,
    deflatedSharpeRatio: null,
    probabilityOfBacktestOverfitting: null,
    verdict,
    reason
  };
}

/**
 * Weight at every decision from `startIndex` on. Each fit uses only decisions whose
 * 1-block label closed at least `embargoSteps` blocks before this one.
 */
export function expandingHarWeights(decisions: readonly VolDecision[], startIndex: number): (number | null)[] {
  const weights: (number | null)[] = [];
  for (let index = startIndex; index < decisions.length; index++) {
    const train = decisions.slice(0, Math.max(0, index - VOL_TARGET_PROTOCOL.embargoSteps));
    if (train.length < VOL_TARGET_PROTOCOL.minTrainRows) {
      weights.push(null);
      continue;
    }
    const model = fitHar(
      train.map(row => row.rvDay),
      train.map(row => row.rvWeek),
      train.map(row => row.rvMonth),
      train.map(row => row.realizedVariance)
    );
    if (!model) {
      weights.push(null);
      continue;
    }
    const fitted = train
      .map(row => predictHar(model, row.rvDay, row.rvWeek, row.rvMonth))
      .filter((value): value is number => value !== null && value > 0);
    const scale = median(fitted);
    const now = predictHar(model, decisions[index].rvDay, decisions[index].rvWeek, decisions[index].rvMonth);
    weights.push(scale === null || now === null || !(now > 0) ? null : Math.min(1, scale / now));
  }
  return weights;
}

/**
 * Forward cell. Decisions open at or after `forwardStart`; their labels must close before
 * `asOfMs` and inside the funding already published. Before `interimDays` the cell is
 * 'aguardando'; between interim and final the numbers are published as an interim reading.
 */
export function forwardCell(input: {
  klines: readonly KlineBar[];
  funding: readonly FundingPrint[];
  symbol: string;
  horizonHours: number;
  asOfMs: number;
}): TargetCell & { stage: 'aguardando' | 'interina' | 'final'; elapsedDays: number } {
  const start = Date.parse(VOL_TARGET_PROTOCOL.forwardStart);
  const fundingEnd = input.funding.length ? input.funding[input.funding.length - 1].time : -Infinity;
  // A block is scored only when its whole label is inside the published funding.
  const usableEnd = Math.min(input.asOfMs, fundingEnd + 1);
  const elapsedDays = Math.max(0, (usableEnd - start) / DAY_MS);
  const finalEnd = start + VOL_TARGET_PROTOCOL.finalDays * DAY_MS;
  const sample = buildVolSample({
    klines: input.klines,
    funding: input.funding,
    horizonHours: input.horizonHours,
    windowStartMs: Date.parse(VOL_TARGET_PROTOCOL.historyStart),
    windowEndMs: Math.min(usableEnd, finalEnd)
  });
  const decisions = sample.decisions;
  const first = decisions.findIndex(row => row.openTime >= start);
  const base = { symbol: input.symbol, horizonHours: input.horizonHours };
  const stage = elapsedDays >= VOL_TARGET_PROTOCOL.finalDays ? 'final' : elapsedDays >= VOL_TARGET_PROTOCOL.interimDays ? 'interina' : 'aguardando';
  if (first < 0) {
    return { ...emptyCell(base, 'aguardando', `Nenhum bloco de ${input.horizonHours}h fechado depois de ${VOL_TARGET_PROTOCOL.forwardStart} com funding publicado.`), stage: 'aguardando', elapsedDays };
  }
  const forward = decisions.slice(first);
  const raw = expandingHarWeights(decisions, first);
  const weights = raw.map(value => value ?? 0);
  const returns = exposureReturns(forward, weights);
  const hold = exposureReturns(forward, forward.map(() => 1));
  const periodMs = input.horizonHours * HOUR_MS;
  const moments = returnMoments(returns);
  const deflated = moments
    ? deflatedSharpeRatio({ returns, trials: VOL_TARGET_PROTOCOL.forwardTrials, skew: moments.skew, kurtosis: moments.kurtosis })
    : null;
  const gate: TargetGateInput = {
    observations: returns.length,
    sharpe: annualSharpe(returns, periodMs),
    holdSharpe: annualSharpe(hold, periodMs),
    maxDrawdownPct: maxDrawdownPct(returns),
    holdDrawdownPct: maxDrawdownPct(hold),
    deflatedSharpeRatio: deflated?.value ?? null,
    probabilityOfBacktestOverfitting: null,
    usePbo: false
  };
  const judged = judgeVolTarget(gate);
  const verdict: TargetVerdict = stage === 'final' ? judged.verdict : 'aguardando';
  const prefix = stage === 'final'
    ? `Final, ${elapsedDays.toFixed(0)} dias.`
    : stage === 'interina'
      ? `Leitura interina, ${elapsedDays.toFixed(0)} de ${VOL_TARGET_PROTOCOL.finalDays} dias; não decide.`
      : `${elapsedDays.toFixed(0)} de ${VOL_TARGET_PROTOCOL.interimDays} dias para a leitura interina.`;
  return {
    ...base,
    observations: gate.observations,
    sharpe: gate.sharpe,
    holdSharpe: gate.holdSharpe,
    maxDrawdownPct: gate.maxDrawdownPct,
    holdDrawdownPct: gate.holdDrawdownPct,
    returnPct: compoundPct(returns),
    holdReturnPct: compoundPct(hold),
    averageWeight: averageOf(weights),
    deflatedSharpeRatio: gate.deflatedSharpeRatio,
    probabilityOfBacktestOverfitting: null,
    verdict,
    reason: stage === 'aguardando' ? prefix : `${prefix} ${judged.reason}`,
    stage,
    elapsedDays
  };
}

export interface VolTargetReport {
  protocol: typeof VOL_TARGET_PROTOCOL;
  generatedAt: string;
  retrospective: { verdict: TargetVerdict; cells: TargetCell[] };
  forward: { verdict: TargetVerdict; cells: (TargetCell & { stage: string; elapsedDays: number })[] };
}

export function runVolTarget(options: { root: string; report: ValidationReport | null; asOfMs?: number; directory?: string }): VolTargetReport {
  const retrospective = retrospectiveCells(options.root, options.report);
  const asOf = options.asOfMs ?? Date.now();
  const forwardCells: (TargetCell & { stage: string; elapsedDays: number })[] = [];
  for (const symbol of VOL_TARGET_PROTOCOL.symbols) {
    const { klines, funding } = loadSeries(options.root, symbol);
    for (const horizon of VOL_TARGET_PROTOCOL.horizons) {
      forwardCells.push(forwardCell({ klines, funding, symbol, horizonHours: horizon, asOfMs: asOf }));
    }
  }
  const result: VolTargetReport = {
    protocol: VOL_TARGET_PROTOCOL,
    generatedAt: new Date().toISOString(),
    retrospective: { verdict: judgeTargetBook(retrospective), cells: retrospective },
    forward: { verdict: judgeTargetBook(forwardCells), cells: forwardCells }
  };
  const directory = options.directory ?? 'reports';
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'vol-target-latest.json'), JSON.stringify(result, null, 2) + '\n');
  writeFileSync(join(directory, 'vol-target-latest.md'), renderVolTarget(result));
  return result;
}

function cellRow(cell: TargetCell): string {
  return `| ${cell.symbol} | ${cell.horizonHours}h | ${cell.verdict} | ${fmt(cell.sharpe)} | ${fmt(cell.holdSharpe)} | ${fmt(cell.maxDrawdownPct)}% | ${fmt(cell.holdDrawdownPct)}% | ${fmt(cell.returnPct)}% | ${fmt(cell.holdReturnPct)}% | ${fmt(cell.averageWeight)} | ${fmt(cell.deflatedSharpeRatio, 3)} | ${fmt(cell.probabilityOfBacktestOverfitting, 3)} | ${cell.observations} |`;
}

export function renderVolTarget(report: VolTargetReport): string {
  const header = '| Moeda | Horizonte | Veredito | Sharpe | Sharpe segurar | Drawdown | Drawdown segurar | Retorno | Retorno segurar | Peso médio | DSR | PBO | Retornos |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const p = report.protocol;
  return [
    '# Vol targeting com HAR-RV (Fases 3 e 4)',
    '',
    'Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado. Isto não é conselho de investimento.',
    '',
    `Gerado em ${report.generatedAt}. Protocolo \`${p.id}\`, registrado em ${p.registeredAt}.`,
    '',
    '## Regra',
    '',
    'Comprado em BTC, ETH e SOL perpétuos, com peso = mín(1, mediana das previsões HAR-RV do treino ÷ previsão de agora). Taxa e slippage a cada mudança de peso; funding pago pelo comprado. Blocos de 4h e de 24h.',
    '',
    `**Aprovada** só se, nas seis células: Sharpe anualizado acima do de comprar e segurar, drawdown máximo abaixo do de comprar e segurar, Sharpe deflacionado de pelo menos ${p.deflatedSharpeMin}, pelo menos ${p.minObservations} retornos e, no retrospectivo, PBO abaixo de ${p.maxProbabilityOfOverfit}.`,
    '',
    '## Retrospectivo (2024-11 a 2026-11): não decide',
    '',
    'Esta janela já foi pontuada com esta mesma carteira pela régua antiga (vol-v1), e os números foram vistos antes deste critério existir. Ler o mesmo dado com um critério novo não é teste. Os números saem aqui para registro.',
    '',
    `Resultado retrospectivo: **${report.retrospective.verdict}**.`,
    '',
    header,
    ...report.retrospective.cells.map(cellRow),
    '',
    ...report.retrospective.cells.map(cell => `- ${cell.symbol} ${cell.horizonHours}h: ${cell.reason}`),
    '',
    '## Forward: decide',
    '',
    `Começa em ${p.forwardStart}, depois do commit que congelou esta regra. O HAR é reajustado a cada bloco só com blocos cujo rótulo já fechou. Leitura interina aos ${p.interimDays} dias (publicada, não decide). Veredito final aos ${p.finalDays} dias. Só conta bloco com funding mensal já publicado em data.binance.vision. O DSR usa ${p.forwardTrials} tentativas (uma hipótese por célula) e o erro-padrão do Sharpe; o PBO não entra, porque a carteira foi escolhida antes dos dados.`,
    '',
    `Estado: **${report.forward.verdict}**.`,
    '',
    header,
    ...report.forward.cells.map(cellRow),
    '',
    ...report.forward.cells.map(cell => `- ${cell.symbol} ${cell.horizonHours}h: ${cell.reason}`),
    ''
  ].join('\n');
}
