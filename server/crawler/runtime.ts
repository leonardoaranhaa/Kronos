import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import { buildPatternContext } from '../aranha/pattern';
import { emptyLlmStatus, fuse } from '../aranha/fusion';
import { emptyWebContext } from '../aranha/web';
import { readCrawlerConfig, type CrawlerConfig } from './config';
import {
  findWalls,
  parseAggTrade,
  parseBlockscoutTransfers,
  parseDepth,
  parseMempoolRecent,
  parseMempoolTransaction,
  tagTransfer,
  toWhalePrint,
  whalePressure
} from './whales';
import { parseTickerPayload, selectUniverse } from './universe';
import { scoreCoin, toCanonical } from './score';
import type { BookWall, CrawlerRow, CrawlerSnapshot, MarketBar, OnchainEvent, WhalePrint } from './types';

export interface CrawlerForecaster {
  ready(): boolean;
  predict(symbol: string, bars: readonly MarketBar[]): Promise<number[] | null>;
}

export class CrawlerRuntime {
  private readonly config: CrawlerConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly forecaster: CrawlerForecaster | null;
  private timer: NodeJS.Timeout | null = null;
  private socket: WebSocket | null = null;
  private readonly bars = new Map<string, MarketBar[]>();
  private readonly tickers = new Map<string, { lastPrice: number; change24hPct: number; quoteVolume: number }>();
  private readonly prints = new Map<string, WhalePrint[]>();
  private whales: WhalePrint[] = [];
  private walls: BookWall[] = [];
  private onchain: OnchainEvent[] = [];
  private seenOnchain = new Set<string>();
  private rows: CrawlerRow[] = [];
  private forecasts = new Map<string, number | null>();
  private errors: string[] = [];
  private updatedAt = new Date(0).toISOString();
  private refreshing = false;
  private readonly recentPrints: WhalePrint[] = [];

  constructor(
    config: CrawlerConfig = readCrawlerConfig(),
    deps: { fetchImpl?: typeof fetch; forecaster?: CrawlerForecaster | null } = {}
  ) {
    this.config = config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.forecaster = deps.forecaster === undefined ? null : deps.forecaster;
  }

  snapshot(): CrawlerSnapshot {
    return {
      updatedAt: this.updatedAt,
      disclaimer: 'Varredura de pesquisa. Nenhuma ordem é enviada. O score não é probabilidade de ganho.',
      universeSize: this.rows.length,
      kronosTop: this.config.kronosTop,
      kronosNote: this.kronosNote(),
      rows: this.rows,
      whales: this.whales.slice(0, 20),
      walls: this.walls.slice(0, 12),
      onchain: this.onchain.slice(0, 20),
      errors: this.errors.slice(0, 6)
    };
  }

  detail(symbol: string) {
    const bars = this.bars.get(symbol.toUpperCase()) ?? [];
    const btc = this.bars.get('BTCUSDT') ?? [];
    const score = bars.length ? scoreCoin({
      symbol: symbol.toUpperCase(),
      bars,
      btcBars: btc,
      whalePressure: whalePressure(this.prints.get(symbol.toUpperCase()) ?? [])
    }) : null;
    const pattern = bars.length >= 30
      ? buildPatternContext(toCanonical(symbol.toUpperCase(), bars), bars.length - 1)
      : null;
    const web = emptyWebContext('As notícias continuam na aba do par principal. Esta ficha é o gráfico desta moeda.');
    const context = pattern ? fuse(pattern, web, null, false, emptyLlmStatus()) : null;
    if (context && score) {
      context.verdict = {
        ...context.verdict,
        bias: score.score >= 8 ? 'alta' : score.score <= -8 ? 'baixa' : 'neutro',
        note: score.reason
      };
    }
    return { symbol: symbol.toUpperCase(), score, context, candles: bars.slice(-120) };
  }

  /** Used by tests. Replaces the candle buffer and ranks without touching the network. */
  rankSymbols(symbols: string[]): CrawlerRow[] {
    const btc = this.bars.get('BTCUSDT') ?? [];
    const scores = symbols.flatMap(symbol => {
      const bars = this.bars.get(symbol);
      if (!bars || bars.length < 30) return [];
      return [scoreCoin({
        symbol,
        bars,
        btcBars: symbol === 'BTCUSDT' ? bars : btc,
        whalePressure: whalePressure(this.prints.get(symbol) ?? [])
      })];
    }).sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
    const ready = this.forecaster?.ready() ?? false;
    return scores.map((score, index) => this.toRow(score.symbol, score.score, score.reason, score.lastPrice, score.regime1h, index, ready));
  }

