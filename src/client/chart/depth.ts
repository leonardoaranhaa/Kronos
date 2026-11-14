export interface DepthLevel {
  price: number;
  quantity: number;
}

export interface DepthStep {
  price: number;
  usd: number;
}

/** Cumulative quote size from the inside of the book outward. Empty when a side has no level. */
export function depthSteps(levels: readonly DepthLevel[], side: 'compra' | 'venda'): DepthStep[] {
  const ordered = levels
    .filter(level => level.price > 0 && level.quantity > 0)
    .slice()
    .sort((a, b) => side === 'compra' ? b.price - a.price : a.price - b.price);
  let usd = 0;
  return ordered.map(level => {
    usd += level.price * level.quantity;
    return { price: level.price, usd };
  });
}
