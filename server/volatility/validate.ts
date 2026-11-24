import { join } from 'node:path';
import { buildDecisions, buildHourFrames } from '../futures/align';
import type { SymbolManifest } from '../futures/import-vision';
import type { BookSnapshot, FundingPrint, KlineBar, MetricsPrint } from '../futures/parse';
import { symbolDir, futuresRoot } from '../futures/paths';
import { futuresRuleSide, scoreDecisions } from '../futures/study';
import { readJsonl } from '../futures/store';
import { evaluateFamily, type StrategySeries } from '../validation/evaluate';
import { compound } from '../validation/moments';
import { VALIDATION_GATES } from '../validation/protocol';
import {
  readValidationReport,
  writeValidationReport,
  type ValidationReport,
  type ValidationStrategy
} from '../validation/report';
import { readTrials, trialCount, trialId, upsertTrial } from '../validation/trials';
import { buildVolSample } from './build';
import {
  composeHeadline,
  fmt,
  judgeFilter,
  judgeSkill,
  type VolFilterCell,
  type VolatilityBlock
} from './headlines';
import { maxDrawdownPct } from './losses';
import {
  VOL_MODEL_NAMES,
  VOL_PROTOCOL,
  volFamily,
  volKronosFamily,
  volSkillFamily,
  volStrategyId,
  volTrialPlans,
  type VolModelId,
  type VolRuleId
} from './protocol';
import { skillCell, type VolSkillCell } from './skill';
import { exposureReturns, outerTestIndexes, scaledRuleReturns, scoreVolPoints, type VolPoint } from './study';

const KRONOS_REASON = 'O Kronos-small fica inconclusivo até uma máquina com o worker e os pesos rodar `npm run validate -- --strategy kronos-vol`. Esta corrida não baixa peso e não inventa a dispersão.';

function loadSymbol(root: string, symbol: string): {
  manifest: SymbolManifest | null;
  klines: KlineBar[];
  funding: FundingPrint[];
  metrics: MetricsPrint[];
  book: BookSnapshot[];
} {
  const dir = symbolDir(root, symbol);
  return {
    manifest: readJsonl<SymbolManifest>(join(dir, 'manifest.jsonl'))[0] ?? null,
    klines: readJsonl<KlineBar>(join(dir, 'klines-1h.jsonl')),
    funding: readJsonl<FundingPrint>(join(dir, 'funding.jsonl')),
    metrics: readJsonl<MetricsPrint>(join(dir, 'metrics.jsonl')),
    book: readJsonl<BookSnapshot>(join(dir, 'book-1h.jsonl'))
  };
}

