export interface TelegramOptions {
  token?: string;
  chatId?: string;
  fetchImpl?: typeof fetch;
}

export interface TelegramResult {
  sent: boolean;
  reason?: string;
}

/**
 * Optional alert. Disabled unless both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
 * are set. Messages are plain text and must already say that no real order was sent.
 */
export async function sendTelegramMessage(text: string, options: TelegramOptions): Promise<TelegramResult> {
  const token = options.token?.trim();
  const chatId = options.chatId?.trim();
  if (!token || !chatId) return { sent: false, reason: 'not_configured' };
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  if (!response.ok) return { sent: false, reason: `http_${response.status}` };
  return { sent: true };
}

export function formatResearchAlert(lines: string[]): string {
  return ['Kronos pesquisa (paper). Nenhuma ordem real foi enviada.', ...lines].join('\n');
}
