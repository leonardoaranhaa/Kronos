import crypto from 'crypto';
import { AggressiveSignal } from '../shared/types';

export interface BinanceOrderConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl: string;
}

export class OrderExecutionManager {
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string;

  constructor(config: BinanceOrderConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl;
  }

  private generateSignature(queryString: string): string {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  public async executeAggressiveSignal(symbol: string, signal: AggressiveSignal, quantity: number): Promise<any> {
    if (signal.action === 'HOLD' || quantity <= 0) {
      return { status: 'SKIPPED', reason: 'Sinal em HOLD ou quantidade inválida' };
    }

    const timestamp = Date.now();
    const side = signal.action;
    const oppositeSide = side === 'BUY' ? 'SELL' : 'BUY';

    const orderParams = new URLSearchParams({
      symbol,
      side,
      type: 'MARKET',
      quantity: quantity.toString(),
      timestamp: timestamp.toString()
    });
    
    orderParams.append('signature', this.generateSignature(orderParams.toString()));

    try {
      const response = await fetch(`${this.baseUrl}/api/v3/order`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: orderParams.toString()
      });

      const entryResult = await response.json();

      if (!response.ok) {
        throw new Error(`Erro na ordem de entrada: ${JSON.stringify(entryResult)}`);
      }

      const ocoParams = new URLSearchParams({
        symbol,
        side: oppositeSide,
        quantity: quantity.toString(),
        price: signal.targetPrice.toString(),
        stopPrice: signal.stopLoss.toString(),
        stopLimitPrice: (signal.stopLoss * (side === 'BUY' ? 0.999 : 1.001)).toFixed(2),
        stopLimitTimeInForce: 'GTC',
        timestamp: Date.now().toString()
      });

      ocoParams.append('signature', this.generateSignature(ocoParams.toString()));

      const ocoResponse = await fetch(`${this.baseUrl}/api/v3/order/oco`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: ocoParams.toString()
      });

      const ocoResult = await ocoResponse.json();

      return {
        status: 'EXECUTED',
        entryOrder: entryResult,
        ocoOrder: ocoResult
      };
    } catch (error: any) {
      console.error('[OrderExecutionError]:', error.message);
      return { status: 'FAILED', error: error.message };
    }
  }
}
