import { join } from 'node:path';
import { liveSymbolDir, symbolDir } from './paths';
import { readJsonl } from './store';
import type { TimedRate, TimedValue } from './overlay-series';

export type { OverlayPoint, TimedRate, TimedValue } from './overlay-series';
export { alignFuturesOverlay } from './overlay-series';

interface FundingRow {
  time: number;
  rate: number;
}

interface InterestRow {
  time: number;
  openInterest: number;
}

function mergeByTime<T extends { time: number }>(groups: readonly (readonly T[])[]): T[] {
  const byTime = new Map<number, T>();
  for (const group of groups) {
    for (const row of group) {
      if (!Number.isFinite(row.time)) continue;
      byTime.set(row.time, row);
    }
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function loadFunding(root: string, symbol: string): TimedRate[] {
  const historical = readJsonl<FundingRow>(join(symbolDir(root, symbol), 'funding.jsonl'));
  const live = readJsonl<FundingRow>(join(liveSymbolDir(root, symbol), 'funding.jsonl'));
  return mergeByTime([historical, live]).map(row => ({ time: row.time, rate: row.rate }));
}

export function loadOpenInterest(root: string, symbol: string): TimedValue[] {
  const historical = readJsonl<InterestRow>(join(symbolDir(root, symbol), 'metrics.jsonl'));
  const live = readJsonl<InterestRow>(join(liveSymbolDir(root, symbol), 'open-interest.jsonl'));
  return mergeByTime([historical, live])
    .filter(row => Number.isFinite(row.openInterest))
    .map(row => ({ time: row.time, value: row.openInterest }));
}

export function overlayPayload(root: string, symbol: string, start: number | null, end: number | null): {
  symbol: string;
  funding: TimedRate[];
  openInterest: TimedValue[];
  note: string;
} {
  const normalized = symbol.toUpperCase();
  const funding = sliceForChart(loadFunding(root, normalized), start, end);
  const openInterest = sliceForChart(loadOpenInterest(root, normalized), start, end);
  const newest = Math.max(funding.at(-1)?.time ?? 0, openInterest.at(-1)?.time ?? 0);
  let note = 'Camada visual. O último print com horário anterior ao fechamento da vela. Não é sinal e não envia ordem.';
  if (funding.length === 0 && openInterest.length === 0) {
    note = 'Sem funding nem open interest gravados para este par. O importador histórico ou o coletor ao vivo ainda não escreveram a pasta de futuros.';
  } else if (start !== null && newest > 0 && newest < start) {
    note = `Camada visual. O último print gravado é ${new Date(newest).toISOString()}, anterior a estas velas. Não é sinal e não envia ordem.`;
  }
  return { symbol: normalized, funding, openInterest, note };
}

/** Keeps prints inside the chart and the last print before it, so a later candle can still show what was already known. */
export function sliceForChart<T extends { time: number }>(rows: readonly T[], start: number | null, end: number | null): T[] {
  const endLimit = end === null ? Infinity : end + 60 * 60 * 1000;
  const startLimit = start === null ? -Infinity : start;
  const inside = rows.filter(row => row.time >= startLimit && row.time <= endLimit);
  if (start === null) return inside;
  let prior: T | null = null;
  for (const row of rows) {
    if (row.time < startLimit) prior = row;
    else break;
  }
  if (!prior || inside.some(row => row.time === prior.time)) return inside;
  return [prior, ...inside];
}
