// server/test_binance_execution.ts
import dotenv from 'dotenv';
import { OrderExecutionManager } from './order_execution';
import { AggressiveSignal } from '../shared/types';

dotenv.config();

async function runTestnetValidation() {
  console.log('=== TESTE DE EXECUÇÃO REAL NA BINANCE TESTNET ===');

  const executor = new OrderExecutionManager({
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    baseUrl: process.env.BINANCE_BASE_URL || 'https://testnet.binance.vision'
  });

  const mockSignal: AggressiveSignal = {
    action: 'BUY',
    confidence: 0.94,
    targetPrice: 66500.00, // +2.5% ATR Target
    stopLoss: 64200.00,   // -1.5% ATR Stop
    kellyLot: 0.002,      // 0.002 BTC
    isFadingTrade: true,
    reason: 'Teste de Carga Testnet - Fading de Spoofing',
    indicators: { ema9: 65100, ema20: 64900, ema50: 64500, rsi14: 62, atr14: 450 }
  };

  console.log('1. Enviando Ordem a Mercado com Proteção OCO...');
  const result = await executor.executeAggressiveSignal('BTCUSDT', mockSignal, mockSignal.kellyLot);
  console.log('2. Resposta Completa da API Binance:', JSON.stringify(result, null, 2));
}

runTestnetValidation();
