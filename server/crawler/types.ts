export interface MarketBar {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  /** Quote volume of taker buys. Zero when the source does not provide it. */
  takerBuyQuote: number;
}

export interface ScorePart {
  id: string;
  label: string;
  /** Contribution already multiplied by its weight. */
  points: number;
  sentence: string;
}

export interface CoinScore {
  symbol: string;
  score: number;
  reason: string;
  parts: ScorePart[];
  lastPrice: number;
  changeLookbackPct: number | null;
  regime1h: string;
  regime4h: string;
  analogCount: number;
  analogMedianBps: number | null;
  relativeStrength: number | null;
  whalePressure: number | null;
}

export interface TickerInfo {
  symbol: string;
  base: string;
  quote: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  status?: string;
}

export interface CrawlerRow {
  symbol: string;
  score: number;
  reason: string;
  lastPrice: number;
  change24hPct: number | null;
  quoteVolume24h: number | null;
  regime: string;
  kronos: 'fora' | 'fila' | 'rodou' | 'indisponivel';
  kronosBps: number | null;
  whalePressure: number | null;
}

export interface WhalePrint {
  id: string;
  symbol: string;
  time: string;
  usd: number;
  side: 'compra' | 'venda';
  price: number;
}

export interface BookWall {
  symbol: string;
  side: 'compra' | 'venda';
  price: number;
  usd: number;
  distancePct: number;
}

export interface OnchainEvent {
  id: string;
  asset: string;
  time: string;
  amount: string;
  txid: string;
  url: string;
  direction: 'entrada na corretora' | 'saída da corretora' | 'entre carteiras' | 'desconhecido';
  label: string | null;
  source: string;
}

export interface CrawlerSnapshot {
  updatedAt: string;
  disclaimer: string;
  universeSize: number;
  kronosTop: number;
  kronosNote: string;
  rows: CrawlerRow[];
  whales: WhalePrint[];
  walls: BookWall[];
  onchain: OnchainEvent[];
  errors: string[];
}
