import { join } from 'node:path';
import { evaluateFamily, type StrategyEvaluation } from '../validation/evaluate';
import { VALIDATION_GATES } from '../validation/protocol';
import {
  readValidationReport,
  replaceStrategy,
  writeValidationReport,
  type ValidationReport,
  type ValidationStrategy
} from '../validation/report';
import { readTrials, trialCount, trialId, upsertTrial } from '../validation/trials';
import { buildDecisions, buildHourFrames } from './align';
import type { SymbolManifest } from './import-vision';
import {
  FUTURES_PROTOCOL,
  FUTURES_RULES,
  futuresFamily,
  futuresStrategyId,
  futuresTrialParams
} from './protocol';
import { futuresRoot, symbolDir } from './paths';
import type { BookSnapshot, FundingPrint, KlineBar, MetricsPrint } from './parse';
import { scoreDecisions } from './study';
import { readJsonl } from './store';

function unavailable(symbol: string, reason: string, note: string): ValidationStrategy[] {
  return FUTURES_RULES.map(rule => ({
    id: futuresStrategyId(symbol, rule.id),
    family: futuresFamily(symbol),
    name: `Futuros ${symbol}: ${rule.name}`,
    verdict: 'inconclusiva' as const,
    reason,
    note,
    metrics: null
  }));
}

function fromEvaluation(evaluation: StrategyEvaluation, extraNote: string): ValidationStrategy {
  return {
    id: evaluation.id,
    family: evaluation.family,
    name: evaluation.name,
    verdict: evaluation.verdict.label,
    reason: evaluation.verdict.reason,
    note: extraNote ? `${evaluation.note} ${extraNote}` : evaluation.note,
    metrics: evaluation.metrics
  };
}

function quantile(values: readonly number[], probability: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * probability)));
  return sorted[index];
}

function registerTrials(trialLog: string, symbols: readonly string[]): void {
  const params = futuresTrialParams();
  for (const symbol of symbols) {
    for (const rule of FUTURES_RULES) {
      const id = futuresStrategyId(symbol, rule.id);
      upsertTrial(trialLog, {
        id: trialId(futuresFamily(symbol), id, params),
        family: futuresFamily(symbol),
        strategy: id,
        recordedAt: FUTURES_PROTOCOL.registeredAt,
        trials: 1,
        sharpe: null,
        periods: null,
        source: 'pre-registro antes do teste',
        params
      });
    }
  }
}

function loadManifest(root: string, symbol: string): SymbolManifest | null {
  const rows = readJsonl<SymbolManifest>(join(symbolDir(root, symbol), 'manifest.jsonl'));
  return rows[0] ?? null;
}

