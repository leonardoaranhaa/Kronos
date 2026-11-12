export type WebSearchState = 'usado' | 'indisponível' | 'desligado';

export interface LlmCitation {
  url: string;
  title: string;
  citedText: string | null;
}

export interface LlmRequest {
  system: string;
  user: string;
  imagePngBase64?: string;
  webSearch?: boolean;
  maxTokens?: number;
}

export interface LlmUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  webSearchRequests: number | null;
}

export type LlmFailureKind = 'billing' | 'auth' | 'rate' | 'tool' | 'other';

/** Billing and auth will not fix themselves on the normal 10-minute poll. */
export const LLM_ACCOUNT_BACKOFF_MS = 6 * 60 * 60 * 1000;

export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly kind: LlmFailureKind,
    readonly status: number
  ) {
    super(message);
    this.name = 'LlmRequestError';
  }
}

export interface LlmResult {
  provider: 'anthropic' | 'openai';
  model: string;
  text: string;
  citations: LlmCitation[];
  webSearch: WebSearchState;
  usage: LlmUsage;
}

export interface LlmProvider {
  id: 'anthropic' | 'openai';
  model: string;
  complete(request: LlmRequest): Promise<LlmResult>;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  citations?: { type?: string; url?: string; title?: string; cited_text?: string }[];
  content?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function emptyUsage(): LlmUsage {
  return { inputTokens: null, outputTokens: null, webSearchRequests: null };
}

export function parseAnthropicUsage(payload: unknown): LlmUsage {
  const usage = asRecord(asRecord(payload)?.usage);
  const server = asRecord(usage?.server_tool_use);
  return {
    inputTokens: finite(usage?.input_tokens),
    outputTokens: finite(usage?.output_tokens),
    webSearchRequests: finite(server?.web_search_requests)
  };
}

export function parseOpenAiUsage(payload: unknown): LlmUsage {
  const usage = asRecord(asRecord(payload)?.usage);
  return {
    inputTokens: finite(usage?.prompt_tokens ?? usage?.input_tokens),
    outputTokens: finite(usage?.completion_tokens ?? usage?.output_tokens),
    webSearchRequests: finite(usage?.web_search_requests)
  };
}

const BILLING_TEXT = /credit|billing|balance too low|purchase credits|plans & billing/;
const AUTH_TEXT = /authentication|unauthorized|api[- ]?key|permission|forbidden/;
const RATE_TEXT = /rate limit|too many requests|overloaded/;
const TOOL_TEXT = /unsupported tool|unknown tool|invalid tool|tool type|tools\.\d|web_search_20\d+|does not support (the )?web search/;

/** True only when a 400 is about the search-tool version, not the account. */
export function isUnsupportedToolError(status: number, body: string): boolean {
  if (status !== 400) return false;
  const text = body.toLowerCase();
  if (BILLING_TEXT.test(text) || AUTH_TEXT.test(text) || RATE_TEXT.test(text)) return false;
  return TOOL_TEXT.test(text) || (/\btool\b/.test(text) && /unsupported|unknown|invalid|unrecognized/.test(text));
}

export function classifyLlmFailure(status: number | null, body: string): LlmFailureKind {
  const text = body.toLowerCase();
  if (status === 401 || status === 403 || AUTH_TEXT.test(text)) return 'auth';
  if (status === 429 || RATE_TEXT.test(text)) return 'rate';
  if (status === 402 || BILLING_TEXT.test(text)) return 'billing';
  if (status !== null && isUnsupportedToolError(status, body)) return 'tool';
  return 'other';
}

export function llmFailureReason(kind: LlmFailureKind): string {
  if (kind === 'billing') return 'Sem crédito na conta da Anthropic';
  if (kind === 'auth') return 'A chave do modelo foi recusada';
  if (kind === 'rate') return 'O modelo pediu uma pausa (limite de chamadas)';
  if (kind === 'tool') return 'A busca do modelo não está disponível nesta conta';
  return 'O modelo recusou o pedido';
}

function addCitation(list: LlmCitation[], url: unknown, title: unknown, citedText: unknown): void {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  const text = typeof citedText === 'string' && citedText.trim() ? citedText.trim() : null;
  const name = typeof title === 'string' && title.trim() ? title.trim() : url;
  const existing = list.find(item => item.url === url);
  if (existing) {
    if (!existing.citedText && text) existing.citedText = text;
    if (existing.title === existing.url && name !== url) existing.title = name;
    return;
  }
  list.push({ url, title: name, citedText: text });
}

function walkSearchContent(content: unknown, citations: LlmCitation[]): void {
  if (Array.isArray(content)) {
    for (const item of content) walkSearchContent(item, citations);
    return;
  }
  const record = asRecord(content);
  if (!record) return;
  if (record.type === 'web_search_result') addCitation(citations, record.url, record.title, null);
}

/** Pulls the assistant text and the source URLs from an Anthropic Messages response. */
export function parseAnthropicMessage(payload: unknown): { text: string; citations: LlmCitation[]; searched: boolean } {
  const record = asRecord(payload);
  const blocks = Array.isArray(record?.content) ? record.content as ContentBlock[] : [];
  const texts: string[] = [];
  const citations: LlmCitation[] = [];
  let searched = false;
  const usage = asRecord(record?.usage);
  const serverUse = asRecord(usage?.server_tool_use);
  if (Number(serverUse?.web_search_requests) > 0) searched = true;
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
      for (const citation of block.citations ?? []) {
        addCitation(citations, citation.url, citation.title, citation.cited_text);
      }
    }
    if (block?.type === 'server_tool_use' && block.name === 'web_search') searched = true;
    if (block?.type === 'web_search_tool_result') {
      searched = true;
      walkSearchContent(block.content, citations);
    }
  }
  return { text: texts.join('\n').trim(), citations, searched };
}