export function registerVolTrials(trialLog: string): void {
  const existing = readTrials(trialLog);
  for (const plan of volTrialPlans()) {
    const id = trialId(plan.family, plan.strategy, plan.params);
    // This command does not rescore Kronos. A dispersion already measured stays in the log.
    if (plan.family === volKronosFamily() && existing.some(row => row.id === id)) continue;
    upsertTrial(trialLog, {
      id,
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

function remember(
  trialLog: string,
  strategy: string,
  sharpe: number | null,
  periods: number | null,
  source: string
): void {
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
    source,
    params: plan.params
  });
}

function inconclusive(id: string, family: string, name: string, reason: string, note: string): ValidationStrategy {
  return { id, family, name, verdict: 'inconclusiva', reason, note, metrics: null };
}

function bookName(book: 'segurar' | VolRuleId): string {
  if (book === 'segurar') return 'comprar e segurar';
  if (book === 'logistica') return 'a regra logística';
  if (book === 'direcao') return 'a regra de direção';
  return 'a regra de funding';
}

function strategyTitle(symbol: string, horizon: number, use: 'filtro' | 'dimensionar', model: VolModelId, book: 'segurar' | VolRuleId): string {
  const action = use === 'filtro' ? 'filtro de vol alta' : 'tamanho pela vol';
  return `${symbol} ${horizon}h: ${action} (${VOL_MODEL_NAMES[model]}) em ${bookName(book)}`;
}

function strategyNote(horizon: number, use: 'filtro' | 'dimensionar', model: VolModelId, book: 'segurar' | VolRuleId): string {
  const action = use === 'filtro'
    ? `Fica zerado quando a variância prevista pelo ${VOL_MODEL_NAMES[model]} passa do percentil 80 das previsões do treino daquele bloco.`
    : `O peso é a mediana da vol prevista no treino dividida pela vol prevista agora, no máximo 1, com o ${VOL_MODEL_NAMES[model]}.`;
  const cost = book === 'segurar'
    ? 'Comprar e segurar paga o funding e uma entrada e uma saída. O filtro paga taxa só quando a posição muda.'
    : 'Na regra antiga, a ida e volta cheia continua sendo cobrada sempre que a posição fica ligada, como no estudo de direção. O filtro só zera ou escala essa posição.';
  return [
    action,
    `O resto segue ${bookName(book)}.`,
    `Horizonte de ${horizon} horas, sem sobreposição. O ajuste do bloco de teste não vê o rótulo desse bloco.`,
    cost,
    `Registrado em ${VOL_PROTOCOL.registeredAt}, antes deste teste.`
  ].join(' ');
}

function weightsFor(points: readonly VolPoint[], model: VolModelId, use: 'filtro' | 'dimensionar'): number[] | null {
  const ready = points.filter(point => point.models[model].forecast !== null).length;
  if (ready < VOL_PROTOCOL.minTestObservations) return null;
  return points.map(point => {
    const call = point.models[model];
    if (call.forecast === null) return 0;
    return use === 'filtro' ? (call.high ? 0 : 1) : call.weight;
  });
}

function kronosPlaceholder(reason: string): ValidationStrategy {
  return inconclusive(
    'kronos-vol',
    volKronosFamily(),
    'Kronos-small: dispersão como vol',
    reason,
    'A previsão seria a variância dos log-retornos amostrados no caminho de 6 horas. O alvo é o quadrado do log-retorno nessas 6 horas. Sem o worker, esta linha não recebe número.'
  );
}

function emptyBlock(kronosReason: string): VolatilityBlock {
  const skill = judgeSkill([]);
  const filter = judgeFilter([]);
  return {
    protocolId: VOL_PROTOCOL.id,
    registeredAt: VOL_PROTOCOL.registeredAt,
    skillVerdict: skill.verdict,
    skillReason: skill.reason,
    filterVerdict: filter.verdict,
    filterReason: filter.reason,
    headline: composeHeadline(skill, filter, kronosReason),
    kronosVerdict: 'inconclusiva',
    kronosReason,
    cells: [],
    filters: []
  };
}

interface ScoredBook {
  strategies: ValidationStrategy[];
  filters: VolFilterCell[];
}

function scoreBook(input: {
  trialLog: string;
  family: string;
  points: readonly VolPoint[];
  returnsOf: (weights: readonly number[]) => number[];
  plans: {
    id: string;
    name: string;
    note: string;
    model: VolModelId;
    use: 'filtro' | 'dimensionar';
    book: string;
    weights: number[] | null;
    symbol: string;
    horizonHours: number;
  }[];
  benchmark: number[];
  periodMs: number;
  extraNote?: (id: string) => string;
}): ScoredBook {
  const strategies: ValidationStrategy[] = [];
  const filters: VolFilterCell[] = [];
  const series: StrategySeries[] = [];
  const queued: typeof input.plans = [];
  for (const plan of input.plans) {
    if (!plan.weights) {
      const reason = 'Menos de 30 previsões no teste walk-forward. Sem essa amostra o filtro não entra no placar.';
      strategies.push(inconclusive(plan.id, input.family, plan.name, reason, plan.note));
      filters.push({
        id: plan.id,
        symbol: plan.symbol,
        horizonHours: plan.horizonHours,
        model: plan.model,
        use: plan.use,
        book: plan.book,
        name: plan.name,
        verdict: 'inconclusiva',
        reason,
        excessReturnPct: null,
        sharpe: null,
        deflatedSharpeRatio: null,
        probabilityOfBacktestOverfitting: null,
        maxDrawdownPct: null,
        buyAndHoldDrawdownPct: null,
        drawdownReduced: null,
        observations: null
      });
      continue;
    }
    series.push({
      id: plan.id,
      family: input.family,
      name: plan.name,
      note: plan.note,
      returns: input.returnsOf(plan.weights),
      benchmarkReturns: input.benchmark,
      decisions: input.points.map((_, index) => ({ index, predicted: null, probabilityUp: null, actual: 0, wentUp: null })),
      horizon: 1,
      stride: 1,
      periodMs: input.periodMs,
      hasDirection: false,
      hasProbability: false
    });
    queued.push(plan);
  }
  if (series.length === 0) return { strategies, filters };
  const trials = readTrials(input.trialLog).filter(entry => entry.family === input.family);
  const evaluations = evaluateFamily(series, trials);
  evaluations.forEach((evaluation, index) => {
    const plan = queued[index];
    const test = outerTestIndexes(plan.weights?.length ?? 0);
    const slice = test.map(slot => series[index].returns[slot]);
    const holdSlice = test.map(slot => input.benchmark[slot]);
    const drawdown = maxDrawdownPct(slice);
    const holdDrawdown = maxDrawdownPct(holdSlice);
    const reduced = drawdown !== null && holdDrawdown !== null && drawdown < holdDrawdown;
    const extra = input.extraNote?.(plan.id) ?? '';
    const drawdownNote = ` Drawdown máximo no teste: ${fmt(drawdown)}%. Comprar e segurar no mesmo teste: ${fmt(holdDrawdown)}%. ${reduced ? 'O drawdown caiu.' : 'O drawdown não caiu.'}${extra}`;
    strategies.push({
      id: evaluation.id,
      family: evaluation.family,
      name: evaluation.name,
      verdict: evaluation.verdict.label,
      reason: evaluation.verdict.reason,
      note: `${evaluation.note}${drawdownNote}`,
      metrics: evaluation.metrics
    });
    filters.push({
      id: plan.id,
      symbol: plan.symbol,
      horizonHours: plan.horizonHours,
      model: plan.model,
      use: plan.use,
      book: plan.book,
      name: plan.name,
      verdict: evaluation.verdict.label,
      reason: evaluation.verdict.reason,
      excessReturnPct: evaluation.metrics.excessReturnPct,
      sharpe: evaluation.metrics.sharpe,
      deflatedSharpeRatio: evaluation.metrics.deflatedSharpeRatio,
      probabilityOfBacktestOverfitting: evaluation.metrics.probabilityOfBacktestOverfitting,
      maxDrawdownPct: drawdown,
      buyAndHoldDrawdownPct: holdDrawdown,
      drawdownReduced: reduced,
      observations: evaluation.metrics.observations
    });
    remember(input.trialLog, plan.id, evaluation.metrics.sharpePerPeriod, evaluation.metrics.observations, 'medido depois do pre-registro');
  });
  return { strategies, filters };
}

export function runVolatilityValidation(options: {
  root?: string;
  trialLog?: string;
  reportDirectory?: string;
  symbols?: readonly string[];
} = {}): ValidationReport {
  const trialLog = options.trialLog ?? 'reports/trial-log.jsonl';
  const directory = options.reportDirectory ?? 'reports';
  const root = options.root ?? futuresRoot();
  const symbols = options.symbols ?? [...VOL_PROTOCOL.symbols];
  registerVolTrials(trialLog);

  const existing = readValidationReport(join(directory, 'validation-latest.json'));
  const preservedKronos = existing?.strategies.find(row => row.id === 'kronos-vol' && row.metrics !== null) ?? null;
  const kronosReason = preservedKronos
    ? existing?.volatility?.kronosReason ?? 'O Kronos-small já tinha sido medido. Esta corrida não refaz o worker.'
    : KRONOS_REASON;
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

  const cells: VolSkillCell[] = [];
  const filters: VolFilterCell[] = [];
  const strategies: ValidationStrategy[] = [];
  const notes = [
    'Volatilidade: o alvo é a soma dos quadrados dos log-retornos horários das próximas N horas. O módulo do log-retorno do bloco entra na correlação e na cobertura. Nenhum dos dois é feature.',
    'Volatilidade: a regressão é ridge com funding, variação de open interest, taker e desequilíbrio do livro. LightGBM não entra, para o teste ficar determinístico e sem biblioteca nativa. Trocar por LightGBM seria outro teste.',
    'Volatilidade: o DSR de cada família conta os filtros registrados nela. A habilidade de previsão fica na família vol-habilidade e não entra nesse DSR, porque não é uma operação. As tentativas foram gravadas antes de ler o teste.',
    'Volatilidade: no comprar e segurar, a taxa incide só quando a posição muda. Nas regras antigas, a ida e volta cheia do estudo de direção continua sempre que a posição fica ligada.',
    `Volatilidade: a janela congelada é ${VOL_PROTOCOL.windowStart} a ${VOL_PROTOCOL.windowEnd}. É a mesma do estudo de direção.`
  ];
  const datasets = base.datasets.filter(dataset => !dataset.source.includes('vol-v1'));

  for (const symbol of symbols) {
    const loaded = loadSymbol(root, symbol);
    if (loaded.klines.length === 0) {
      notes.push(`Volatilidade: ${symbol} não tem klines-1h.jsonl. Rode npm run futures:import. Sem o arquivo não há QLIKE, retorno nem drawdown.`);
      strategies.push(inconclusive(
        `vol-${symbol.toLowerCase()}-sem-serie`,
        volFamily(symbol, 4),
        `Volatilidade ${symbol}`,
        'Não há candles de 1h deste perp na janela congelada.',
        'Rode npm run futures:import. Esta linha não recebe número inventado.'
      ));
      continue;
    }
    const fullFeatures = loaded.funding.length > 0 && loaded.metrics.length > 0 && loaded.book.length > 0;
    const frames = fullFeatures
      ? buildHourFrames({ klines: loaded.klines, funding: loaded.funding, metrics: loaded.metrics, book: loaded.book })
      : undefined;
    const ruleMap = new Map<number, Record<VolRuleId, -1 | 0 | 1>>();
    if (fullFeatures && frames) {
      const futuresDecisions = buildDecisions({ klines: loaded.klines, frames, funding: loaded.funding, horizonHours: 4 });
      const scored = scoreDecisions(symbol, futuresDecisions);
      for (const row of scored.scored) {
        const fundingRate = row.decision.features[3];
        ruleMap.set(row.decision.openTime, {
          logistica: futuresRuleSide('logistica', row.probabilityUp, row.expectedReturn, fundingRate),
          direcao: futuresRuleSide('direcao', row.probabilityUp, row.expectedReturn, fundingRate),
          funding: futuresRuleSide('funding', row.probabilityUp, row.expectedReturn, fundingRate)
        });
      }
    }
    if (!fullFeatures) {
      notes.push(`Volatilidade: ${symbol} sem funding, métrica ou livro completo. HAR, EWMA e GARCH seguem só com o preço. A ridge e o filtro das regras antigas ficam inconclusivos.`);
    }
    if (loaded.funding.length === 0) {
      notes.push(`Volatilidade: ${symbol} sem funding.jsonl. O filtro não foi cobrado, para não publicar um retorno que ignora o funding.`);
    }
    for (const horizon of VOL_PROTOCOL.horizons) {
      const sample = buildVolSample({
        klines: loaded.klines,
        funding: loaded.funding,
        frames,
        horizonHours: horizon
      });
      const points = scoreVolPoints(sample.decisions, sample.hourlyReturns, horizon);
      for (const model of VOL_PROTOCOL.models) {
        const cell = skillCell(symbol, horizon, model, points);
        cells.push(cell);
        remember(trialLog, `habilidade-${symbol.toLowerCase()}-${horizon}h-${model}`, null, cell.observations, 'habilidade medida, sem Sharpe de operação');
      }
      const periodMs = horizon * 3_600_000;
      const decisions = points.map(point => point.decision);
      if (loaded.funding.length === 0 || points.length === 0) continue;
      const benchmark = exposureReturns(decisions, decisions.map(() => 1));
      const holdPlans = [
        ...VOL_PROTOCOL.models.map(model => ({ model, use: 'filtro' as const })),
        ...VOL_PROTOCOL.sizingModels.map(model => ({ model, use: 'dimensionar' as const }))
      ];
      const holdBook = scoreBook({
        trialLog,
        family: volFamily(symbol, horizon),
        points,
        benchmark,
        periodMs,
        returnsOf: weights => exposureReturns(decisions, weights),
        plans: holdPlans.map(item => ({
          id: volStrategyId(symbol, horizon, item.use, item.model, 'segurar'),
          name: strategyTitle(symbol, horizon, item.use, item.model, 'segurar'),
          note: strategyNote(horizon, item.use, item.model, 'segurar'),
          model: item.model,
          use: item.use,
          book: 'segurar',
          weights: weightsFor(points, item.model, item.use),
          symbol,
          horizonHours: horizon
        }))
      });
      strategies.push(...holdBook.strategies);
      filters.push(...holdBook.filters);
      if (horizon !== 4) continue;
      const overlap = points.filter(point => ruleMap.has(point.decision.openTime));
      const overlapDecisions = overlap.map(point => point.decision);
      if (!fullFeatures || overlap.length === 0) {
        for (const rule of VOL_PROTOCOL.ruleIds) {
          for (const use of ['filtro', 'dimensionar'] as const) {
            const id = volStrategyId(symbol, horizon, use, 'har', rule);
            const reason = 'A regra antiga não tem lado neste relógio: faltou feature de futuros ou o walk-forward dela não pontuou esta hora.';
            strategies.push(inconclusive(id, volFamily(symbol, horizon, 'regras'), strategyTitle(symbol, horizon, use, 'har', rule), reason, strategyNote(horizon, use, 'har', rule)));
            filters.push({
              id,
              symbol,
              horizonHours: horizon,
              model: 'har',
              use,
              book: rule,
              name: strategyTitle(symbol, horizon, use, 'har', rule),
              verdict: 'inconclusiva',
              reason,
              excessReturnPct: null,
              sharpe: null,
              deflatedSharpeRatio: null,
              probabilityOfBacktestOverfitting: null,
              maxDrawdownPct: null,
              buyAndHoldDrawdownPct: null,
              drawdownReduced: null,
              observations: null
            });
          }
        }
        continue;
      }
      const ruleBenchmark = exposureReturns(overlapDecisions, overlapDecisions.map(() => 1));
      const rulePlans = VOL_PROTOCOL.ruleIds.flatMap(rule => (['filtro', 'dimensionar'] as const).map(use => {
        const weights = weightsFor(overlap, 'har', use);
        const sides = overlap.map(point => ruleMap.get(point.decision.openTime)?.[rule] ?? 0);
        const raw = scaledRuleReturns(overlapDecisions, sides, sides.map(side => side === 0 ? 0 : 1));
        const test = outerTestIndexes(raw.length);
        const rawReturn = test.length ? compound(test.map(index => raw[index])) : null;
        return {
          id: volStrategyId(symbol, horizon, use, 'har', rule),
          name: strategyTitle(symbol, horizon, use, 'har', rule),
          note: strategyNote(horizon, use, 'har', rule),
          model: 'har' as const,
          use,
          book: rule,
          weights,
          symbol,
          horizonHours: horizon,
          sides,
          rawReturn
        };
      }));
      const ruleBook = scoreBook({
        trialLog,
        family: volFamily(symbol, horizon, 'regras'),
        points: overlap,
        benchmark: ruleBenchmark,
        periodMs,
        returnsOf: weights => {
          const plan = rulePlans.find(item => item.weights === weights);
          const sides = plan?.sides ?? overlap.map(() => 0 as const);
          return scaledRuleReturns(overlapDecisions, sides, weights);
        },
        extraNote: id => {
          const plan = rulePlans.find(item => item.id === id);
          return plan?.rawReturn === null || plan?.rawReturn === undefined
            ? ''
            : ` A mesma regra sem o filtro teve retorno ${(plan.rawReturn * 100).toFixed(2)}% nesse teste.`;
        },
        plans: rulePlans
      });
      strategies.push(...ruleBook.strategies);
      filters.push(...ruleBook.filters);
    }
    if (loaded.manifest) {
      datasets.push({
        symbol,
        interval: '1h',
        candles: loaded.manifest.klines,
        firstOpenTime: loaded.manifest.firstOpenTime,
        lastOpenTime: loaded.manifest.lastOpenTime,
        sha256: loaded.manifest.klinesSha256,
        source: `${loaded.manifest.source} vol-v1`
      });
    }
  }

  const skill = cells.length ? judgeSkill(cells) : judgeSkill([]);
  const filter = judgeFilter(filters);
  const block: VolatilityBlock = {
    protocolId: VOL_PROTOCOL.id,
    registeredAt: VOL_PROTOCOL.registeredAt,
    skillVerdict: skill.verdict,
    skillReason: skill.reason,
    filterVerdict: filter.verdict,
    filterReason: filter.reason,
    headline: composeHeadline(skill, filter, kronosReason),
    kronosVerdict: preservedKronos ? (existing?.volatility?.kronosVerdict ?? 'inconclusiva') : 'inconclusiva',
    kronosReason,
    cells,
    filters
  };
  const kronosRow = preservedKronos ?? kronosPlaceholder(kronosReason);
  const kept = base.strategies.filter(row => !row.family.startsWith('vol-') && !row.id.startsWith('vol-'));
  const logged = readTrials(trialLog);
  const trialsByFamily = { ...base.trialsByFamily };
  for (const family of new Set(volTrialPlans().map(plan => plan.family))) {
    trialsByFamily[family] = trialCount(logged, family);
  }
  const report: ValidationReport = {
    ...base,
    trialLog,
    trialsByFamily,
    datasets,
    strategies: [...kept, ...strategies, kronosRow],
    notes: [...base.notes.filter(note => !note.startsWith('Volatilidade:')), ...notes],
    volatility: block
  };
  writeValidationReport(report, directory);
  return report;
}