export function runFuturesValidation(options: {
  root?: string;
  trialLog?: string;
  reportDirectory?: string;
  symbols?: readonly string[];
} = {}): ValidationReport {
  const root = options.root ?? futuresRoot();
  const trialLog = options.trialLog ?? 'reports/trial-log.jsonl';
  const directory = options.reportDirectory ?? 'reports';
  const symbols = options.symbols ?? [...FUTURES_PROTOCOL.symbols];
  registerTrials(trialLog, symbols);

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

  let report: ValidationReport = {
    ...base,
    datasets: base.datasets.filter(dataset => !dataset.source.includes('/futures/um')),
    notes: base.notes.filter(note => !note.startsWith('Futuros:'))
  };
  const params = futuresTrialParams();

  for (const symbol of symbols) {
    const manifest = loadManifest(root, symbol);
    const klines = readJsonl<KlineBar>(join(symbolDir(root, symbol), 'klines-1h.jsonl'));
    const funding = readJsonl<FundingPrint>(join(symbolDir(root, symbol), 'funding.jsonl'));
    const metrics = readJsonl<MetricsPrint>(join(symbolDir(root, symbol), 'metrics.jsonl'));
    const book = readJsonl<BookSnapshot>(join(symbolDir(root, symbol), 'book-1h.jsonl'));
    if (klines.length === 0 || funding.length === 0 || metrics.length === 0) {
      const rows = unavailable(
        symbol,
        'Não há arquivo histórico suficiente deste perp para medir.',
        'Rode npm run futures:import. Sem esses arquivos o veredito não recebe número inventado.'
      );
      for (const row of rows) report = replaceStrategy(report, row);
      continue;
    }
    const frames = buildHourFrames({ klines, funding, metrics, book });
    const decisions = buildDecisions({ klines, frames, funding });
    const study = scoreDecisions(symbol, decisions);
    const family = futuresFamily(symbol);
    if (study.strategies.length === 0) {
      const rows = unavailable(
        symbol,
        'Amostra curta demais, ou sem a série de retornos, para separar vantagem de acaso.',
        `${klines.length} candles e ${decisions.length} decisões completas. O walk-forward não chegou a um bloco de teste.`
      );
      for (const row of rows) report = replaceStrategy(report, row);
      continue;
    }
    const probabilities = study.scored.map(row => row.probabilityUp);
    const p10 = quantile(probabilities, 0.1);
    const p50 = quantile(probabilities, 0.5);
    const p90 = quantile(probabilities, 0.9);
    const distribution = `P(alta) no teste interno: p10 ${p10?.toFixed(3) ?? 'n/d'}, mediana ${p50?.toFixed(3) ?? 'n/d'}, p90 ${p90?.toFixed(3) ?? 'n/d'}. ${study.trainOnly} decisões ficaram só no treino inicial e não entram no placar.`;
    const evaluations = evaluateFamily(study.strategies, readTrials(trialLog).filter(entry => entry.family === family));
    evaluations.forEach((evaluation, index) => {
      const trades = study.strategies[index].returns.filter(value => value !== 0).length;
      const row = fromEvaluation(evaluation, `${distribution} Posições diferentes de zero: ${trades} de ${study.strategies[index].returns.length}.`);
      report = replaceStrategy(report, row);
      upsertTrial(trialLog, {
        id: trialId(family, evaluation.id, params),
        family,
        strategy: evaluation.id,
        recordedAt: new Date().toISOString(),
        trials: 1,
        sharpe: evaluation.metrics.sharpePerPeriod,
        periods: evaluation.metrics.observations,
        source: 'npm run validate -- --strategy futuros',
        params
      });
    });
    if (manifest) {
      report.datasets.push({
        symbol,
        interval: '1h',
        candles: manifest.klines,
        firstOpenTime: manifest.firstOpenTime,
        lastOpenTime: manifest.lastOpenTime,
        sha256: manifest.klinesSha256,
        source: manifest.source
      });
      const check = manifest.aggTradeCheck;
      const checkText = check && check.meanAbsBaseDiff !== null
        ? `aggTrades de ${check.days.join(', ')}: ${check.compared} horas, diferença média absoluta do taker buy ${check.meanAbsBaseDiff.toFixed(6)} contratos da unidade base, máxima ${check.maxAbsBaseDiff?.toFixed(6)}.`
        : 'A comparação com aggTrades não teve hora em comum.';
      const missing = `Dias sem métrica: ${manifest.missingMetricDays.length}. Dias sem livro: ${manifest.missingBookDays.length}.`;
      report.notes.push(`Futuros: ${symbol} ${manifest.klines} candles de 1h, ${manifest.funding} fundings, ${manifest.metrics} métricas, ${manifest.bookHours} horas de livro. ${missing} ${checkText}`);
      if (symbol === symbols[0]) {
        for (const probe of manifest.coverage) {
          report.notes.push(`Futuros: sonda ${probe.status ?? 'sem resposta'} ${probe.url}${probe.error ? ` (${probe.error})` : ''}.`);
        }
      }
    }
  }

  const logged = readTrials(trialLog);
  const trialsByFamily = { ...report.trialsByFamily };
  for (const symbol of symbols) trialsByFamily[futuresFamily(symbol)] = trialCount(logged, futuresFamily(symbol));
  const futuresOrder = symbols.flatMap(symbol => FUTURES_RULES.map(rule => futuresStrategyId(symbol, rule.id)));
  const futuresRows = report.strategies.filter(strategy => strategy.family.startsWith('futuros-'));
  const otherRows = report.strategies.filter(strategy => !strategy.family.startsWith('futuros-'));
  futuresRows.sort((left, right) => futuresOrder.indexOf(left.id) - futuresOrder.indexOf(right.id));
  report = {
    ...report,
    strategies: [...otherRows, ...futuresRows]
  };
  report = {
    ...report,
    trialLog,
    trialsByFamily,
    notes: [
      ...report.notes,
      'Futuros: o modelo é regressão logística para a direção e ridge para o tamanho do retorno. LightGBM e CatBoost não entram, para o teste ficar determinístico e sem biblioteca nativa. As três regras foram gravadas antes do teste e nenhuma foi trocada depois.',
      'Futuros: liquidações não entram no modelo. O dump público diário não está em data.binance.vision. O coletor ao vivo tenta o websocket forceOrder e o REST allForceOrders, sem chave.',
      'Futuros: o CVD e o desequilíbrio de agressão usados no modelo vêm do taker buy/sell de cada candle de 1h, que é o agregado público das aggTrades. O livro entra como desequilíbrio de nocional a 1% do bookDepth. O OFI de melhor oferta é só do coletor ao vivo, porque o histórico tick a tick do book não foi baixado.',
      `Futuros: a janela congelada é ${FUTURES_PROTOCOL.windowStart} a ${FUTURES_PROTOCOL.windowEnd}. Histórico anterior que a sonda achar não foi usado. Alongar a janela seria outro teste, com registro novo.`
    ]
  };
  writeValidationReport(report, directory);
  return report;
}
