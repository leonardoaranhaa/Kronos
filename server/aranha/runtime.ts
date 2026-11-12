import type { ResearchSignal } from '../signals';
import { CanonicalCandle } from '../../shared/types';
import { renderChartPng } from './chart-png';
import { readAranhaConfig, type AranhaConfig } from './config';
import { fuse } from './fusion';
import { createLlmProvider, type LlmProvider } from './llm';
import { ARANHA_GATES } from './gates';
import { latestPatternContext } from './pattern';
import { chartAnalystPrompt, compactChartSummary, parseChartAnalyst } from './reading';
import { writeWebSnapshot } from './snapshots';
import type { AranhaContext, PatternContext } from './types';
import { buildWebContext, emptyWebContext, FileSourceCache, type SourceCache } from './web';

export class AranhaRuntime {
  private candles: CanonicalCandle[] = [];
  private signal: ResearchSignal | null = null;
  private web = emptyWebContext('A coleta da web ainda não rodou. O gráfico já pode ser lido.');
  private cached: { key: string; pattern: PatternContext } | null = null;
  private llmNote: { openTime: number; text: string; caveats: string[] } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private lastWeb = 0;
  private lastLlm = 0;
  private readonly provider: LlmProvider | null;
  private readonly cache: SourceCache;

  constructor(
    private readonly config: AranhaConfig = readAranhaConfig(),
    deps: { fetchImpl?: typeof fetch; provider?: LlmProvider | null; cache?: SourceCache } = {}
  ) {
    this.provider = deps.provider === undefined ? createLlmProvider() : deps.provider;
    this.cache = deps.cache ?? new FileSourceCache(config.cacheDir);
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  private readonly fetchImpl: typeof fetch;

  setCandles(candles: readonly CanonicalCandle[]): void {
    const sorted = candles.slice().sort((a, b) => a.openTime - b.openTime);
    const next: CanonicalCandle[] = [];
    for (const candle of sorted) {
      if (next.length > 0 && candle.openTime <= next[next.length - 1].openTime) continue;
      next.push(candle);
    }
    this.candles = next;
    this.cached = null;
  }

  append(candle: CanonicalCandle): void {
    const last = this.candles[this.candles.length - 1];
    if (last && candle.openTime <= last.openTime) return;
    this.candles.push(candle);
    this.cached = null;
  }

  noteSignal(signal: ResearchSignal | null): void {
    this.signal = signal;
  }

  private pattern(): PatternContext {
    const last = this.candles[this.candles.length - 1];
    const key = `${this.candles.length}:${last?.openTime ?? 0}:${this.config.window}:${this.config.horizon}`;
    if (this.cached?.key === key) return this.cached.pattern;
    const pattern = latestPatternContext(this.candles, {
      window: this.config.window,
      horizon: this.config.horizon,
      k: this.config.neighbors,
      separation: ARANHA_GATES.separation,
      candidateStride: 1
    });
    this.cached = { key, pattern };
    return pattern;
  }

  view(): AranhaContext {
    const pattern = this.pattern();
    const reading = { ...pattern.chartReading };
    if (this.llmNote && pattern.asOfOpenTime === this.llmNote.openTime) {
      reading.llmText = this.llmNote.text;
      reading.llmMode = this.provider?.id ?? 'desligado';
      reading.caveats = [...reading.caveats, ...this.llmNote.caveats];
    } else if (!this.provider) {
      reading.llmMode = 'desligado';
    }
    return fuse({ ...pattern, chartReading: reading }, this.web, this.signal, this.config.filterEnabled);
  }

  startBackground(): void {
    if (!this.config.webEnabled) {
      this.web = emptyWebContext('Coleta da web desligada por configuração. O gráfico continua ativo.');
      return;
    }
    void this.refreshWeb();
    void this.refreshChartReading();
    this.timer = setInterval(() => {
      void this.refreshWeb();
      void this.refreshChartReading();
    }, Math.max(this.config.webMinRefreshMs, 1_000));
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async refreshWeb(now = Date.now()): Promise<void> {
    if (!this.config.webEnabled || this.refreshing) return;
    if (this.lastWeb !== 0 && now - this.lastWeb < this.config.webMinRefreshMs) return;
    this.refreshing = true;
    try {
      const context = await buildWebContext({
        symbol: this.config.symbol,
        now,
        fetchImpl: this.fetchImpl,
        cache: this.cache,
        provider: this.provider
      });
      this.web = context;
      this.lastWeb = now;
      try {
        await writeWebSnapshot(this.config.snapshotDir, context);
      } catch (error) {
        context.errors.push(`Não gravei o snapshot: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      this.refreshing = false;
    }
  }

  async refreshChartReading(now = Date.now()): Promise<void> {
    if (!this.provider) return;
    if (this.lastLlm !== 0 && now - this.lastLlm < this.config.llmMinIntervalMs) return;
    const pattern = this.pattern();
    if (pattern.asOfOpenTime === null) return;
    this.lastLlm = now;
    try {
      const prompt = chartAnalystPrompt(compactChartSummary(pattern));
      const image = this.config.chartImage ? renderChartPng(pattern.recent, pattern.zones).toString('base64') : undefined;
      const result = await this.provider.complete({
        system: prompt.system,
        user: prompt.user,
        imagePngBase64: image,
        webSearch: false,
        maxTokens: 600
      });
      const parsed = parseChartAnalyst(result.text, pattern.chartReading.bias);
      if (!parsed) {
        this.llmNote = {
          openTime: pattern.asOfOpenTime,
          text: 'O modelo respondeu, mas não no formato combinado. A leitura mecânica acima continua valendo.',
          caveats: ['Resposta do modelo ilegível.']
        };
        return;
      }
      this.llmNote = { openTime: pattern.asOfOpenTime, text: parsed.text, caveats: parsed.caveats };
    } catch (error) {
      this.llmNote = {
        openTime: pattern.asOfOpenTime,
        text: 'A leitura do modelo falhou. A leitura mecânica continua valendo.',
        caveats: [error instanceof Error ? error.message : String(error)]
      };
    }
  }
}
