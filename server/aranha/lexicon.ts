export interface LexiconScore {
  sentiment: number | null;
  eventType: string;
  relevance: number;
  urgency: number;
  summary: string;
}

const BULLISH = [
  'alta', 'sobe', 'sobem', 'rally', 'rallying', 'recorde', 'aprovado', 'aprovacao', 'parceria',
  'adocao', 'bullish', 'otimismo', 'inflow', 'rompimento de alta', 'compra institucional',
  'soar', 'soars', 'jump', 'jumps', 'gain', 'gains', 'rebound', 'rebounds'
];

const BEARISH = [
  'queda', 'cai', 'caem', 'crash', 'plunge', 'bearish', 'hack', 'hackeado', 'exploit',
  'fraude', 'processo', 'proibicao', 'banimento', 'liquidacao', 'falencia', 'outflow',
  'ataque', 'roubo', 'slide', 'slides', 'tumble', 'tumbles', 'fall', 'falls', 'drop', 'drops',
  'sink', 'sinks', 'dump', 'dumps'
];

const EVENTS: [string, string[]][] = [
  ['seguranca', ['hack', 'hackeado', 'exploit', 'ataque', 'roubo', 'breach']],
  ['regulacao', ['sec', 'lawsuit', 'regulat', 'processo', 'proibicao', 'cvm']],
  ['listagem', ['listing', 'listagem']],
  ['macro', ['fed', 'cpi', 'inflacao', 'juros', 'payroll']],
  ['etf', ['etf']]
];

const URGENT = ['hack', 'hackeado', 'exploit', 'crash', 'halt', 'liquidacao', 'ataque', 'breach'];

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWord(text: string, word: string): boolean {
  const pattern = word.includes(' ')
    ? new RegExp(escapeRegExp(word), 'i')
    : new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
  return pattern.test(text);
}

function countWords(text: string, words: readonly string[]): number {
  let count = 0;
  for (const word of words) if (hasWord(text, word)) count += 1;
  return count;
}

export function symbolAliases(symbol: string): string[] {
  const base = symbol.toUpperCase().replace(/USDT$|BUSD$|USD$/, '');
  const known: Record<string, string[]> = {
    BTC: ['btc', 'bitcoin', 'btcusdt'],
    ETH: ['eth', 'ethereum', 'ethusdt'],
    SOL: ['sol', 'solana', 'solusdt']
  };
  return known[base] ?? [base.toLowerCase()];
}

/** Deterministic tone. No match means unknown, not a fake neutral score. */
export function scoreText(text: string, symbol: string, eventHint?: string): LexiconScore {
  const folded = fold(text);
  if (eventHint === 'trending') {
    return {
      sentiment: null,
      eventType: 'tendencia',
      relevance: symbolAliases(symbol).some(alias => hasWord(folded, alias)) ? 1 : 0.2,
      urgency: 0.2,
      summary: 'Item de tendência de mercado. A lista de palavras não dá um tom de alta ou de baixa.'
    };
  }
  const bullish = countWords(folded, BULLISH);
  const bearish = countWords(folded, BEARISH);
  const sentiment = bullish + bearish === 0 ? null : (bullish - bearish) / (bullish + bearish);
  let eventType = 'noticia';
  for (const [name, words] of EVENTS) {
    if (countWords(folded, words) > 0) {
      eventType = name;
      break;
    }
  }
  const aliases = symbolAliases(symbol);
  const mentionsSymbol = aliases.some(alias => hasWord(folded, alias));
  const mentionsMarket = hasWord(folded, 'cripto') || hasWord(folded, 'crypto') || hasWord(folded, 'bitcoin') || hasWord(folded, 'ethereum');
  const relevance = mentionsSymbol ? 1 : mentionsMarket ? 0.55 : 0.25;
  const urgency = countWords(folded, URGENT) > 0 ? 0.85 : eventType === 'regulacao' ? 0.55 : 0.3;
  const summary = sentiment === null
    ? 'Sem palavras de alta ou de baixa nesta lista fixa.'
    : sentiment > 0
      ? 'Lista fixa de palavras: tom de alta.'
      : sentiment < 0
        ? 'Lista fixa de palavras: tom de baixa.'
        : 'Lista fixa de palavras: alta e baixa empataram.';
  return { sentiment, eventType, relevance, urgency, summary };
}
