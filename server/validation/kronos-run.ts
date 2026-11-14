import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CanonicalCandle } from '../../shared/types';
import { probabilityUp } from '../calibration';
import { appendForecastCache, loadForecastCache } from '../forecast-cache';
import { KronosProcess } from '../kronos-process';
import {
  CURRENT_RULE,
  RESEARCH_COSTS,
  ResearchParams,
  SAMPLE_COUNT,
  SERIES_SPECS
} from '../research-protocol';
import {
  CachedForecast,
  StudyRecord,
  buildStudyRecords,
  persistenceAction,
  researchAction
} from '../research-eval';
import { SignalAction } from '../signals';
import { equityPath, holdReturns } from './accounting';
import { downloadKlines } from './download';
import { StrategySeries } from './evaluate';

export const KRONOS_STRATEGY_IDS = ['kronos-m2', 'kronos-m3', 'kronos-rule'] as const;
export type KronosStrategyId = typeof KRONOS_STRATEGY_IDS[number];

const FROZEN_M2_PARAMS: ResearchParams = {
  id: 'escolhida-na-amostra',
  mode: 'long_short',
  trendFilter: false,
  minMoveBps: 50,
  atrMultiple: 0,
  maxDispersionBps: 10_000
};

const SPEC = SERIES_SPECS.find(spec => spec.interval === '1h') ?? SERIES_SPECS[1];

export function parseStrategyFlag(argv: readonly string[]): KronosStrategyId | null {
  const equals = argv.find(arg => arg.startsWith('--strategy='));
  const index = argv.indexOf('--strategy');
  if (!equals && index < 0) return null;
  const raw = equals ? equals.slice('--strategy='.length) : argv[index + 1];
  if (!raw || raw.startsWith('--')) {
    throw new Error(`Informe a estratégia: ${KRONOS_STRATEGY_IDS.join(', ')}.`);
  }
  if ((KRONOS_STRATEGY_IDS as readonly string[]).includes(raw)) return raw as KronosStrategyId;
  throw new Error(`Estratégia desconhecida: ${raw}. Use ${KRONOS_STRATEGY_IDS.join(', ')}.`);
}

export function ropePatchApplied(modulePath = join('external', 'Kronos', 'model', 'module.py')): boolean {
  if (!existsSync(modulePath)) return false;
  return readFileSync(modulePath, 'utf8').includes('kronos-rope-425.patch');
}

export function kronosStrategyPlan(id: KronosStrategyId): {
  id: KronosStrategyId;
  name: string;
  params: ResearchParams;
  tokenizerEval: boolean;
  cacheTag: string;
  note: string;
} {
  if (id === 'kronos-m2') {
    return {
      id,
      name: 'Kronos M2: regra escolhida na amostra',
      params: FROZEN_M2_PARAMS,
      tokenizerEval: false,
      cacheTag: 'm2-tokentrain',
      note: 'Regra congelada do M2 (long/short, 50 bps, sem filtro de média). O tokenizer fica em treino, como naquele estudo. O DSR usa as 108 tentativas da grade. O PBO desta corrida compara a regra com o último candle e com comprar e segurar.'
    };
  }
  if (id === 'kronos-m3') {
    return {
      id,
      name: 'Kronos M3: a mesma regra depois do RoPE',
      params: FROZEN_M2_PARAMS,
      tokenizerEval: true,
      cacheTag: 'm3-rope-eval',
      note: 'A mesma regra do M2, com o tokenizer em eval e o patch de RoPE aplicado no checkout. Nenhuma combinação nova entra na grade. O PBO desta corrida compara a regra com o último candle e com comprar e segurar.'
    };
  }
  return {
    id,
    name: 'Kronos: regra atual',
    params: CURRENT_RULE,
    tokenizerEval: true,
    cacheTag: 'rule-eval',
    note: 'Regra ao vivo: movimento mínimo de 30 bps, EMA9/EMA20 e bloqueio de RSI. O tokenizer fica em eval. O PBO desta corrida compara a regra com o último candle e com comprar e segurar.'
  };
}

