import { join } from 'node:path';
import { BACKTEST_UNIVERSE } from '../crawler/config';
import { loadEnvFile } from '../load-env';
import { tuneGridSize } from '../research-protocol';
import { downloadKlines, asMarketBars } from './download';
import { evaluateFamily, StrategyEvaluation } from './evaluate';
import {
  ensureForecastCache,
  KronosStrategyId,
  kronosSeriesFromForecasts,
  kronosStrategyPlan,
  loadKronosCandles,
  parseStrategyFlag,
  ropePatchApplied
} from './kronos-run';
import { VALIDATION_GATES } from './protocol';
import {
  kronosDispersionNote,
  readValidationReport,
  replaceStrategy,
  ValidationReport,
  ValidationStrategy,
  writeValidationReport
} from './report';
import { aranhaStrategies, crawlerStrategies } from './series';
import { readTrials, trialCount, trialId, upsertTrial, TrialEntry } from './trials';
import { runFuturesValidation } from '../futures/validate';

loadEnvFile();

const TRIAL_LOG = 'reports/trial-log.jsonl';
const ARANHA_DAYS = 120;
const CRAWLER_DAYS = 12;

function fromEvaluation(evaluation: StrategyEvaluation): ValidationStrategy {
  return {
    id: evaluation.id,
    family: evaluation.family,
    name: evaluation.name,
    verdict: evaluation.verdict.label,
    reason: evaluation.verdict.reason,
    note: evaluation.note,
    metrics: evaluation.metrics
  };
}

function unavailable(id: string, family: string, name: string, reason: string, note: string): ValidationStrategy {
  return { id, family, name, verdict: 'inconclusiva', reason, note, metrics: null };
}

function remember(evaluation: StrategyEvaluation, params: unknown): void {
  upsertTrial(TRIAL_LOG, {
    id: trialId(evaluation.family, evaluation.id, params),
    family: evaluation.family,
    strategy: evaluation.id,
    recordedAt: new Date().toISOString(),
    trials: 1,
    sharpe: evaluation.metrics.sharpePerPeriod,
    periods: evaluation.metrics.observations,
    source: 'npm run validate',
    params
  });
}

function logFor(family: string): TrialEntry[] {
  return readTrials(TRIAL_LOG).filter(entry => entry.family === family);
}

async function runKronosCommand(id: KronosStrategyId): Promise<void> {
  const plan = kronosStrategyPlan(id);
  if ((id === 'kronos-m3' || id === 'kronos-rule') && !ropePatchApplied()) {
    throw new Error('O patch de RoPE não está em external/Kronos. Rode bash scripts/setup-kronos.sh antes deste comando.');
  }
  if (id === 'kronos-m2' && ropePatchApplied()) {
    console.log('[validação] O checkout já tem o patch de RoPE. O M2 deixa o tokenizer em treino, mas não desfaz o patch.');
  }
  const downloaded = await loadKronosCandles();
  const cache = await ensureForecastCache(downloaded.candles, downloaded.sha256, plan);
  const series = kronosSeriesFromForecasts(downloaded.candles, cache, plan);
  const [evaluation] = evaluateFamily(series, logFor('kronos'));
  const row = fromEvaluation(evaluation);
  if (id === 'kronos-m2' && ropePatchApplied()) {
    row.note += ' O checkout local já contém o patch de RoPE, então isto não é o binário anterior ao patch.';
  }
  remember(evaluation, {
    tag: plan.cacheTag,
    tokenizerEval: plan.tokenizerEval,
    minMoveBps: plan.params.minMoveBps,
    trendFilter: plan.params.trendFilter,
    rsiBuyMax: plan.params.rsiBuyMax ?? null
  });
  const existing = readValidationReport();
  const base: ValidationReport = existing ?? {
    generatedAt: new Date().toISOString(),
    disclaimer: 'Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado. Isto não é conselho de investimento.',
    gates: {
      minIndependentDecisions: VALIDATION_GATES.minIndependentDecisions,
      deflatedSharpeMin: VALIDATION_GATES.deflatedSharpeMin,
      maxProbabilityOfOverfit: VALIDATION_GATES.maxProbabilityOfOverfit,
      directionalAlpha: VALIDATION_GATES.directionalAlpha
    },
    trialLog: TRIAL_LOG,
    trialsByFamily: {},
    datasets: [],
    strategies: [],
    notes: []
  };
  const dataset = {
    symbol: 'BTCUSDT',
    interval: '1h',
    candles: downloaded.candles.length,
    firstOpenTime: downloaded.candles[0]?.openTime ?? null,
    lastOpenTime: downloaded.candles[downloaded.candles.length - 1]?.openTime ?? null,
    sha256: downloaded.sha256,
    source: 'https://data-api.binance.vision/api/v3/klines'
  };
  const datasets = base.datasets.filter(row => !(row.symbol === 'BTCUSDT' && row.interval === '1h' && row.sha256 === dataset.sha256));
  const logged = readTrials(TRIAL_LOG);
  const report = replaceStrategy({
    ...base,
    datasets: [dataset, ...datasets],
    trialsByFamily: { ...base.trialsByFamily, kronos: trialCount(logged, 'kronos') },
    notes: base.notes.some(note => note.includes(plan.id))
      ? base.notes
      : [...base.notes, `${plan.name} foi medido com o worker local. O cache fica em data/research-cache/.`]
  }, row);
  writeValidationReport(report);
  console.log(`${row.name}: ${row.verdict}`);
}

