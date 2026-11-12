import type { LlmAccountStatus } from '../../server/aranha/types';

export function llmClock(iso: string | null): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(time);
}

/** Badge text. A configured key is not "desligado", and a failed call is not "ligado". */
export function llmLabel(status: LlmAccountStatus | null | undefined): string {
  if (!status?.configured) return 'LLM desligado';
  const clock = status.lastCallAt ? ` às ${llmClock(status.lastCallAt)}` : '';
  if (status.mode === 'erro') return `${status.reason ?? 'Erro no modelo'}${clock}`;
  if (status.lastCallOk) {
    const who = status.provider === 'openai' ? 'modelo OpenAI ligado' : 'Claude ligado';
    return `${who}${clock}`;
  }
  return status.provider === 'openai' ? 'modelo OpenAI configurado' : 'Claude configurado';
}

export function llmClass(status: LlmAccountStatus | null | undefined): string {
  if (status?.mode === 'erro') return 'bad';
  if (status?.lastCallOk) return 'ok';
  return 'warn';
}
