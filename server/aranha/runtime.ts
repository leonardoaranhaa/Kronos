import type { ResearchSignal } from '../signals';
import { CanonicalCandle } from '../../shared/types';
import { renderChartPng } from './chart-png';
import { readAranhaConfig, type AranhaConfig } from './config';
import { fuse } from './fusion';
import {
  LLM_ACCOUNT_BACKOFF_MS,
  LlmRequestError,
  createLlmProvider,
  llmFailureReason,
  type LlmFailureKind,
  type LlmProvider,
  type LlmUsage
} from './llm';
import { ARANHA_GATES } from './gates';
import { latestPatternContext } from './pattern';
import { chartAnalystPrompt, compactChartSummary, parseChartAnalyst } from './reading';
import { writeWebSnapshot } from './snapshots';
import type { AranhaContext, LlmAccountStatus, PatternContext } from './types';
import { buildWebContext, emptyWebContext, FileSourceCache, type SourceCache } from './web';

export class AranhaRuntime {
  private candles: CanonicalCandle[] = [];
  private signal: ResearchSignal | null = null;
  private web = emptyWebContext('A coleta da web ainda não rodou. O gráfico já pode ser lido.');
  private cached: { key: string; pattern: PatternContext } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private lastWeb = 0;
  private blockedUntil = 0;
  private nextChartAt = 0;
  private nextWebLlmAt = 0;
  private hold: { reason: string; kind: LlmFailureKind } | null = null;
  private lastCall: { at: number; ok: boolean; reason: string | null } | null = null;
  private lastUsage: LlmUsage | null = null;
  private lastGoodReading: { text: string; caveats: string[]; at: number } | null = null;
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
    const reading = { ...pattern.chartReading, caveats: [...pattern.chartReading.caveats] };
    if (this.lastGoodReading) {
      reading.llmText = this.lastGoodReading.text;
      reading.caveats = [...reading.caveats, ...this.lastGoodReading.caveats];
    }
    const status = this.llmStatus();
    reading.llmMode = status.mode === 'erro'
      ? 'erro'
      : status.lastCallOk && this.provider
        ? this.provider.id
        : 'desligado';
    if (status.mode === 'erro' && status.reason) reading.caveats = [...reading.caveats, status.reason];
    return fuse({ ...pattern, chartReading: reading }, this.web, this.signal, this.config.filterEnabled, status);
  }

  private llmStatus(): LlmAccountStatus {
    if (!this.provider) {
      return {
        configured: false,
        provider: null,
        model: null,
        mode: 'desligado',
        reason: null,
        lastCallAt: null,
        lastCallOk: null,
        readingAt: null,
        usage: null
      };
    }
    const failed = this.lastCall?.ok === false;
    return {
      configured: true,
      provider: this.provider.id,
      model: this.provider.model,
      mode: failed ? 'erro' : this.lastCall?.ok ? this.provider.id : 'desligado',
      reason: failed ? this.lastCall?.reason ?? null : null,
      lastCallAt: this.lastCall ? new Date(this.lastCall.at).toISOString() : null,
      lastCallOk: this.lastCall ? this.lastCall.ok : null,
      readingAt: this.lastGoodReading ? new Date(this.lastGoodReading.at).toISOString() : null,
      usage: this.lastUsage
    };
  }

  private rememberSuccess(at: number, usage: LlmUsage | null, nextAt: 'chart' | 'web'): void {
    this.lastCall = { at, ok: true, reason: null };
    if (usage && (usage.inputTokens !== null || usage.outputTokens !== null || usage.webSearchRequests !== null)) {
      this.lastUsage = usage;
    }
    const next = at + this.config.llmMinIntervalMs;
    if (nextAt === 'chart') this.nextChartAt = next;
    else this.nextWebLlmAt = next;
  }

  private rememberFailure(at: number, kind: LlmFailureKind): void {
    const reason = llmFailureReason(kind);
    this.lastCall = { at, ok: false, reason };
    this.hold = { reason, kind };
    const wait = kind === 'billing' || kind === 'auth' ? LLM_ACCOUNT_BACKOFF_MS : this.config.llmMinIntervalMs;
    const until = at + wait;
    this.blockedUntil = Math.max(this.blockedUntil, until);
    this.nextChartAt = Math.max(this.nextChartAt, until);
    this.nextWebLlmAt = Math.max(this.nextWebLlmAt, until);
  }

  startBackground(): void {
    if (!this.config.webEnabled && !this.provider) return;
    if (!this.config.webEnabled) {
      this.web = emptyWebContext('Coleta da web desligada por configuração. O gráfico continua ativo.');
    }
    void this.refreshCycle();
    this.timer = setInterval(() => {
      void this.refreshCycle();
    }, Math.max(this.config.webMinRefreshMs, 1_000));
    this.timer.unref();
  }

  private async refreshCycle(now = Date.now()): Promise<void> {
    if (this.config.webEnabled) await this.refreshWeb(now);
    await this.refreshChartReading(Date.now());
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
      const skipLlm = Boolean(this.provider) && (now < this.blockedUntil || now < this.nextWebLlmAt);
      const held = skipLlm && this.hold && now < this.blockedUntil ? this.hold : null;
      const context = await buildWebContext({
        symbol: this.config.symbol,
        now,
        fetchImpl: this.fetchImpl,
        cache: this.cache,
        provider: skipLlm ? null : this.provider,
        llmHold: held
      });
      if (skipLlm && !held && this.lastCall?.ok && this.provider) {
        context.llm = this.provider.id;
        context.llmModel = this.provider.model;
        context.llmReason = null;
        context.usage = this.lastUsage;
        context.llmFailure = null;
        context.note = 'O modelo não foi chamado de novo nesta coleta. O tom novo, quando há palavra reconhecida, veio da lista fixa.';
      }
      if (!skipLlm && context.llmFailure) this.rememberFailure(now, context.llmFailure);
      else if (!skipLlm && (context.llm === 'anthropic' || context.llm === 'openai')) this.rememberSuccess(now, context.usage, 'web');
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
    if (now < this.blockedUntil || now < this.nextChartAt) return;
    const pattern = this.pattern();
    if (pattern.asOfOpenTime === null) return;
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
      this.rememberSuccess(now, result.usage, 'chart');
      if (!parsed) {
        this.lastCall = { at: now, ok: false, reason: 'O modelo respondeu fora do formato combinado' };
        return;
      }
      this.lastGoodReading = { text: parsed.text, caveats: parsed.caveats, at: now };
    } catch (error) {
      const kind = error instanceof LlmRequestError ? error.kind : 'other';
      this.rememberFailure(now, kind);
    }
  }
}