function strategyArgument(argv: readonly string[]): string | null {
  const equals = argv.find(arg => arg.startsWith('--strategy='));
  const index = argv.indexOf('--strategy');
  if (equals) return equals.slice('--strategy='.length);
  if (index >= 0) return argv[index + 1] ?? null;
  return null;
}

async function main(): Promise<void> {
  if (strategyArgument(process.argv) === 'futuros') {
    runFuturesValidation();
    return;
  }
  const selected = parseStrategyFlag(process.argv);
  if (selected) {
    await runKronosCommand(selected);
    return;
  }
  const now = Date.now();
  const strategies: ValidationStrategy[] = [];
  const datasets: ValidationReport['datasets'] = [];
  const notes = [
    'Nenhuma ordem foi enviada. O módulo de execução legado não entra nesta conta.',
    'O Sharpe deflacionado segue Bailey e López de Prado. O PBO segue a validação cruzada simétrica combinatória de Bailey, Borwein, López de Prado e Zhu. O código é próprio; pypbo, que é AGPL, não é importado.',
    'Decisões cujo horizonte se sobrepõe não entram no teste binomial como se fossem independentes. O p-valor usado é o mais alto entre o binomial das decisões sem sobreposição e, quando há sobreposição, um bootstrap em blocos.'
  ];

  upsertTrial(TRIAL_LOG, {
    id: 'kronos-m2-grid',
    family: 'kronos',
    strategy: 'grade-m2',
    recordedAt: new Date(now).toISOString(),
    trials: tuneGridSize(),
    sharpe: null,
    periods: null,
    source: 'server/research-protocol.ts TUNE_GRID',
    params: { grid: 'modes × trend × minMove × atr × dispersion' }
  });

  try {
    const start = now - ARANHA_DAYS * 24 * 60 * 60 * 1000;
    console.log('[validação] baixando BTCUSDT 1h');
    const downloaded = await downloadKlines({
      symbol: 'BTCUSDT',
      interval: '1h',
      startTime: start,
      endTime: now,
      cacheDir: join('data', 'validation')
    });
    datasets.push({
      symbol: 'BTCUSDT',
      interval: '1h',
      candles: downloaded.candles.length,
      firstOpenTime: downloaded.candles[0]?.openTime ?? null,
      lastOpenTime: downloaded.candles[downloaded.candles.length - 1]?.openTime ?? null,
      sha256: downloaded.sha256,
      source: 'https://data-api.binance.vision/api/v3/klines'
    });
    console.log(`[validação] BTCUSDT 1h: ${downloaded.candles.length} candles`);
    const series = aranhaStrategies(downloaded.candles, 3_600_000);
    if (series.length === 0) throw new Error('A Aranha não produziu decisões suficientes.');
    console.log(`[validação] Aranha: ${series[0].returns.length} decisões`);
    for (const item of evaluateFamily(series, logFor('aranha'))) {
      strategies.push(fromEvaluation(item));
      remember(item, { window: 48, horizonBars: 12, stride: 12, fee: 0.001, slippage: 0.0005 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`Aranha não foi medida: ${message}`);
    for (const [id, name] of [
      ['aranha-analogs', 'Aranha: análogos'],
      ['aranha-structures', 'Aranha: estruturas'],
      ['aranha-persistence-filtered', 'Aranha: persistência com filtro']
    ] as const) {
      strategies.push(unavailable(id, 'aranha', name, 'Os candles públicos não puderam ser avaliados nesta máquina.', message));
    }
  }

  try {
    const start = now - CRAWLER_DAYS * 24 * 60 * 60 * 1000;
    const books: Record<string, ReturnType<typeof asMarketBars>> = {};
    for (const symbol of BACKTEST_UNIVERSE) {
      console.log(`[validação] baixando ${symbol} 5m`);
      const downloaded = await downloadKlines({
        symbol,
        interval: '5m',
        startTime: start,
        endTime: now,
        cacheDir: join('data', 'validation')
      });
      books[symbol] = asMarketBars(downloaded.candles);
      datasets.push({
        symbol,
        interval: '5m',
        candles: downloaded.candles.length,
        firstOpenTime: downloaded.candles[0]?.openTime ?? null,
        lastOpenTime: downloaded.candles[downloaded.candles.length - 1]?.openTime ?? null,
        sha256: downloaded.sha256,
        source: 'https://data-api.binance.vision/api/v3/klines'
      });
    }
    console.log('[validação] calculando o ranking do crawler');
    notes.push('No crawler, a carteira é reavaliada a cada 12 candles de 5 minutos e segurada por essas mesmas 12 velas. Janelas de 4h e 24h do estudo antigo se sobrepõem e não entram no veredito.');
    const clock = crawlerStrategies(books, 12);
    for (const item of evaluateFamily(clock.strategies, logFor('crawler'))) {
      strategies.push(fromEvaluation(item));
      remember(item, { holdBars: 12, universe: BACKTEST_UNIVERSE.length, roundTrip: 0.003 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`Crawler não foi medido: ${message}`);
    for (const [id, name] of [
      ['crawler-score', 'Crawler: score'],
      ['crawler-momentum', 'Crawler: momentum'],
      ['crawler-volume', 'Crawler: volume']
    ] as const) {
      strategies.push(unavailable(id, 'crawler', name, 'Os candles públicos não puderam ser avaliados nesta máquina.', message));
    }
  }

  const kronosReason = 'Não há previsões em cache nem o modelo local para refazer o teste. Os números dos relatórios M2 e M3 não foram copiados para cá.';
  strategies.unshift(
    unavailable('kronos-m2', 'kronos', 'Kronos M2: regra escolhida na amostra', kronosReason, 'A grade de 108 combinações está no registro de tentativas, sem o Sharpe de cada uma.'),
    unavailable('kronos-m3', 'kronos', 'Kronos M3: a mesma regra depois do RoPE', kronosReason, 'O M3 não buscou regra nova. Sem o mesmo snapshot e sem as previsões, a comparação antes/depois não foi refeita.'),
    unavailable('kronos-rule', 'kronos', 'Kronos: regra atual', kronosReason, 'A regra atual usa a previsão do modelo, o filtro de média e o bloqueio de RSI. Sem previsão, não há o que validar. Rode npm run validate -- --strategy kronos-rule numa máquina com o worker.')
  );

  const logged = readTrials(TRIAL_LOG);
  const report: ValidationReport = {
    generatedAt: new Date().toISOString(),
    disclaimer: 'Simulação de pesquisa. Nenhuma ordem real foi enviada. Um número ruim continua publicado. Isto não é conselho de investimento.',
    gates: {
      minIndependentDecisions: VALIDATION_GATES.minIndependentDecisions,
      deflatedSharpeMin: VALIDATION_GATES.deflatedSharpeMin,
      maxProbabilityOfOverfit: VALIDATION_GATES.maxProbabilityOfOverfit,
      directionalAlpha: VALIDATION_GATES.directionalAlpha
    },
    trialLog: TRIAL_LOG,
    trialsByFamily: {
      kronos: trialCount(logged, 'kronos'),
      aranha: trialCount(logged, 'aranha'),
      crawler: trialCount(logged, 'crawler')
    },
    datasets,
    strategies,
    notes: [...notes, kronosDispersionNote(strategies)]
  };
  writeValidationReport(report);
  console.log(report.strategies.map(strategy => `${strategy.name}: ${strategy.verdict}`).join('\n'));
}

main().catch(error => {
  console.error('[validação]', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
