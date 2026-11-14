import { existsSync, readFileSync } from 'node:fs';
import { ResearchParams } from './research-protocol';

export interface PromotionFile {
  promoteToPaper?: boolean;
  tunedParams?: ResearchParams | null;
}

export type PaperChoice =
  | { id: 'atual'; reason: string }
  | { id: 'pesquisa'; reason: string; params: ResearchParams };

/**
 * The default paper rule stays in place unless the research file explicitly
 * promotes one configuration and the operator asks for it on the same series.
 */
export function selectPaperStrategy(
  requested: string | undefined,
  report: PromotionFile | null,
  series: { symbol: string; interval: string }
): PaperChoice {
  if (requested !== 'pesquisa') return { id: 'atual', reason: 'Padrão: regra atual.' };
  if (!report?.promoteToPaper || !report.tunedParams) {
    return { id: 'atual', reason: 'A pesquisa não habilitou uma estratégia nova. Continua a regra atual.' };
  }
  if (series.symbol !== 'BTCUSDT' || series.interval !== '1h') {
    return {
      id: 'atual',
      reason: 'A estratégia pesquisa foi medida em BTCUSDT 1h. Este servidor está em outro par ou intervalo, então a regra atual permanece.'
    };
  }
  return { id: 'pesquisa', reason: 'Usando a configuração promovida pela pesquisa, só neste paper.', params: report.tunedParams };
}

export function loadPromotion(filePath: string): PromotionFile | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as PromotionFile;
  } catch {
    return null;
  }
}
