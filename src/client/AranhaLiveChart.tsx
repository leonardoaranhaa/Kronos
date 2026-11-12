import { useEffect, useRef } from 'react';
import type { LiveAnnotation, LiveCandle, LiveZone } from '../../server/crawler/live';

interface WallLine {
  price: number;
  side: 'compra' | 'venda';
  usd: number;
}

interface Props {
  candles: LiveCandle[];
  zones: LiveZone[];
  walls: WallLine[];
  annotations: LiveAnnotation[];
}

/** Candles with the spider's marks drawn on top. */
export default function AranhaLiveChart({ candles, zones, walls, annotations }: Props) {
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
      if (candles.length < 2) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '14px sans-serif';
        ctx.fillText('Aguardando candles desta moeda.', 16, 32);
        return;
      }
      const pad = 28;
      let low = Math.min(...candles.map(candle => candle.l));
      let high = Math.max(...candles.map(candle => candle.h));
      for (const zone of zones) {
        if (zone.high < low * 0.98 || zone.low > high * 1.02) continue;
        low = Math.min(low, zone.low);
        high = Math.max(high, zone.high);
      }
      for (const wall of walls) {
        if (wall.price > low * 0.98 && wall.price < high * 1.02) {
          low = Math.min(low, wall.price);
          high = Math.max(high, wall.price);
        }
      }
      const span = high - low || 1;
      const yOf = (price: number) => height - pad - ((price - low) / span) * (height - pad * 2);
      const slot = (width - pad * 2) / candles.length;
      const xOfTime = (time: number) => {
        let nearest = 0;
        let best = Infinity;
        candles.forEach((candle, index) => {
          const distance = Math.abs(candle.t - time);
          if (distance < best) {
            best = distance;
            nearest = index;
          }
        });
        return pad + nearest * slot + slot / 2;
      };

      for (const zone of zones) {
        if (zone.high < low || zone.low > high) continue;
        const top = yOf(zone.high);
        const bottom = yOf(zone.low);
        ctx.fillStyle = zone.kind === 'analog'
          ? 'rgba(56, 189, 248, 0.08)'
          : zone.kind === 'support' ? 'rgba(74, 222, 128, 0.13)' : 'rgba(251, 113, 133, 0.13)';
        ctx.fillRect(pad, Math.min(top, bottom), width - pad * 2, Math.max(2, Math.abs(bottom - top)));
      }

      for (const wall of walls) {
        const y = yOf(wall.price);
        ctx.strokeStyle = wall.side === 'compra' ? '#86efac' : '#fda4af';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(width - pad, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = '11px sans-serif';
        ctx.fillText(`parede ${wall.side}`, pad + 4, Math.max(14, y - 4));
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
        const bodyWidth = Math.max(2, slot * 0.62);
        ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, Math.max(1, bodyBottom - bodyTop));
      });

      for (const mark of annotations) {
        const x = xOfTime(mark.time);
        const y = yOf(mark.price);
        if (mark.kind === 'baleia') {
          const radius = 5 + Math.min(14, Math.log10(Math.max(mark.usd ?? 1, 1)) * 3);
          ctx.beginPath();
          ctx.fillStyle = mark.side === 'venda' ? 'rgba(251, 113, 133, 0.85)' : 'rgba(74, 222, 128, 0.85)';
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.fillStyle = mark.kind === 'cadeia' ? '#c4b5fd'
          : mark.kind === 'entrada' || mark.kind === 'saida' ? '#f8fafc'
            : mark.kind === 'volume' ? '#38bdf8'
              : '#fbbf24';
        ctx.beginPath();
        if (mark.kind === 'entrada' || mark.kind === 'saida') {
          const direction = mark.kind === 'entrada' ? -1 : 1;
          ctx.moveTo(x, y + direction * 8);
          ctx.lineTo(x - 5, y);
          ctx.lineTo(x + 5, y);
        } else {
          ctx.moveTo(x, y - 7);
          ctx.lineTo(x - 5, y + 4);
          ctx.lineTo(x + 5, y + 4);
        }
        ctx.closePath();
        ctx.fill();
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [candles, zones, walls, annotations]);

  return <canvas ref={ref} className="chart aranha-live-chart" />;
}
