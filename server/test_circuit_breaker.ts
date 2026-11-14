/**
 * Manual illustration of the risk rules. This is not a performance test and
 * it is not part of CI. The assertions live in tests/circuit-breaker.test.ts.
 */
import { CircuitBreakerManager } from './circuit_breaker';

const now = Date.parse('2026-11-12T15:00:00.000Z');
const breaker = new CircuitBreakerManager({
  maxDailyDrawdownPct: 2,
  maxConsecutiveLosses: 3,
  cooldownPeriodMs: 5_000,
  feedTimeoutMs: 2_000
}, now, 10_000);

breaker.recordHeartbeat(now);
console.log('Início:', breaker.getStatus(now));
breaker.recordClosedTrade(-1, now);
breaker.recordClosedTrade(-1, now + 1);
breaker.recordClosedTrade(-1, now + 2);
console.log('Depois de 3 perdas:', breaker.evaluate(now + 2));
breaker.recordEquity(9_700, now + 3);
console.log('Depois de -3% no dia:', breaker.evaluate(now + 3));
