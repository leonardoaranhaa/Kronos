import React, { useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, Zap, Shield, RefreshCw } from 'lucide-react';
import { Candle, TechnicalIndicators, AggressiveSignal } from '../../shared/types';

export default function App() {
  const [candle, setCandle] = useState<Candle | null>(null);
  const [indicators, setIndicators] = useState<TechnicalIndicators | null>(null);
  const [signal, setSignal] = useState<AggressiveSignal | null>(null);
  const [predictions, setPredictions] = useState<number[]>([]);
  const [vpin, setVpin] = useState<number>(0.28);
  const [ofi, setOfi] = useState<number>(45.2);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3000`);

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => setIsConnected(false);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'MARKET_TICK') {
          setCandle(data.payload.candle);
          setIndicators(data.payload.indicators);
          setSignal(data.payload.signal);
          if (data.payload.vpin) setVpin(data.payload.vpin);
          if (data.payload.ofi) setOfi(data.payload.ofi);
        } else if (data.type === 'KRONOS_AI_PREDICTION') {
          setPredictions(data.payload.predictedCloses || []);
        }
      } catch (err) {
        console.error('Erro ao processar WS:', err);
      }
    };

    return () => ws.close();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6">
      <header className="flex justify-between items-center pb-6 border-b border-slate-800 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center font-bold text-xl shadow-lg shadow-violet-500/30">
            K
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Kronos & Aranha Digital HFT Engine</h1>
            <p className="text-xs text-slate-400">Trading de Alta Frequência, Order Flow & IA Kronos</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
            <span className="text-slate-400">VPIN Toxicity:</span>
            <span className={`font-bold ${vpin > 0.75 ? 'text-rose-400' : 'text-emerald-400'}`}>{vpin}</span>
          </div>
          <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg flex items-center gap-2">
            <span className="text-slate-400">OFI Imbalance:</span>
            <span className="font-bold text-cyan-400">{ofi}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
            <span className="text-slate-400">{isConnected ? 'ONLINE' : 'OFFLINE'}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Sinal da Aranha Digital</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-violet-500/20 text-violet-400 border border-violet-500/30">
                {signal?.isFadingTrade ? 'FADING MODE' : 'TREND MODE'}
              </span>
            </div>

            <div className="text-center py-4">
              {signal?.action === 'BUY' && (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold text-2xl">
                  <TrendingUp className="w-7 h-7" /> COMPRA
                </div>
              )}
              {signal?.action === 'SELL' && (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/40 font-bold text-2xl">
                  <TrendingDown className="w-7 h-7" /> VENDA
                </div>
              )}
              {(!signal || signal.action === 'HOLD') && (
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold text-2xl">
                  <Activity className="w-7 h-7" /> AGUARDAR
                </div>
              )}
            </div>

            <div className="space-y-3 mt-4 text-xs">
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Confiança:</span>
                <span className="font-semibold text-slate-200">
                  {signal ? `${(signal.confidence * 100).toFixed(0)}%` : '0%'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Preço Alvo (ATR 2.5x):</span>
                <span className="font-semibold text-emerald-400">
                  {signal ? `$${signal.targetPrice}` : '-'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Stop Loss (ATR 1.5x):</span>
                <span className="font-semibold text-rose-400">
                  {signal ? `$${signal.stopLoss}` : '-'}
                </span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-slate-800">
                <span className="text-slate-400">Kelly 0.3K Lot:</span>
                <span className="font-semibold text-cyan-400">
                  {signal ? `${signal.kellyLot} BTC` : '-'}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400">
            <span className="font-medium text-slate-300">Gatilho: </span>
            {signal?.reason || 'Aguardando ticks...'}
          </div>
        </div>

        <div className="lg:col-span-3 bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-4">
            <div>
              <span className="text-xs text-slate-400">BTC/USDT Spot Price</span>
              <div className="text-3xl font-extrabold text-white tracking-tight">
                ${candle ? candle.close.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '65,000.00'}
              </div>
            </div>

            <div className="flex gap-3 text-xs">
              <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px]">RSI (14)</span>
                <span className="font-bold text-sm text-slate-200">{indicators?.rsi14 ?? '-'}</span>
              </div>
              <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px]">ATR (14)</span>
                <span className="font-bold text-sm text-emerald-400">{indicators?.atr14 ?? '-'}</span>
              </div>
              <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px]">EMA 9</span>
                <span className="font-bold text-sm text-cyan-400">{indicators?.ema9 ?? '-'}</span>
              </div>
              <div className="bg-slate-950 px-3 py-2 rounded-xl border border-slate-800">
                <span className="text-slate-400 block text-[10px]">EMA 20</span>
                <span className="font-bold text-sm text-amber-400">{indicators?.ema20 ?? '-'}</span>
              </div>
            </div>
          </div>

          <div className="h-64 bg-slate-950 rounded-xl border border-slate-800/80 p-4 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-3 left-3 text-[10px] text-slate-500 font-mono">
              [PROJEÇÃO KRONOS AI - 5 CANDLES FUTUROS]
            </div>

            <div className="flex-1 flex items-end justify-around pt-8 pb-4 gap-2">
              {predictions.map((price, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                  <div
                    className="w-full bg-violet-500/30 border border-violet-400/60 rounded-t-sm transition-all"
                    style={{ height: `${Math.min(100, Math.max(20, (price - 64000) / 25))}%` }}
                  />
                  <span className="text-[10px] font-mono text-violet-300">T+{idx + 1}</span>
                  <span className="text-[9px] font-mono text-slate-400">${price}</span>
                </div>
              ))}
              {predictions.length === 0 && (
                <div className="flex items-center justify-center w-full h-full text-slate-600 text-xs gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Processando predição de alta frequência...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
