import { CanonicalCandle } from '../../shared/types';
import { DEFAULT_ANALOG_SEARCH, AnalogSearchConfig, buildAnalogIndex, searchAnalogs, summarizeAnalogs } from './analogs';
import { mechanicalReading } from './reading';
import { evaluatePatterns, markersAt, regimeLabel, zonesForContext } from './structures';
import type { ChartCandle, PatternContext } from './types';

function emptySummary() {
  return {
    count: 0,
    hitRateUp: null,
    hitRateDown: null,
    flatCount: 0,
    meanForwardReturnBps: null,
    medianForwardReturnBps: null,
    p25Bps: null,
    p75Bps: null,
    medianDistance: null
  };
}

/**
 * Chart leg at candle index `t`.
 * Similarity search and pattern stats both refuse bars after t.
 */
export function buildPatternContext(
  candles: readonly CanonicalCandle[],
  t: number,
  search: AnalogSearchConfig = DEFAULT_ANALOG_SEARCH
): PatternContext {
  const symbol = candles[0]?.symbol ?? 'BTCUSDT';
  const interval = candles[0]?.interval ?? '5m';
  const current = candles[t];
  const patterns = current ? evaluatePatterns(candles, t) : [];
  const matches = current ? searchAnalogs(buildAnalogIndex(candles, search.window), t, search) : [];
  const analogSummary = matches.length ? summarizeAnalogs(matches) : emptySummary();
  const recent: ChartCandle[] = [];
  if (current) {
    const from = Math.max(0, t - 119);
    for (let index = from; index <= t; index++) {
      const candle = candles[index];
      recent.push({ t: candle.openTime, o: candle.open, h: candle.high, l: candle.low, c: candle.close });
    }
  }
  const regimes = (['5m', '1h', '4h'] as const).map(timeframe => ({
    timeframe,
    label: regimeLabel(patterns, timeframe)
  }));
  const draft: PatternContext = {
    asOfOpenTime: current?.openTime ?? null,
    symbol,
    interval,
    window: search.window,
    horizonBars: search.horizon,
    horizonLabel: 'cerca de 1 hora',
    regime: {
      label: regimes[0]?.label ?? 'indefinido',
      detail: 'Regime do gráfico de 5 minutos: inclinação dos últimos 20 fechamentos comparada com o ATR.'
    },
    regimes,
    tags: patterns.filter(pattern => pattern.activeNow).map(pattern => pattern.name),
    analogs: matches,
    analogSummary,
    patterns,
    zones: current ? zonesForContext(candles, t) : [],
    markers: current ? markersAt(candles.slice(0, t + 1), patterns) : [],
    recent,
    chartReading: {
      text: '',
      bias: 'neutro',
      caveats: [],
      llmText: null,
      llmBias: null,
      llmMode: 'desligado'
    },
    note: current
      ? 'Os trechos parecidos terminam antes desta janela e o que aconteceu depois deles já era conhecido neste instante.'
      : 'Ainda não há candles para a Aranha ler.'
  };
  draft.chartReading = mechanicalReading(draft);
  return draft;
}

export function latestPatternContext(
  candles: readonly CanonicalCandle[],
  search?: AnalogSearchConfig
): PatternContext {
  if (candles.length === 0) return buildPatternContext([], -1, search);
  return buildPatternContext(candles, candles.length - 1, search);
}
