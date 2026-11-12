import { CanonicalCandle } from '../../shared/types';
import { buildAnalogIndex, searchAnalogs, summarizeAnalogs, type AnalogSearchConfig } from '../aranha/analogs';
import { resampleCompleted, type Bar } from '../aranha/resample';
import { regimeAt } from '../aranha/structures';
import type { CoinScore, MarketBar, ScorePart } from './types';

/** Fixed before the crawler backtest. Not adjusted after seeing a result. */
export const CRAWLER_WEIGHTS = Object.freeze({
  regime: 25,
  breakout: 15,
  volume: 10,
  analog: 20,
  relativeStrength: 15,
  whale: 10,
  volatility: 10
});

export const CRAWLER_ANALOG: AnalogSearchConfig = {
  window: 24,
  horizon: 12,
  k: 8,
  separation: 12,
  candidateStride: 3
};

const FIVE_MINUTES = 300_000;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function toCanonical(symbol: string, bars: readonly MarketBar[]): CanonicalCandle[] {
  return bars.map(bar => ({
    venue: 'binance',
    symbol,
    interval: '5m',
    openTime: bar.openTime,
    closeTime: bar.openTime + FIVE_MINUTES - 1,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    quoteVolume: bar.quoteVolume,
    source: 'historical' as const,
    ingestedAt: bar.openTime
  }));
}

function asBars(candles: readonly MarketBar[]): Bar[] {
  return candles.map(bar => ({
    openTime: bar.openTime,
    closeTime: bar.openTime + FIVE_MINUTES - 1,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume
  }));
}

function regimeName(bars: readonly Bar[]): 'alta' | 'baixa' | 'lateral' | 'indefinido' {
  if (bars.length < 21) return 'indefinido';
  const regime = regimeAt(bars, bars.length - 1);
  if (regime === 'up') return 'alta';
  if (regime === 'down') return 'baixa';
  if (regime === 'range') return 'lateral';
  return 'indefinido';
}

function regimeValue(hour: string, four: string): number {
  const side = (label: string) => label === 'alta' ? 1 : label === 'baixa' ? -1 : 0;
  const left = side(hour);
  const right = side(four);
  if (left === 0 && right === 0) return 0;
  if (left === 0) return right * 0.5;
  if (right === 0) return left * 0.5;
  return left === right ? left : 0;
}

function regimeSentence(hour: string, four: string): string {
  if (hour === 'alta' && four === 'alta') return '1h e 4h estão em alta.';
  if (hour === 'baixa' && four === 'baixa') return '1h e 4h estão em baixa.';
  if (hour === 'indefinido' && four === 'indefinido') return 'Ainda não há tendência de 1h ou 4h.';
  return `1h está ${hour} e 4h está ${four}.`;
}

export function breakoutNow(bars: readonly MarketBar[]): number {
  const index = bars.length - 1;
  if (index < 20) return 0;
  let ceiling = -Infinity;
  let floor = Infinity;
  for (let i = index - 20; i < index; i++) {
    if (bars[i].high > ceiling) ceiling = bars[i].high;
    if (bars[i].low < floor) floor = bars[i].low;
  }
  if (bars[index].close > ceiling) return 1;
  if (bars[index].close < floor) return -1;
  return 0;
}

export function signedVolumeSpike(bars: readonly MarketBar[]): number {
  const index = bars.length - 1;
  if (index < 20) return 0;
  const volumes = bars.slice(index - 20, index).map(bar => bar.volume).sort((a, b) => a - b);
  const typical = volumes[Math.floor(volumes.length / 2)] ?? 0;
  if (!(typical > 0) || bars[index].volume < typical * 2) return 0;
  return bars[index].close >= bars[index].open ? 1 : -1;
}

export function returnOver(bars: readonly { close: number }[], barsBack: number): number | null {
  const index = bars.length - 1;
  if (index < barsBack) return null;
  const past = bars[index - barsBack].close;
  if (!(past > 0)) return null;
  return bars[index].close / past - 1;
}

export function takerPressure(bars: readonly MarketBar[], lookback = 12): number | null {
  const index = bars.length - 1;
  if (index < 0) return null;
  let quote = 0;
  let buy = 0;
  const from = Math.max(0, index - lookback + 1);
  for (let i = from; i <= index; i++) {
    quote += bars[i].quoteVolume;
    buy += bars[i].takerBuyQuote;
  }
  if (!(quote > 0) || buy <= 0) return null;
  return clamp((buy / quote - 0.5) * 2, -1, 1);
}

function atrRatio(bars: readonly MarketBar[]): number | null {
  if (bars.length < 15) return null;
  let sum = 0;
  const end = bars.length - 1;
  for (let i = end - 13; i <= end; i++) {
    const current = bars[i];
    const previous = bars[i - 1];
    sum += Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
  }
  const close = bars[end].close;
  if (!(close > 0)) return null;
  return (sum / 14) / close;
}

function part(id: string, label: string, value: number, weight: number, sentence: string): ScorePart {
  return { id, label, points: Math.round(value * weight * 10) / 10, sentence };
}

export function explainScore(parts: readonly ScorePart[]): string {
  const useful = parts
    .filter(item => Math.abs(item.points) >= 4)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  if (useful.length === 0) return 'Nada se destacou. O score fica perto de zero.';
  return useful.slice(0, 3).map(item => item.sentence).join(' ');
}

/**
 * Transparent rank score at the last bar of `bars`.
 * `bars` must already be cut at the decision. Analog search only sees that prefix.
 */
