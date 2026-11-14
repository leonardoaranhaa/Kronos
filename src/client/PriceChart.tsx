import { useEffect, useRef } from 'react';

interface PriceChartProps {
  closes: number[];
  forecast: number[];
  bandLow?: number[];
  bandHigh?: number[];
}

/** Close line plus the model path. The forecast is drawn after the last close. */
export default function PriceChart({ closes, forecast, bandLow = [], bandHigh = [] }: PriceChartProps) {
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
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px sans-serif';
      if (closes.length < 2) {
        ctx.fillText('Aguardando candles suficientes para o gráfico.', 16, 32);
        return;
      }
      const pad = 18;
      const points = closes.concat(forecast, bandLow, bandHigh);
      const min = Math.min(...points);
      const max = Math.max(...points);
      const span = max - min || 1;
      const x = (index: number) => pad + (index / (points.length - 1)) * (width - pad * 2);
      const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2);

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad, pad);
      ctx.lineTo(pad, height - pad);
      ctx.lineTo(width - pad, height - pad);
      ctx.stroke();

      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      closes.forEach((value, index) => {
        const px = x(index);
        const py = y(value);
        if (index === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      if (forecast.length > 0 && bandLow.length === forecast.length && bandHigh.length === forecast.length) {
        const start = closes.length - 1;
        ctx.beginPath();
        ctx.moveTo(x(start), y(closes[start]));
        bandHigh.forEach((value, index) => ctx.lineTo(x(start + 1 + index), y(value)));
        for (let index = bandLow.length - 1; index >= 0; index--) ctx.lineTo(x(start + 1 + index), y(bandLow[index]));
        ctx.closePath();
        ctx.fillStyle = 'rgba(167, 139, 250, 0.25)';
        ctx.fill();
      }
      if (forecast.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#a78bfa';
        ctx.setLineDash([5, 4]);
        const start = closes.length - 1;
        ctx.moveTo(x(start), y(closes[start]));
        forecast.forEach((value, index) => ctx.lineTo(x(start + 1 + index), y(value)));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = '#64748b';
      ctx.font = '12px sans-serif';
      ctx.fillText(max.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), pad + 4, pad + 12);
      ctx.fillText(min.toLocaleString('pt-BR', { maximumFractionDigits: 0 }), pad + 4, height - pad - 4);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [closes, forecast, bandLow, bandHigh]);

  return <canvas ref={ref} className="chart" aria-label="Gráfico de preço e previsão" />;
}