function holdsFor(fillIndexes: readonly number[], horizon: number, lastIndex: number): { start: number; end: number }[] {
  const fills = [...fillIndexes].filter(index => index > 0 && index <= lastIndex).sort((a, b) => a - b);
  const holds: { start: number; end: number }[] = [];
  for (let slot = 0; slot < fills.length; slot++) {
    const start = fills[slot];
    const next = fills[slot + 1];
    const naturalEnd = Math.min(lastIndex, start + horizon - 1);
    const end = next === undefined ? naturalEnd : Math.min(naturalEnd, next - 1);
    if (end >= start) holds.push({ start, end });
  }
  return holds;
}

function seriesFrom(
  id: string,
  name: string,
  note: string,
  candles: readonly CanonicalCandle[],
  schedule: ReadonlyMap<number, SignalAction>,
  holds: readonly { start: number; end: number }[],
  benchmark: number[],
  decisions: StrategySeries['decisions'],
  hasProbability: boolean
): StrategySeries {
  const last = holds[holds.length - 1]?.end ?? 0;
  return {
    id,
    family: 'kronos',
    name,
    returns: holdReturns(equityPath(candles.slice(0, last + 1), schedule, 'long_short', RESEARCH_COSTS), holds),
    benchmarkReturns: benchmark,
    decisions,
    horizon: 1,
    stride: 1,
    periodMs: SPEC.intervalMs * SPEC.stride,
    hasDirection: decisions.some(decision => decision.predicted !== null),
    hasProbability,
    note
  };
}

/**
 * Turn cached forecasts into the Kronos rule plus two baselines that do not
 * need the model. Walk-forward inside the validator splits train and test.
 * Passing +Infinity skips the old August cut so this window is not embargoed twice.
 */
export function kronosSeriesFromForecasts(
  candles: readonly CanonicalCandle[],
  forecasts: ReadonlyMap<number, CachedForecast>,
  plan: ReturnType<typeof kronosStrategyPlan>
): StrategySeries[] {
  const records = buildStudyRecords(candles, forecasts, SPEC, Number.POSITIVE_INFINITY);
  if (records.length < 2) throw new Error('Menos de duas decisões com previsão. O cache ou o horizonte não fecharam.');
  const holds = holdsFor(records.map(record => record.fillIndex), SPEC.horizon, candles.length - 1);
  if (holds.length !== records.length) {
    throw new Error(`As janelas (${holds.length}) não fecharam todas as ${records.length} decisões.`);
  }
  const used = records;
  const last = holds[holds.length - 1].end;
  const benchmark = holdReturns(
    equityPath(candles.slice(0, last + 1), new Map([[holds[0].start, 'BUY']]), 'long_only', RESEARCH_COSTS),
    holds
  );
  const decisionsFor = (
    predicted: (record: StudyRecord) => number | null,
    probability: boolean
  ): StrategySeries['decisions'] => used.map((record, index) => {
    const chance = probability ? probabilityUp(record.sampleEnds, record.close) : { pUp: null, note: null };
    return {
      index,
      predicted: predicted(record),
      probabilityUp: chance.pUp,
      actual: record.actualReturnBps,
      wentUp: record.actualReturnBps === 0 ? null : record.actualReturnBps > 0
    };
  });
  const ruleSchedule = new Map<number, SignalAction>();
  const persistenceSchedule = new Map<number, SignalAction>();
  for (const record of used) {
    ruleSchedule.set(record.fillIndex, researchAction(record, plan.params));
    const previous = record.index > 0 ? candles[record.index - 1].close : record.close;
    persistenceSchedule.set(record.fillIndex, persistenceAction(record, previous));
  }
  const hasProbability = used.every(record => record.sampleEnds.length >= 2);
  return [
    seriesFrom(
      plan.id,
      plan.name,
      plan.note,
      candles,
      ruleSchedule,
      holds,
      benchmark,
      decisionsFor(record => record.predictedReturnBps, hasProbability),
      hasProbability
    ),
    seriesFrom(
      `${plan.id}-persistencia`,
      'Último candle',
      'Baseline sem o modelo, no mesmo relógio das previsões.',
      candles,
      persistenceSchedule,
      holds,
      benchmark,
      decisionsFor(record => {
        const previous = record.index > 0 ? candles[record.index - 1].close : record.close;
        const action = persistenceAction(record, previous);
        return action === 'BUY' ? 1 : action === 'SELL' ? -1 : null;
      }, false),
      false
    ),
    seriesFrom(
      `${plan.id}-segurar`,
      'Comprar e segurar',
      'Baseline comprada no primeiro preenchimento.',
      candles,
      new Map([[holds[0].start, 'BUY']]),
      holds,
      benchmark,
      used.map((_, index) => ({ index, predicted: null, probabilityUp: null, actual: 0, wentUp: null })),
      false
    )
  ];
}