  setBars(symbol: string, bars: readonly MarketBar[]): void {
    this.bars.set(symbol, bars.slice());
  }

  notePrint(print: WhalePrint): void {
    const list = this.prints.get(print.symbol) ?? [];
    list.push(print);
    this.prints.set(print.symbol, list.slice(-40));
    this.recentPrints.unshift(print);
    this.whales = this.recentPrints.slice(0, 40);
  }

  async refreshRanks(): Promise<CrawlerRow[]> {
    const symbols = [...this.bars.keys()];
    const rows = this.rankSymbols(symbols);
    await this.fillForecasts(rows);
    this.rows = rows.map(row => {
      const bps = this.forecasts.get(row.symbol);
      if (bps === undefined) return row;
      return { ...row, kronos: bps === null ? 'indisponivel' : 'rodou', kronosBps: bps };
    });
    this.updatedAt = new Date().toISOString();
    return this.rows;
  }

  start(): void {
    if (!this.config.enabled) return;
    void this.cycle();
    this.timer = setInterval(() => { void this.cycle(); }, this.config.refreshMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }

  private kronosNote(): string {
    if (this.config.kronosTop <= 0) return 'A previsão do Kronos está desligada no crawler.';
    if (!this.forecaster || !this.forecaster.ready()) {
      return `Kronos-small só seria chamado nas ${this.config.kronosTop} primeiras. O modelo não está pronto, então a tabela não espera por ele.`;
    }
    return `Kronos-small roda só nas ${this.config.kronosTop} primeiras, uma de cada vez. As outras não recebem previsão do modelo.`;
  }

  private toRow(symbol: string, score: number, reason: string, lastPrice: number, regime: string, index: number, ready: boolean): CrawlerRow {
    const ticker = this.tickers.get(symbol);
    let kronos: CrawlerRow['kronos'] = 'fora';
    if (index < this.config.kronosTop) kronos = ready ? 'fila' : 'indisponivel';
    return {
      symbol,
      score,
      reason,
      lastPrice: ticker?.lastPrice || lastPrice,
      change24hPct: ticker?.change24hPct ?? null,
      quoteVolume24h: ticker?.quoteVolume ?? null,
      regime,
      kronos,
      kronosBps: null,
      whalePressure: whalePressure(this.prints.get(symbol) ?? [])
    };
  }

  private async fillForecasts(rows: readonly CrawlerRow[]): Promise<void> {
    if (!this.forecaster?.ready()) return;
    const top = rows.slice(0, this.config.kronosTop);
    for (const row of top) {
      const bars = this.bars.get(row.symbol);
      if (!bars || bars.length < 32) continue;
      try {
        const predicted = await this.forecaster.predict(row.symbol, bars);
        if (!predicted || predicted.length === 0) {
          this.forecasts.set(row.symbol, null);
          continue;
        }
        const close = bars[bars.length - 1].close;
        const last = predicted[predicted.length - 1];
        this.forecasts.set(row.symbol, close > 0 ? ((last - close) / close) * 10_000 : null);
      } catch {
        this.forecasts.set(row.symbol, null);
      }
    }
  }

  private async cycle(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.loadUniverse();
      await this.refreshRanks();
      await this.loadOnchain();
      this.openSocket();
    } catch (error) {
      this.errors.unshift(error instanceof Error ? error.message : String(error));
      this.errors = this.errors.slice(0, 8);
    } finally {
      this.refreshing = false;
    }
  }

