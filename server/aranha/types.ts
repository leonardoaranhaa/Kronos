import type { ResearchSignal } from '../signals';

export type Bias = 'alta' | 'baixa' | 'neutro';
export type Timeframe = '5m' | '1h' | '4h';
export type LlmMode = 'desligado' | 'anthropic' | 'openai';

export interface AnalogMatch {
  endIndex: number;
  endOpenTime: number;
  distance: number;
  forwardReturnBps: number;
  direction: 'up' | 'down' | 'flat';
  /** Query-window closes scaled to 0..1, shared with `forward`. */
  spark: number[];
  /** Path from the analog's last close through the forward horizon, same scale. */
  forward: number[];
}

export interface AnalogSummary {
  count: number;
  hitRateUp: number | null;
  hitRateDown: number | null;
  flatCount: number;
  meanForwardReturnBps: number | null;
  medianForwardReturnBps: number | null;
  p25Bps: number | null;
  p75Bps: number | null;
  medianDistance: number | null;
}

export interface PatternHit {
  id: string;
  name: string;
  timeframe: Timeframe;
  activeNow: boolean;
  hitRateUp: number | null;
  hitRateDown: number | null;
  sampleCount: number;
  medianForwardReturnBps: number | null;
  horizonBars: number;
  horizonLabel: string;
  detail: string;
}

export interface PriceZone {
  timeframe: Timeframe;
  kind: 'support' | 'resistance';
  low: number;
  high: number;
  touches: number;
}

export interface ChartMarker {
  openTime: number;
  label: string;
  side: 'up' | 'down';
}

export interface ChartCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface ChartReading {
  /** Mechanical reading. Always present, including when the LLM is off. */
  text: string;
  bias: Bias;
  caveats: string[];
  llmText: string | null;
  llmBias: Bias | null;
  llmMode: LlmMode;
}

export interface PatternContext {
  asOfOpenTime: number | null;
  symbol: string;
  interval: string;
  window: number;
  horizonBars: number;
  horizonLabel: string;
  regime: { label: string; detail: string };
  regimes: { timeframe: Timeframe; label: string }[];
  tags: string[];
  analogs: AnalogMatch[];
  analogSummary: AnalogSummary;
  patterns: PatternHit[];
  zones: PriceZone[];
  markers: ChartMarker[];
  recent: ChartCandle[];
  chartReading: ChartReading;
  note: string;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  fetchedAt: string;
  sentiment: number | null;
  eventType: string;
  relevance: number;
  urgency: number;
  summary: string;
  method: 'llm' | 'lexico';
}

export interface WebCitation {
  url: string;
  title: string;
  citedText: string | null;
}

export interface FearGreedReading {
  value: number;
  classification: string;
  labelPt: string;
  fetchedAt: string;
}

export interface WebContext {
  asOf: string;
  llm: LlmMode;
  llmModel: string | null;
  webSearch: 'usado' | 'indisponível' | 'desligado';
  sentiment: number | null;
  fearGreed: FearGreedReading | null;
  items: NewsItem[];
  citations: WebCitation[];
  errors: string[];
  note: string;
}

export interface AranhaVerdict {
  bias: Bias;
  note: string;
  chartBias: Bias;
  webBias: Bias;
  agrees: boolean | null;
}

export interface AranhaContext {
  asOf: string;
  symbol: string;
  pattern: PatternContext;
  web: WebContext;
  verdict: AranhaVerdict;
  filterEnabled: boolean;
  signal: ResearchSignal | null;
  /** Signal after the optional filter. Equals `signal` when the filter is off. */
  usedSignal: ResearchSignal | null;
}