export async function loadKronosCandles(now = Date.now()): Promise<{ candles: CanonicalCandle[]; sha256: string }> {
  const days = Number(process.env.KRONOS_VALIDATION_DAYS || 120);
  if (!Number.isInteger(days) || days < 30) throw new Error('KRONOS_VALIDATION_DAYS deve ser um inteiro >= 30.');
  // KRONOS_VALIDATION_END_MS freezes the window so M2, M3 and the current rule read the same snapshot.
  const frozenEnd = process.env.KRONOS_VALIDATION_END_MS;
  if (frozenEnd) {
    const end = Number(frozenEnd);
    if (!Number.isInteger(end) || end <= 0) throw new Error('KRONOS_VALIDATION_END_MS deve ser um timestamp em milissegundos.');
    now = end;
  }
  const downloaded = await downloadKlines({
    symbol: 'BTCUSDT',
    interval: '1h',
    startTime: now - days * 24 * 60 * 60 * 1000,
    endTime: now,
    cacheDir: join('data', 'validation')
  });
  return downloaded;
}

export async function ensureForecastCache(
  candles: readonly CanonicalCandle[],
  datasetSha256: string,
  plan: ReturnType<typeof kronosStrategyPlan>
): Promise<Map<number, CachedForecast>> {
  process.env.KRONOS_TOKENIZER_EVAL = plan.tokenizerEval ? '1' : '0';
  const kronos = new KronosProcess();
  try {
  const ready = await kronos.start();
  const file = join(
    'data',
    'research-cache',
    `BTCUSDT_1h_c${SPEC.context}_h${SPEC.horizon}_n${SAMPLE_COUNT}_${plan.cacheTag}_${ready.upstreamCommit.slice(0, 12)}_${datasetSha256.slice(0, 12)}.jsonl`
  );
  const cache = loadForecastCache(file, datasetSha256);
  const indexes: number[] = [];
  for (let index = SPEC.context - 1; index + SPEC.horizon < candles.length; index += SPEC.stride) indexes.push(index);
  const missing = indexes.filter(index => !cache.has(candles[index].openTime));
  console.log(`[validação] ${plan.id}: ${indexes.length} decisões, ${missing.length} sem cache em ${file}`);
  const fresh: CachedForecast[] = [];
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
      const sampleEnds = Array.isArray(response.sampleEnds) ? (response.sampleEnds as number[]).map(Number) : [];
      const meanCloses = response.predictions.map(Number);
      if (sampleEnds.length !== SAMPLE_COUNT || meanCloses.length < SPEC.horizon) {
        throw new Error(`Previsão em ${candles[index].openTime} não trouxe ${SAMPLE_COUNT} amostras.`);
      }
      const row: CachedForecast = {
        openTime: candles[index].openTime,
        meanCloses,
        sampleEnds,
        datasetSha256
      };
      cache.set(row.openTime, row);
      fresh.push(row);
      if (fresh.length >= 25) appendForecastCache(file, fresh.splice(0, fresh.length));
      if (n === 0 || (n + 1) % 25 === 0 || n + 1 === missing.length) {
        console.log(`[validação] ${plan.id} ${n + 1}/${missing.length}`);
      }
    }
    appendForecastCache(file, fresh);
    return cache;
  } finally {
    kronos.stop();
  }
}