export function parseOpenAiChat(payload: unknown): string {
  const record = asRecord(payload);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  return typeof message?.content === 'string' ? message.content.trim() : '';
}

export function parseOpenAiResponses(payload: unknown): { text: string; citations: LlmCitation[]; searched: boolean } {
  const record = asRecord(payload);
  const citations: LlmCitation[] = [];
  const texts: string[] = [];
  if (typeof record?.output_text === 'string') texts.push(record.output_text);
  const output = Array.isArray(record?.output) ? record.output : [];
  let searched = false;
  for (const item of output) {
    const block = asRecord(item);
    if (!block) continue;
    if (block.type === 'web_search_call') searched = true;
    const content = Array.isArray(block.content) ? block.content : [];
    for (const part of content) {
      const piece = asRecord(part);
      if (!piece) continue;
      if (typeof piece.text === 'string') texts.push(piece.text);
      const annotations = Array.isArray(piece.annotations) ? piece.annotations : [];
      for (const annotation of annotations) {
        const note = asRecord(annotation);
        if (!note) continue;
        addCitation(citations, note.url, note.title, note.cited_text ?? null);
      }
    }
  }
  return { text: texts.join('\n').trim(), citations, searched };
}

function sanitize(text: string, secret: string): string {
  const hidden = secret ? text.split(secret).join('[redacted]') : text;
  return hidden.replace(/\s+/g, ' ').slice(0, 280);
}

async function readBody(response: Response): Promise<string> {
  return response.text().catch(() => '');
}

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic' as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly version: string,
    private readonly toolMode: string,
    private readonly fetchImpl: typeof fetch
  ) {}

  async complete(request: LlmRequest): Promise<LlmResult> {
    const tools = request.webSearch ? this.toolPlan() : [null];
    let lastError = 'busca na web indisponível';
    for (let index = 0; index < tools.length; index++) {
      const tool = tools[index];
      const response = await this.send(request, tool, null);
      if (!response.ok) {
        const body = await readBody(response);
        const kind = classifyLlmFailure(response.status, body);
        const summary = `HTTP ${response.status} ${sanitize(body, this.apiKey)}`;
        const tryNext = kind === 'tool' && tool !== null && index < tools.length - 1;
        if (tryNext) {
          lastError = summary;
          continue;
        }
        throw new LlmRequestError(`Anthropic recusou o pedido: ${summary}`, kind, response.status);
      }
      let payload = await response.json() as { stop_reason?: string; content?: unknown };
      if (payload.stop_reason === 'pause_turn' && Array.isArray(payload.content)) {
        const follow = await this.send(request, tool, payload.content);
        if (follow.ok) payload = await follow.json() as typeof payload;
      }
      const parsed = parseAnthropicMessage(payload);
      const wantedSearch = request.webSearch === true;
      return {
        provider: 'anthropic',
        model: this.model,
        text: parsed.text,
        citations: parsed.citations,
        webSearch: !wantedSearch ? 'desligado' : tool === null ? 'indisponível' : parsed.searched ? 'usado' : 'desligado',
        usage: parseAnthropicUsage(payload)
      };
    }
    throw new LlmRequestError(`Anthropic recusou o pedido: ${lastError}`, 'other', 0);
  }

  private toolPlan(): (string | null)[] {
    if (this.toolMode === 'off') return [null];
    if (this.toolMode === 'web_search_20250305' || this.toolMode === 'web_search_20260209') {
      return [this.toolMode, null];
    }
    return ['web_search_20260209', 'web_search_20250305', null];
  }

  private send(request: LlmRequest, tool: string | null, assistant: unknown[] | null): Promise<Response> {
    const userContent = request.imagePngBase64
      ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: request.imagePngBase64 } },
          { type: 'text', text: request.user }
        ]
      : request.user;
    const messages: Record<string, unknown>[] = [{ role: 'user', content: userContent }];
    if (assistant) {
      messages.push({ role: 'assistant', content: assistant });
      messages.push({ role: 'user', content: 'Continue e feche o JSON pedido.' });
    }
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 900,
      system: request.system,
      messages
    };
    if (tool) body.tools = [{ type: tool, name: 'web_search', max_uses: 3 }];
    return this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': this.version
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000)
    });
  }
}

