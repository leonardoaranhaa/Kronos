import type { VerdictLabel } from '../validation/protocol';
import {
  VOL_PROTOCOL,
  volStrategyId,
  type VolModelId
} from './protocol';
import type { VolSkillCell } from './skill';

export interface VolFilterCell {
  id: string;
  symbol: string;
  horizonHours: number;
  model: VolModelId | 'kronos-small';
  use: 'filtro' | 'dimensionar';
  book: string;
  name: string;
  verdict: VerdictLabel;
  reason: string;
  excessReturnPct: number | null;
  sharpe: number | null;
  deflatedSharpeRatio: number | null;
  probabilityOfBacktestOverfitting: number | null;
  maxDrawdownPct: number | null;
  buyAndHoldDrawdownPct: number | null;
  drawdownReduced: boolean | null;
  observations: number | null;
}

export interface VolatilityBlock {
  protocolId: string;
  registeredAt: string;
  skillVerdict: 'aprovada' | 'reprovada' | 'inconclusiva';
  skillReason: string;
  filterVerdict: 'aprovada' | 'reprovada' | 'inconclusiva';
  filterReason: string;
  headline: string;
  kronosVerdict: 'aprovada' | 'reprovada' | 'inconclusiva';
  kronosReason: string;
  cells: VolSkillCell[];
  filters: VolFilterCell[];
}

function primarySkill(cells: readonly VolSkillCell[]): VolSkillCell[] {
  const wanted: VolSkillCell[] = [];
  for (const symbol of VOL_PROTOCOL.symbols) {
    for (const horizon of VOL_PROTOCOL.horizons) {
      const cell = cells.find(row => row.symbol === symbol && row.horizonHours === horizon && row.model === 'har');
      if (cell) wanted.push(cell);
    }
  }
  return wanted;
}

function primaryFilterIds(): string[] {
  const ids: string[] = [];
  for (const symbol of VOL_PROTOCOL.symbols) {
    for (const horizon of VOL_PROTOCOL.horizons) ids.push(volStrategyId(symbol, horizon, 'filtro', 'har', 'segurar'));
  }
  return ids;
}

function filterMeasured(row: VolFilterCell): boolean {
  return row.observations !== null
    && row.observations >= VOL_PROTOCOL.minTestObservations
    && row.excessReturnPct !== null
    && row.maxDrawdownPct !== null
    && row.buyAndHoldDrawdownPct !== null;
}

function filterPassed(row: VolFilterCell): boolean {
  return filterMeasured(row)
    && row.drawdownReduced === true
    && (row.excessReturnPct as number) > 0
    && row.verdict === 'aprovada';
}

export function judgeSkill(cells: readonly VolSkillCell[]): { verdict: VolatilityBlock['skillVerdict']; reason: string } {
  const primary = primarySkill(cells);
  if (primary.length < VOL_PROTOCOL.symbols.length * VOL_PROTOCOL.horizons.length || primary.some(cell => !cell.enough)) {
    const measured = primary.filter(cell => cell.enough).length;
    return {
      verdict: 'inconclusiva',
      reason: `A pergunta usa seis células (BTC, ETH e SOL, em 4h e em 24h). ${measured} delas fecharam 30 pontos. Sem as seis, o veredito do tamanho do movimento não recebe um número no lugar.`
    };
  }
  const wins = primary.filter(cell => cell.beatsBaseline);
  if (wins.length === primary.length) {
    return {
      verdict: 'aprovada',
      reason: 'O HAR-RV teve QLIKE menor que a vol recente e Diebold-Mariano abaixo de 0,05 nas seis células.'
    };
  }
  return {
    verdict: 'reprovada',
    reason: `O HAR-RV ganhou da vol recente em ${wins.length} de ${primary.length} células. A aprovação pedia as seis. EWMA, GARCH e a ridge estão na tabela e não mudam este veredito.`
  };
}

