// server/circuit_breaker.ts
import EventEmitter from 'events';

export interface CircuitBreakerConfig {
  maxDailyLossPct: number;      // Ex: 2.0 (2% de perda máxima no dia)
  maxConsecutiveLosses: number; // Ex: 3 stops seguidos
  cooldownPeriodMs: number;     // Ex: 1800000 (30 minutos de pausa)
  wsTimeoutMs: number;          // Ex: 3000 (3 segundos sem ticks)
}

export class CircuitBreakerManager extends EventEmitter {
  private config: CircuitBreakerConfig;
  private dailyPnlPct: number = 0;
  private consecutiveLosses: number = 0;
  private isTripped: boolean = false;
  private tripReason: string = '';
  private lastHeartbeat: number = Date.now();
  private cooldownUntil: number = 0;

  constructor(config: CircuitBreakerConfig) {
    super();
    this.config = config;
  }

  public recordTradeOutcome(pnlPct: number): void {
    this.dailyPnlPct += pnlPct;

    if (pnlPct < 0) {
      this.consecutiveLosses++;
    } else {
      this.consecutiveLosses = 0;
    }

    this.evaluateConditions();
  }

  public recordHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  public checkHealth(): { canTrade: boolean; reason?: string } {
    const now = Date.now();

    if (this.isTripped) {
      return { canTrade: false, reason: `Circuit Breaker Disparado: ${this.tripReason}` };
    }

    if (now < this.cooldownUntil) {
      const remainingSec = Math.ceil((this.cooldownUntil - now) / 1000);
      return { canTrade: false, reason: `Em Cooldown de Segurança (${remainingSec}s restantes)` };
    }

    if (now - this.lastHeartbeat > this.config.wsTimeoutMs) {
      this.trip('FALHA DE CONEXÃO: Timeout no Feed WebSocket (> 3s)');
      return { canTrade: false, reason: 'Feed WebSocket inativo' };
    }

    return { canTrade: true };
  }

  private evaluateConditions(): void {
    if (this.dailyPnlPct <= -this.config.maxDailyLossPct) {
      this.trip(`Perda diária limite atingida (-${Math.abs(this.dailyPnlPct).toFixed(2)}%)`);
    } else if (this.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      this.cooldownUntil = Date.now() + this.config.cooldownPeriodMs;
      this.consecutiveLosses = 0;
      console.warn(`⚠️ [COOLDOWN]: ${this.config.maxConsecutiveLosses} perdas consecutivas. Pausa de 30 min ativada.`);
      this.emit('cooldown_triggered', { until: this.cooldownUntil });
    }
  }

  private trip(reason: string): void {
    this.isTripped = true;
    this.tripReason = reason;
    console.error(`🚨 [CIRCUIT BREAKER DISPARADO]: ${reason}`);
    this.emit('circuit_tripped', { reason, timestamp: Date.now() });
  }

  public resetDaily(): void {
    this.dailyPnlPct = 0;
    this.consecutiveLosses = 0;
    this.isTripped = false;
    this.tripReason = '';
    console.log('🔄 [CIRCUIT BREAKER]: Contador diário reiniciado.');
  }

  public getStatus() {
    return {
      isTripped: this.isTripped,
      tripReason: this.tripReason,
      dailyPnlPct: parseFloat(this.dailyPnlPct.toFixed(2)),
      consecutiveLosses: this.consecutiveLosses,
      inCooldown: Date.now() < this.cooldownUntil
    };
  }
}