export function scoreCoin(input: {
  symbol: string;
  bars: readonly MarketBar[];
  btcBars: readonly MarketBar[];
  whalePressure?: number | null;
  analog?: AnalogSearchConfig;
  /** Causal index of the full series. Search still stops at `endIndex`. */
  analogIndex?: ReturnType<typeof buildAnalogIndex>;
  endIndex?: number;
}): CoinScore {
  const end = input.endIndex ?? input.bars.length - 1;
  const bars = input.endIndex === undefined ? input.bars : input.bars.slice(0, end + 1);
  const last = bars[bars.length - 1];
  const analogConfig = input.analog ?? CRAWLER_ANALOG;
  const empty = (reason: string): CoinScore => ({
    symbol: input.symbol,
    score: 0,
    reason,
    parts: [],
    lastPrice: last?.close ?? 0,
    changeLookbackPct: null,
    regime1h: 'indefinido',
    regime4h: 'indefinido',
    analogCount: 0,
    analogMedianBps: null,
    relativeStrength: null,
    whalePressure: input.whalePressure ?? null
  });
  if (!last || !(last.close > 0)) return empty('Sem preço para pontuar.');

  const series = asBars(bars);
  const asOfClose = series[series.length - 1].closeTime;
  const hour = regimeName(resampleCompleted(series, 3_600_000, FIVE_MINUTES, asOfClose));
  const four = regimeName(resampleCompleted(series, 14_400_000, FIVE_MINUTES, asOfClose));
  const regime = regimeValue(hour, four);
  const breakout = breakoutNow(bars);
  const volume = signedVolumeSpike(bars);
  const btcVisible = input.btcBars.filter(bar => bar.openTime <= last.openTime);
  const coinReturn = returnOver(bars, 12);
  const btcReturn = returnOver(btcVisible, 12);
  const relative = coinReturn !== null && btcReturn !== null ? clamp((coinReturn - btcReturn) / 0.02, -1, 1) : null;
  const taker = takerPressure(bars);
  const whale = input.whalePressure ?? taker;
  const whaleValue = whale === null ? 0 : clamp(whale, -1, 1);
  const vol = atrRatio(bars);
  const volValue = vol === null ? 0 : vol > 0.012 ? -1 : vol > 0.007 ? -0.5 : 0;

  let analogCount = 0;
  let analogMedian: number | null = null;
  let analogValue = 0;
  if (bars.length >= analogConfig.window * 2) {
    const index = input.analogIndex ?? buildAnalogIndex(toCanonical(input.symbol, bars), analogConfig.window);
    const found = searchAnalogs(index, input.endIndex ?? bars.length - 1, analogConfig);
    const summary = summarizeAnalogs(found);
    analogCount = summary.count;
    analogMedian = summary.medianForwardReturnBps;
    if (summary.count >= 8 && summary.medianForwardReturnBps !== null) {
      analogValue = clamp(summary.medianForwardReturnBps / 30, -1, 1);
    }
  }

  const parts: ScorePart[] = [
    part('regime', 'Tendência', regime, CRAWLER_WEIGHTS.regime, regimeSentence(hour, four)),
    part('breakout', 'Rompimento', breakout, CRAWLER_WEIGHTS.breakout,
      breakout > 0 ? 'O fechamento rompeu a máxima das últimas 20 velas.' : breakout < 0 ? 'O fechamento rompeu a mínima das últimas 20 velas.' : 'Sem rompimento agora.'),
    part('volume', 'Volume', volume, CRAWLER_WEIGHTS.volume,
      volume > 0 ? 'Volume anormal numa vela de alta.' : volume < 0 ? 'Volume anormal numa vela de baixa.' : 'Volume dentro do normal.'),
    part('analog', 'Trechos parecidos', analogValue, CRAWLER_WEIGHTS.analog,
      analogCount >= 8 && analogMedian !== null
        ? `Trechos parecidos: mediana ${analogMedian > 0 ? '+' : ''}${analogMedian.toFixed(0)} bps em ${analogCount} casos.`
        : 'Poucos trechos parecidos para entrar no score.'),
    part('rs', 'Força contra o BTC', relative ?? 0, CRAWLER_WEIGHTS.relativeStrength,
      relative === null ? 'Sem comparação com o BTC.' : relative > 0.25 ? 'Na última hora ficou mais forte que o BTC.' : relative < -0.25 ? 'Na última hora ficou mais fraca que o BTC.' : 'Força parecida com a do BTC.'),
    part('whale', 'Baleias', whaleValue, CRAWLER_WEIGHTS.whale,
      whale === null ? 'Sem leitura de baleia.' : whale > 0.2 ? 'A pressão recente das negociações é compradora.' : whale < -0.2 ? 'A pressão recente das negociações é vendedora.' : 'Compra e venda grandes estão equilibradas.'),
    part('vol', 'Volatilidade', volValue, CRAWLER_WEIGHTS.volatility,
      volValue < 0 ? 'A volatilidade está alta e o score perde pontos.' : 'Volatilidade dentro do limite.')
  ];
  const score = Math.round(parts.reduce((sum, item) => sum + item.points, 0) * 10) / 10;
  const lookback = returnOver(bars, 12);
  return {
    symbol: input.symbol,
    score,
    reason: explainScore(parts),
    parts,
    lastPrice: last.close,
    changeLookbackPct: lookback === null ? null : lookback * 100,
    regime1h: hour,
    regime4h: four,
    analogCount,
    analogMedianBps: analogMedian,
    relativeStrength: relative,
    whalePressure: whale
  };
}

export function rankScores(scores: readonly CoinScore[]): CoinScore[] {
  return scores.slice().sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
}