export function judgeFilter(filters: readonly VolFilterCell[]): { verdict: VolatilityBlock['filterVerdict']; reason: string } {
  const wanted = primaryFilterIds();
  const rows = wanted.map(id => filters.find(row => row.id === id) ?? null);
  if (rows.some(row => row === null || !filterMeasured(row))) {
    const measured = rows.filter((row): row is VolFilterCell => row !== null && filterMeasured(row)).length;
    return {
      verdict: 'inconclusiva',
      reason: `O filtro primário é o HAR-RV em comprar e segurar, nas seis células. ${measured} delas têm retorno e drawdown no teste. Sem as seis, não há veredito de filtro.`
    };
  }
  const present = rows as VolFilterCell[];
  const lowerDrawdown = present.filter(row => row.drawdownReduced === true).length;
  const keptReturn = present.filter(row => (row.excessReturnPct as number) > 0).length;
  const passed = present.filter(row => filterPassed(row)).length;
  if (passed === present.length) {
    return {
      verdict: 'aprovada',
      reason: 'Nas seis células, ficar de fora quando a vol prevista pelo HAR-RV estava alta reduziu o drawdown e ainda passou no excesso, no Sharpe deflacionado e no PBO.'
    };
  }
  return {
    verdict: 'reprovada',
    reason: `O filtro não passou. O drawdown ficou menor em ${lowerDrawdown} de ${present.length} células. O excesso depois da taxa ficou positivo em ${keptReturn} de ${present.length}. A régua inteira (excesso, Sharpe deflacionado e PBO) fechou em ${passed} de ${present.length}. Ficar parado não conta como aprovação.`
  };
}

export function composeHeadline(
  skill: { verdict: VolatilityBlock['skillVerdict']; reason: string },
  filter: { verdict: VolatilityBlock['filterVerdict']; reason: string },
  kronosReason: string
): string {
  const skillText = skill.verdict === 'aprovada'
    ? 'O modelo prevê o tamanho do movimento melhor que a vol recente.'
    : skill.verdict === 'reprovada'
      ? 'O modelo não prevê o tamanho do movimento melhor que a vol recente.'
      : 'Ainda não dá para dizer se o modelo prevê o tamanho do movimento melhor que a vol recente.';
  const filterText = filter.verdict === 'aprovada'
    ? 'O filtro reduz o drawdown sem custar retorno, e passa na régua.'
    : filter.verdict === 'reprovada'
      ? 'O filtro não reduz o risco sem custar retorno, ou não passa na régua.'
      : 'Ainda não dá para dizer se o filtro reduz o drawdown sem custar retorno.';
  return `${skillText} ${skill.reason} ${filterText} ${filter.reason} ${kronosReason}`;
}

export function fmt(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/d';
  return value.toFixed(digits);
}

/** A tiny p-value stays visible. Four decimals would print 0.0000. */
export function fmtP(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/d';
  if (value < 0.0001) return '<0,0001';
  return value.toFixed(4);
}

export function renderVolatilitySection(block: VolatilityBlock): string[] {
  const lines = [
    '## Tamanho do movimento',
    '',
    block.headline,
    '',
    '### Regra desta pergunta',
    ''
  ];
  lines.push('A habilidade compara a variância realizada das próximas horas com a previsão. O portão é o QLIKE contra a vol recente, com Diebold-Mariano unilateral.', '');
  lines.push('O filtro primário fica zerado quando a previsão do HAR-RV passa do percentil 80 do treino. O dimensionamento e as regras antigas estão na tabela e entram no registro de tentativas.', '');
  lines.push('| Moeda | Horizonte | Modelo | Pontos | QLIKE | QLIKE da vol recente | Diferença | p DM | MSE | Correlação | p da correlação | Cobertura 80% | Cobertura 95% |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const cell of block.cells) {
    lines.push(`| ${cell.symbol} | ${cell.horizonHours}h | ${cell.model} | ${cell.observations} | ${fmt(cell.qlike, 4)} | ${fmt(cell.baselineQlike, 4)} | ${fmt(cell.qlikeGap, 4)} | ${fmtP(cell.dmPValue)} | ${fmt(cell.mse, 8)} | ${fmt(cell.rankVariance, 3)} | ${fmtP(cell.rankVarianceP)} | ${cell.coverage80 === null ? 'n/d' : fmt(cell.coverage80 * 100, 1) + '%'} | ${cell.coverage95 === null ? 'n/d' : fmt(cell.coverage95 * 100, 1) + '%'} |`);
  }
  lines.push('', '| Uso | Veredito | Excesso | Sharpe | DSR | PBO | Drawdown | Drawdown de comprar e segurar |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of block.filters) {
    lines.push(`| ${row.name} | ${row.verdict} | ${fmt(row.excessReturnPct)}% | ${fmt(row.sharpe)} | ${fmt(row.deflatedSharpeRatio, 3)} | ${fmt(row.probabilityOfBacktestOverfitting, 3)} | ${fmt(row.maxDrawdownPct)}% | ${fmt(row.buyAndHoldDrawdownPct)}% |`);
  }
  lines.push('', `Kronos-small: **${block.kronosVerdict}.** ${block.kronosReason}`, '');
  return lines;
}