export class OpenAiProvider implements LlmProvider {
  readonly id = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch
  ) {}

  async complete(request: LlmRequest): Promise<LlmResult> {
    if (request.webSearch) {
      const searched = await this.responses(request);
      if (searched) return searched;
    }
    const chat = await this.chat(request);
    return {
      provider: 'openai',
      model: this.model,
      text: chat.text,
      citations: [],
      webSearch: request.webSearch ? 'indisponível' : 'desligado',
      usage: chat.usage
    };
  }

  private async responses(request: LlmRequest): Promise<LlmResult | null> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        tools: [{ type: 'web_search' }],
        input: `${request.system}\n\n${request.user}`
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const parsed = parseOpenAiResponses(payload);
    return {
      provider: 'openai',
      model: this.model,
      text: parsed.text,
      citations: parsed.citations,
      webSearch: 'usado',
      usage: parseOpenAiUsage(payload)
    };
  }

  private async chat(request: LlmRequest): Promise<{ text: string; usage: LlmUsage }> {
    const content = request.imagePngBase64
      ? [
          { type: 'text', text: request.user },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${request.imagePngBase64}` } }
        ]
      : request.user;
    const response = await this.postChat(request.system, content);
    if (!response.ok && request.imagePngBase64) {
      const retry = await this.postChat(request.system, request.user);
      if (!retry.ok) throw await this.failure(retry);
      const payload = await retry.json();
      return { text: parseOpenAiChat(payload), usage: parseOpenAiUsage(payload) };
    }
    if (!response.ok) throw await this.failure(response);
    const payload = await response.json();
    return { text: parseOpenAiChat(payload), usage: parseOpenAiUsage(payload) };
  }

  private async failure(response: Response): Promise<LlmRequestError> {
    const body = await readBody(response);
    const kind = classifyLlmFailure(response.status, body);
    return new LlmRequestError(
      `OpenAI recusou o pedido: HTTP ${response.status} ${sanitize(body, this.apiKey)}`,
      kind,
      response.status
    );
  }

  private postChat(system: string, content: unknown): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content }
        ]
      }),
      signal: AbortSignal.timeout(30_000)
    });
  }
}

export function createLlmProvider(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): LlmProvider | null {
  const choice = (env.ARANHA_LLM_PROVIDER || 'auto').trim().toLowerCase();
  if (choice === 'off' || choice === 'lexico' || choice === 'léxico') return null;
  const anthropicKey = (env.ANTHROPIC_API_KEY || '').trim();
  const openaiKey = (env.OPENAI_API_KEY || '').trim();
  const useAnthropic = choice === 'anthropic' || (choice === 'auto' && anthropicKey);
  if (useAnthropic) {
    if (!anthropicKey) return null;
    return new AnthropicProvider(
      anthropicKey,
      (env.ANTHROPIC_MODEL || 'claude-sonnet-4-6').trim(),
      (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').trim(),
      (env.ANTHROPIC_VERSION || '2026-10-21').trim(),
      (env.ANTHROPIC_WEB_SEARCH_TOOL || 'auto').trim(),
      fetchImpl
    );
  }
  const useOpenAi = choice === 'openai' || choice === 'auto';
  if (useOpenAi && openaiKey) {
    return new OpenAiProvider(
      openaiKey,
      (env.OPENAI_MODEL || 'gpt-4.1-mini').trim(),
      (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim(),
      fetchImpl
    );
  }
  return null;
}