  private async loadUniverse(): Promise<void> {
    const symbols = this.config.symbols.length
      ? this.config.symbols
      : await this.topSymbols();
    const needed = symbols.filter(symbol => (this.bars.get(symbol)?.length ?? 0) < 50);
    for (const symbol of needed) {
      try {
        const bars = await this.klines(symbol);
        if (bars.length) this.bars.set(symbol, bars);
      } catch (error) {
        this.errors.unshift(`${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
      await this.depth(symbol);
    }
  }

  private async topSymbols(): Promise<string[]> {
    const response = await this.fetchImpl(`${this.config.restBase}/api/v3/ticker/24hr`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Ticker público HTTP ${response.status}`);
    const tickers = parseTickerPayload(await response.json());
    for (const ticker of tickers) {
      this.tickers.set(ticker.symbol, {
        lastPrice: ticker.lastPrice,
        change24hPct: ticker.priceChangePercent,
        quoteVolume: ticker.quoteVolume
      });
    }
    const selected = selectUniverse(tickers, this.config.universeSize).map(ticker => ticker.symbol);
    if (!selected.includes('BTCUSDT')) selected.unshift('BTCUSDT');
    return selected.slice(0, this.config.universeSize);
  }

  private async klines(symbol: string): Promise<MarketBar[]> {
    const now = Date.now();
    let cursor = now - 8 * 24 * 60 * 60 * 1000;
    const bars: MarketBar[] = [];
    for (let pageNumber = 0; pageNumber < 3 && cursor < now; pageNumber++) {
      const url = new URL(`${this.config.restBase}/api/v3/klines`);
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('interval', '5m');
      url.searchParams.set('startTime', String(cursor));
      url.searchParams.set('endTime', String(now));
      url.searchParams.set('limit', '1000');
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`klines HTTP ${response.status}`);
      const page = await response.json() as unknown[];
      if (!Array.isArray(page) || page.length === 0) break;
      for (const row of page) {
        if (!Array.isArray(row) || row.length < 11) continue;
        const closeTime = Number(row[6]);
        if (closeTime >= now) continue;
        bars.push({
          openTime: Number(row[0]),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
          quoteVolume: Number(row[7]),
          takerBuyQuote: Number(row[10])
        });
      }
      const lastOpen = Number((page[page.length - 1] as unknown[])[0]);
      if (!(lastOpen + 300_000 > cursor)) break;
      cursor = lastOpen + 300_000;
      if (page.length < 1000) break;
    }
    return bars;
  }

  private async depth(symbol: string): Promise<void> {
    try {
      const url = new URL(`${this.config.restBase}/api/v3/depth`);
      url.searchParams.set('symbol', symbol);
      url.searchParams.set('limit', '20');
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      const book = parseDepth(await response.json());
      if (!book) return;
      const next = findWalls(symbol, book);
      this.walls = [...next, ...this.walls.filter(wall => wall.symbol !== symbol)].slice(0, 40);
    } catch {
      // A missing book does not blank the ranking.
    }
  }

  private openSocket(): void {
    if (this.socket || this.bars.size === 0) return;
    const streams = [...this.bars.keys()].flatMap(symbol => {
      const lower = symbol.toLowerCase();
      return [`${lower}@kline_5m`, `${lower}@aggTrade`];
    });
    const url = `${this.config.wsBase}/stream?streams=${streams.join('/')}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.on('message', data => {
      try {
        const parsed = JSON.parse(data.toString()) as unknown;
        this.onSocket(parsed);
      } catch {
        // Ignore a bad frame.
      }
    });
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
    });
    socket.on('error', () => socket.close());
  }

  private onSocket(message: unknown): void {
    const trade = parseAggTrade(message);
    if (trade) {
      const print = toWhalePrint(trade, this.config.whaleUsd);
      if (print) {
        this.notePrint(print);
        void this.log('whales.jsonl', print);
      }
      return;
    }
    const data = message && typeof message === 'object' && 'data' in message
      ? (message as { data?: unknown }).data
      : message;
    if (!data || typeof data !== 'object') return;
    const event = data as { e?: string; k?: { t?: number; T?: number; o?: string; h?: string; l?: string; c?: string; v?: string; q?: string; x?: boolean; s?: string } };
    if (event.e !== 'kline' || !event.k?.x || !event.k.s) return;
    const candle = event.k;
    const bar: MarketBar = {
      openTime: Number(candle.t),
      open: Number(candle.o),
      high: Number(candle.h),
      low: Number(candle.l),
      close: Number(candle.c),
      volume: Number(candle.v),
      quoteVolume: Number(candle.q),
      takerBuyQuote: 0
    };
    const symbol = candle.s;
    if (!symbol || ![bar.openTime, bar.close].every(Number.isFinite)) return;
    const list = this.bars.get(symbol) ?? [];
    const last = list[list.length - 1];
    if (last && bar.openTime === last.openTime) list[list.length - 1] = { ...last, ...bar, takerBuyQuote: last.takerBuyQuote };
    else if (!last || bar.openTime > last.openTime) list.push(bar);
    this.bars.set(symbol, list.slice(-400));
  }

  private async loadOnchain(): Promise<void> {
    await this.loadBtcWhales();
    await this.loadEthWhales();
    await this.loadOptionalProviders();
  }

  private async loadBtcWhales(): Promise<void> {
    try {
      const response = await this.fetchImpl('https://mempool.space/api/mempool/recent', { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        this.errors.unshift(`mempool.space HTTP ${response.status}`);
        return;
      }
      const large = parseMempoolRecent(await response.json(), this.config.btcWhale).slice(0, 5);
      for (const item of large) {
        if (this.seenOnchain.has(item.txid)) continue;
        this.seenOnchain.add(item.txid);
        let from: string | null = null;
        let to: string | null = null;
        let time = new Date().toISOString();
        try {
          const detail = await this.fetchImpl(`https://mempool.space/api/tx/${item.txid}`, { signal: AbortSignal.timeout(10_000) });
          if (detail.ok) {
            const parsed = parseMempoolTransaction(await detail.json());
            from = parsed?.from ?? null;
            to = parsed?.to ?? null;
            time = parsed?.time ?? time;
          }
        } catch {
          // The list entry is still useful without the address tag.
        }
        const tagged = tagTransfer('BTC', from, to);
        const event: OnchainEvent = {
          id: item.txid,
          asset: 'BTC',
          time,
          amount: `${item.btc.toFixed(2)} BTC`,
          txid: item.txid,
          url: `https://mempool.space/tx/${item.txid}`,
          direction: tagged.direction,
          label: tagged.label,
          source: 'mempool.space'
        };
        this.onchain.unshift(event);
        void this.log('onchain.jsonl', event);
      }
      this.onchain = this.onchain.slice(0, 40);
    } catch (error) {
      this.errors.unshift(`BTC on-chain: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async loadEthWhales(): Promise<void> {
    try {
      const response = await this.fetchImpl('https://eth.blockscout.com/api/v2/transactions?filter=validated', { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return;
      const ethPrice = this.tickers.get('ETHUSDT')?.lastPrice ?? 0;
      const rows = parseBlockscoutTransfers(await response.json(), this.config.ethWhaleUsd, ethPrice);
      for (const row of rows.slice(0, 5)) {
        if (this.seenOnchain.has(row.hash)) continue;
        this.seenOnchain.add(row.hash);
        const tagged = tagTransfer('ETH', row.from, row.to);
        const event: OnchainEvent = {
          id: row.hash,
          asset: 'ETH',
          time: row.time ?? new Date().toISOString(),
          amount: `${row.eth.toFixed(2)} ETH`,
          txid: row.hash,
          url: `https://eth.blockscout.com/tx/${row.hash}`,
          direction: tagged.direction,
          label: tagged.label,
          source: 'blockscout'
        };
        this.onchain.unshift(event);
        void this.log('onchain.jsonl', event);
      }
    } catch {
      // ETH is optional when the public source is down.
    }
  }

  private async loadOptionalProviders(): Promise<void> {
    const whaleKey = (process.env.WHALE_ALERT_API_KEY || '').trim();
    const etherscan = (process.env.ETHERSCAN_API_KEY || '').trim();
    if (!whaleKey && !etherscan) return;
    if (etherscan) {
      // ERC-20 history from Etherscan needs a chosen address. The key stays unused until that exists.
    }
    if (whaleKey) {
      try {
        const url = new URL('https://api.whale-alert.io/v1/transactions');
        url.searchParams.set('api_key', whaleKey);
        url.searchParams.set('min_value', String(this.config.whaleUsd));
        url.searchParams.set('limit', '8');
        const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
        if (response.ok) {
          const body = await response.json() as { transactions?: { hash?: string; blockchain?: string; timestamp?: number; amount?: number; symbol?: string; from?: { owner?: string }; to?: { owner?: string } }[] };
          for (const tx of body.transactions ?? []) {
            if (!tx.hash || this.seenOnchain.has(tx.hash)) continue;
            this.seenOnchain.add(tx.hash);
            const event: OnchainEvent = {
              id: tx.hash,
              asset: String(tx.symbol || tx.blockchain || 'CRYPTO').toUpperCase(),
              time: tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : new Date().toISOString(),
              amount: `${tx.amount ?? ''} ${tx.symbol ?? ''}`.trim(),
              txid: tx.hash,
              url: `https://whale-alert.io/transaction/${tx.blockchain || 'bitcoin'}/${tx.hash}`,
              direction: tx.to?.owner ? 'entrada na corretora' : tx.from?.owner ? 'saída da corretora' : 'desconhecido',
              label: tx.to?.owner || tx.from?.owner || null,
              source: 'whale-alert'
            };
            this.onchain.unshift(event);
            void this.log('onchain.jsonl', event);
          }
        }
      } catch (error) {
        this.errors.unshift(`Whale Alert: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async log(file: string, row: unknown): Promise<void> {
    try {
      await mkdir(this.config.snapshotDir, { recursive: true });
      await appendFile(join(this.config.snapshotDir, file), `${JSON.stringify(row)}\n`);
    } catch {
      // A full disk should not stop the ranking.
    }
  }
}
