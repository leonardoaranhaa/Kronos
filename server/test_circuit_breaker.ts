// server/test_circuit_breaker.ts
import { CircuitBreakerManager } from './circuit_breaker';

console.log('=== TESTE DE CORTE FÍSICO (CIRCUIT BREAKER) ===');

const breaker = new CircuitBreakerManager({
  maxDailyLossPct: 2.0,
  maxConsecutiveLosses: 3,
  cooldownPeriodMs: 5000, // 5s para teste rápido
  wsTimeoutMs: 2000
});

console.log('1. Registando trade lucrativo (+0.8%)...');
breaker.recordTradeOutcome(0.8);
console.log('Status:', breaker.getStatus());

console.log('\n2. Simulando 3 perdas seguidas de -0.5%...');
breaker.recordTradeOutcome(-0.5);
breaker.recordTradeOutcome(-0.5);
breaker.recordTradeOutcome(-0.5);

const health1 = breaker.checkHealth();
console.log('Permissão de trade após 3 stops:', health1);

console.log('\n3. Simulando perda acumulada de -2.2% (Estouro do limite diário)...');
breaker.recordTradeOutcome(-0.7);

const health2 = breaker.checkHealth();
console.log('Permissão de trade após estouro diário:', health2);
