/**
 * Retired. The previous script hardcoded wins with `Math.random() < 0.965`
 * and printed a win rate that was not measured on market data.
 * Use `npm run backtest` for a walk-forward result on a real candle snapshot.
 */
console.error('server/monte_carlo.ts is not a backtest and does not report a win rate.');
console.error('Run npm run backtest to evaluate forecasts on a historical snapshot.');
process.exit(1);
