import { useEffect, useRef } from 'react';
import type { ChartCandle, ChartMarker, PriceZone } from '../../server/aranha/types';

interface AranhaChartProps {
  candles: ChartCandle[];
  zones: PriceZone[];
  markers: ChartMarker[];
}

/** Candles with support and resistance bands drawn on the chart. */
export default function AranhaChart({ candles, zones, markers }: AranhaChartProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, height);
      ctx.font = '13px sans-serif';
      if (candles.length < 2) {
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Ainda não há candles suficientes para desenhar.', 16, 32);
        return;
      }
      const pad = 18;
      let low = Math.min(...candles.map(candle => candle.l));
      let high = Math.max(...candles.map(candle => candle.h));
      const near = zones.filter(zone => zone.high >= low * 0.985 && zone.low <= high * 1.015);
      for (const zone of near) {
        low = Math.min(low, zone.low);
        high = Math.max(high, zone.high);
      }
      const span = high - low || 1;
      const yOf = (price: number) => height - pad - ((price - low) / span) * (height - pad * 2);
      const slot = (width - pad * 2) / candles.length;

      for (const zone of near) {
        const top = yOf(zone.high);
        const bottom = yOf(zone.low);
        ctx.fillStyle = zone.kind === 'support' ? 'rgba(74, 222, 128, 0.16)' : 'rgba(251, 113, 133, 0.16)';
        ctx.fillRect(pad, Math.min(top, bottom), width - pad * 2, Math.max(2, Math.abs(bottom - top)));
      }

      candles.forEach((candle, index) => {
        const x = pad + index * slot + slot / 2;
        const up = candle.c >= candle.o;
        ctx.strokeStyle = up ? '#4ade80' : '#fb7185';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yOf(candle.h));
        ctx.lineTo(x, yOf(candle.l));
        ctx.stroke();
        const bodyTop = yOf(Math.max(candle.o, candle.c));
        const bodyBottom = yOf(Math.min(candle.o, candle.c));
        const bodyWidth = Math.max(2, slot * 0.6);
        ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, Math.max(1, bodyBottom - bodyTop));
      });

      const last = candles[candles.length - 1];
      const marked = markers.filter(marker => marker.openTime === last.t);
      if (marked.length) {
        const x = pad + (candles.length - 1) * slot + slot / 2;
        const y = yOf(last.h) - 8;
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 5, y - 8);
        ctx.lineTo(x + 5, y - 8);
        ctx.closePath();
        ctx.fill();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [candles, zones, markers]);

  return <canvas ref={ref} className="chart aranha-chart" />;
}
