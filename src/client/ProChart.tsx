import { useEffect, useRef, useState } from 'react';
import {
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  LineData,
  PriceScaleMode,
  UTCTimestamp,
  createChart
} from 'lightweight-charts';
import type { LiveAnnotation, LiveZone } from '../../server/crawler/live';
import { mergePublicCandles, type PublicCandle } from '../../server/market/public-klines';
import { atr, bollinger, ema, macd, parsePeriods, rsi, sma, vwap } from './chart/indicators';
import {
  FIB_LEVELS,
  commitDrawings,
  emptyMemory,
  loadDrawings,
  redoDrawings,
  saveDrawings,
  translateDrawing,
  undoDrawings,
  type DrawKind,
  type DrawMemory,
  type DrawPoint,
  type DrawTool,
  type Drawing,
  type KeyValueStore
} from './chart/drawings';

export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
export type ChartInterval = (typeof INTERVALS)[number];

const INTERVAL_MS: Record<ChartInterval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000
};

const UP = '#26a69a';
const DOWN = '#ef5350';

interface Layers {
  estruturas: boolean;
  rompimentos: boolean;
  anomalias: boolean;
  analogias: boolean;
  baleias: boolean;
  paredes: boolean;
  cadeia: boolean;
  paper: boolean;
  kronos: boolean;
}

const DEFAULT_LAYERS: Layers = {
  estruturas: true,
  rompimentos: true,
  anomalias: true,
  analogias: true,
  baleias: true,
  paredes: true,
  cadeia: true,
  paper: true,
  kronos: true
};

const TOOLS: { id: DrawTool; label: string; key: string }[] = [
  { id: 'navegar', label: 'Navegar', key: 'V' },
  { id: 'selecionar', label: 'Selecionar', key: 'S' },
  { id: 'tendencia', label: 'Tendência', key: 'T' },
  { id: 'horizontal', label: 'Horizontal', key: 'H' },
  { id: 'raio', label: 'Raio', key: 'R' },
  { id: 'zona', label: 'Zona', key: 'Q' },
  { id: 'fibonacci', label: 'Fibonacci', key: 'F' },
  { id: 'pincel', label: 'Pincel', key: 'P' },
  { id: 'nota', label: 'Nota', key: 'N' },
  { id: 'medir', label: 'Medir', key: 'M' }
];

function browserStore(): KeyValueStore {
  return {
    getItem: key => {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    setItem: (key, value) => {
      try { localStorage.setItem(key, value); } catch { /* a full browser store keeps the drawing in memory */ }
    }
  };
}

function sec(time: number): UTCTimestamp {
  return Math.floor(time / 1000) as UTCTimestamp;
}

function newId(): string {
  return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

const priceFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const volFmt = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

function measureLabel(a: DrawPoint, b: DrawPoint, intervalMs: number): string {
  const delta = b.price - a.price;
  const pct = a.price ? (delta / a.price) * 100 : 0;
  const bars = Math.max(0, Math.round(Math.abs(b.time - a.time) / intervalMs));
  const sign = delta > 0 ? '+' : '';
  return `${sign}${priceFmt.format(delta)} (${sign}${priceFmt.format(pct)}%) · ${bars} velas · ${formatDuration(Math.abs(b.time - a.time))}`;
}

function lineRows(times: number[], values: readonly (number | null)[]): LineData[] {
  const rows: LineData[] = [];
  for (let index = 0; index < times.length; index++) {
    const value = values[index];
    if (value === null || !Number.isFinite(value)) continue;
    rows.push({ time: sec(times[index]), value });
  }
  return rows;
}

interface Legend {
  title: string;
  rows: string[];
}

export default function ProChart({
  symbol,
  annotations,
  zones,
  walls,
  forecastBps
}: {
  symbol: string;
  annotations: LiveAnnotation[];
  zones: LiveZone[];
  walls: { price: number; side: 'compra' | 'venda'; usd: number }[];
  forecastBps: number | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const extraRef = useRef<ISeriesApi<'Line'>[]>([]);
  const rsiRef = useRef<IChartApi | null>(null);
  const macdRef = useRef<IChartApi | null>(null);
  const atrRef = useRef<IChartApi | null>(null);
  const paintRef = useRef<() => void>(() => {});
  const legendRef = useRef<(time: number | null) => void>(() => {});
  const candlesRef = useRef<PublicCandle[]>([]);
  const memoryRef = useRef<DrawMemory>(emptyMemory());
  const fitRef = useRef(true);
  const historyReady = useRef(false);
  const addedRef = useRef(0);
  const loadingOlder = useRef(false);
  const exhausted = useRef(false);
  const symbolRef = useRef(symbol);
  const intervalRef = useRef<ChartInterval>('5m');
  const syncing = useRef(false);
  const dragRef = useRef<{ id: string; origin: DrawPoint; before: DrawMemory; original: Drawing } | null>(null);

  const [interval, setIntervalName] = useState<ChartInterval>('5m');
  const [candles, setCandles] = useState<PublicCandle[]>([]);
  const [note, setNote] = useState('Carregando candles…');
  const [tool, setTool] = useState<DrawTool>('navegar');
  const [memory, setMemory] = useState<DrawMemory>(emptyMemory());
  const [draft, setDraft] = useState<Drawing | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [volumeOn, setVolumeOn] = useState(true);
  const [emaOn, setEmaOn] = useState(true);
  const [emaText, setEmaText] = useState('9, 20');
  const [smaOn, setSmaOn] = useState(false);
  const [smaText, setSmaText] = useState('50');
  const [vwapOn, setVwapOn] = useState(false);
  const [bbOn, setBbOn] = useState(false);
  const [rsiOn, setRsiOn] = useState(false);
  const [macdOn, setMacdOn] = useState(false);
  const [atrOn, setAtrOn] = useState(false);
  const [legend, setLegend] = useState<Legend>({ title: 'sem dados', rows: [] });
  const [notePoint, setNotePoint] = useState<DrawPoint | null>(null);
  const [noteText, setNoteText] = useState('');
  const rsiHost = useRef<HTMLDivElement>(null);
  const macdHost = useRef<HTMLDivElement>(null);
  const atrHost = useRef<HTMLDivElement>(null);
  const draftRef = useRef<Drawing | null>(null);
  draftRef.current = draft;
  candlesRef.current = candles;
  memoryRef.current = memory;
  symbolRef.current = symbol;
  intervalRef.current = interval;

  const project = useRef({
    timeToX: (_time: number) => null as number | null,
    priceToY: (_price: number) => null as number | null,
    xToTime: (_x: number) => null as number | null,
    yToPrice: (_y: number) => null as number | null,
    plotRight: 0,
    height: 0
  });

  function persist(next: DrawMemory) {
    memoryRef.current = next;
    setMemory(next);
    saveDrawings(browserStore(), symbolRef.current, next.items);
  }

  useEffect(() => {
    setSelectedId(null);
    setDraft(null);
    const items = loadDrawings(browserStore(), symbol);
    const next = { ...emptyMemory(), items };
    memoryRef.current = next;
    setMemory(next);
  }, [symbol]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const chart = createChart(node, {
      width: node.clientWidth || 640,
      height: node.clientHeight || 480,
      layout: { background: { type: ColorType.Solid, color: '#0b1220' }, textColor: '#cbd5e1' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true }
    });
    const series = chart.addCandlestickSeries({
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN
    });
    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      priceLineVisible: false,
      lastValueVisible: false
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    chartRef.current = chart;
    candleRef.current = series;
    volumeRef.current = volume;
    const onRange = () => {
      paintRef.current();
      const visible = chart.timeScale().getVisibleLogicalRange();
      if (!visible || syncing.current) return;
      syncing.current = true;
      for (const pane of [rsiRef.current, macdRef.current, atrRef.current]) {
        pane?.timeScale().setVisibleLogicalRange(visible);
      }
      syncing.current = false;
      if (visible.from < 12 && historyReady.current) void loadOlder();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chart.subscribeCrosshairMove(param => {
      const hovered = typeof param.time === 'number' ? param.time * 1000 : candlesRef.current.at(-1)?.time;
      legendRef.current(hovered ?? null);
    });
    const observer = new ResizeObserver(() => {
      const width = node.clientWidth;
      const height = node.clientHeight;
      if (width < 40 || height < 40) return;
      chart.applyOptions({ width, height });
      paintRef.current();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      chart.remove();
      rsiRef.current?.remove();
      macdRef.current?.remove();
      atrRef.current?.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    fitRef.current = true;
    historyReady.current = false;
    exhausted.current = false;
    setNote('Carregando candles…');
    const params = new URLSearchParams({ symbol, interval, limit: '500' });
    fetch(`/api/klines?${params.toString()}`)
      .then(async response => {
        const body = await response.json() as { candles?: PublicCandle[]; error?: string };
        if (!response.ok) throw new Error(body.error || 'Sem dados');
        return body.candles ?? [];
      })
      .then(rows => {
        if (cancel) return;
        setCandles(rows);
        setNote(rows.length ? '' : 'sem dados');
      })
      .catch(error => {
        if (cancel) return;
        setCandles([]);
        setNote(error instanceof Error ? error.message : 'sem dados');
      });
    return () => { cancel = true; };
  }, [symbol, interval]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = candleRef.current;
    const volume = volumeRef.current;
    if (!chart || !series || !volume) return;
    const times = candles.map(candle => candle.time);
    series.setData(candles.map(candle => ({
      time: sec(candle.time),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    })));
    volume.setData(volumeOn ? candles.map(candle => ({
      time: sec(candle.time),
      value: candle.volume,
      color: candle.close >= candle.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)'
    })) : []);
    for (const extra of extraRef.current) chart.removeSeries(extra);
    extraRef.current = [];
    const closes = candles.map(candle => candle.close);
    const addLine = (values: readonly (number | null)[], color: string) => {
      const rows = lineRows(times, values);
      if (rows.length === 0) return;
      const line = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      line.setData(rows);
      extraRef.current.push(line);
    };
    if (emaOn) {
      const colors = ['#f59e0b', '#38bdf8', '#c084fc', '#fb7185'];
      parsePeriods(emaText).forEach((period, index) => addLine(ema(closes, period), colors[index % colors.length]));
    }
    if (smaOn) parsePeriods(smaText).forEach(period => addLine(sma(closes, period), '#e2e8f0'));
    if (vwapOn) addLine(vwap(candles), '#f472b6');
    if (bbOn) {
      const bands = bollinger(closes, 20, 2);
      addLine(bands.upper, '#64748b');
      addLine(bands.middle, '#94a3b8');
      addLine(bands.lower, '#64748b');
    }
    const range = chart.timeScale().getVisibleLogicalRange();
    if (fitRef.current && candles.length > 0) {
      const fit = () => {
        chart.timeScale().applyOptions({ barSpacing: 8, rightOffset: 3 });
        chart.priceScale('right').applyOptions({ autoScale: true });
        chart.timeScale().fitContent();
      };
      fit();
      requestAnimationFrame(fit);
      window.setTimeout(() => { historyReady.current = true; }, 500);
      fitRef.current = false;
      addedRef.current = 0;
    } else if (range && addedRef.current > 0) {
      chart.timeScale().setVisibleLogicalRange({ from: range.from + addedRef.current, to: range.to + addedRef.current });
      addedRef.current = 0;
    }
    chart.priceScale('right').applyOptions({ mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    syncPane(rsiRef, rsiHost.current, rsiOn, pane => {
      const rows = lineRows(times, rsi(closes, 14));
      const line = pane.addLine('#a78bfa', rows);
      if (rows.length) {
        line.createPriceLine({ price: 70, color: '#475569', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
        line.createPriceLine({ price: 30, color: '#475569', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
      }
    });
    syncPane(macdRef, macdHost.current, macdOn, pane => {
      const result = macd(closes);
      pane.addHist(lineRows(times, result.histogram).map(row => ({
        time: row.time as UTCTimestamp,
        value: row.value,
        color: row.value >= 0 ? UP : DOWN
      })));
      pane.addLine('#f59e0b', lineRows(times, result.signal));
      pane.addLine('#38bdf8', lineRows(times, result.macd));
    });
    syncPane(atrRef, atrHost.current, atrOn, pane => {
      pane.addLine('#34d399', lineRows(times, atr(candles, 14)));
    });
    paintRef.current();
    paintLegend(candles.at(-1)?.time ?? null);
  }, [candles, volumeOn, emaOn, emaText, smaOn, smaText, vwapOn, bbOn, rsiOn, macdOn, atrOn, logScale]);

  function syncPane(
    slot: { current: IChartApi | null },
    node: HTMLDivElement | null,
    enabled: boolean,
    fill: (helper: {
      addLine: (color: string, data: LineData[]) => ISeriesApi<'Line'>;
      addHist: (data: { time: UTCTimestamp; value: number; color?: string }[]) => void;
    }) => void
  ) {
    if (!enabled || !node) {
      slot.current?.remove();
      slot.current = null;
      return;
    }
    if (!slot.current) {
      node.style.position = 'relative';
      node.style.height = '120px';
      node.style.overflow = 'hidden';
      const pane = createChart(node, {
        width: node.clientWidth || 640,
        height: 120,
        layout: { background: { type: ColorType.Solid, color: '#0b1220' }, textColor: '#94a3b8' },
        grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: true, secondsVisible: false },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true }
      });
      pane.timeScale().subscribeVisibleLogicalRangeChange(range => {
        const main = chartRef.current;
        if (!range || !main || syncing.current) return;
        syncing.current = true;
        main.timeScale().setVisibleLogicalRange(range);
        syncing.current = false;
      });
      slot.current = pane;
    }
    const pane = slot.current as IChartApi & { owned?: ISeriesApi<'Line' | 'Histogram'>[] };
    pane.applyOptions({ width: node.clientWidth || 640 });
    for (const series of pane.owned ?? []) pane.removeSeries(series);
    const owned: ISeriesApi<'Line' | 'Histogram'>[] = [];
    fill({
      addLine: (color, data) => {
        const series = pane.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        series.setData(data);
        owned.push(series);
        return series;
      },
      addHist: data => {
        const series = pane.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        series.setData(data);
        owned.push(series);
      }
    });
    pane.owned = owned;
    const mainRange = chartRef.current?.timeScale().getVisibleLogicalRange();
    if (mainRange) pane.timeScale().setVisibleLogicalRange(mainRange);
  }

  async function loadOlder() {
    if (loadingOlder.current || exhausted.current) return;
    const first = candlesRef.current[0];
    if (!first || candlesRef.current.length >= 6000) return;
    loadingOlder.current = true;
    try {
      const params = new URLSearchParams({
        symbol: symbolRef.current,
        interval: intervalRef.current,
        limit: '500',
        endTime: String(first.time - 1)
      });
      const response = await fetch(`/api/klines?${params.toString()}`);
      const body = await response.json() as { candles?: PublicCandle[] };
      if (!response.ok) return;
      const fresh = (body.candles ?? []).filter(candle => candle.time < first.time);
      if (fresh.length === 0) {
        exhausted.current = true;
        return;
      }
      addedRef.current = fresh.length;
      setCandles(current => mergePublicCandles(fresh, current).slice(0, 6000));
    } catch {
      // The candles already on screen stay. The empty edge is still "sem dados" only when nothing loaded.
    } finally {
      loadingOlder.current = false;
    }
  }

  function paintLegend(time: number | null) {
    const rows = candlesRef.current;
    if (!time || rows.length === 0) {
      setLegend({ title: 'sem dados', rows: [] });
      return;
    }
    let nearest = rows[0];
    let best = Math.abs(rows[0].time - time);
    for (const candle of rows) {
      const gap = Math.abs(candle.time - time);
      if (gap < best) {
        nearest = candle;
        best = gap;
      }
    }
    const index = rows.indexOf(nearest);
    const closes = rows.map(candle => candle.close);
    const bits: string[] = [
      `O ${priceFmt.format(nearest.open)}  H ${priceFmt.format(nearest.high)}  L ${priceFmt.format(nearest.low)}  C ${priceFmt.format(nearest.close)}  V ${volFmt.format(nearest.volume)}`
    ];
    if (emaOn) {
      parsePeriods(emaText).forEach(period => {
        const value = ema(closes, period)[index];
        if (value !== null) bits.push(`EMA ${period} ${priceFmt.format(value)}`);
      });
    }
    if (smaOn) {
      parsePeriods(smaText).forEach(period => {
        const value = sma(closes, period)[index];
        if (value !== null) bits.push(`SMA ${period} ${priceFmt.format(value)}`);
      });
    }
    if (vwapOn) {
      const value = vwap(rows)[index];
      if (value !== null) bits.push(`VWAP ${priceFmt.format(value)}`);
    }
    if (bbOn) {
      const bands = bollinger(closes, 20, 2);
      if (bands.middle[index] !== null) bits.push(`Bollinger ${priceFmt.format(bands.lower[index] ?? 0)} – ${priceFmt.format(bands.upper[index] ?? 0)}`);
    }
    if (rsiOn) {
      const value = rsi(closes, 14)[index];
      if (value !== null) bits.push(`RSI ${priceFmt.format(value)}`);
    }
    if (macdOn) {
      const value = macd(closes).macd[index];
      if (value !== null) bits.push(`MACD ${priceFmt.format(value)}`);
    }
    if (atrOn) {
      const value = atr(rows, 14)[index];
      if (value !== null) bits.push(`ATR ${priceFmt.format(value)}`);
    }
    const span = INTERVAL_MS[intervalRef.current];
    for (const item of annotations) {
      if (Math.abs(item.time - nearest.time) <= span) bits.push(item.label);
    }
    setLegend({
      title: new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(nearest.time),
      rows: bits
    });
  }

  function drawShape(ctx: CanvasRenderingContext2D, drawing: Drawing, selected: boolean) {
    const proj = project.current;
    const pts = drawing.points.map(point => ({ x: proj.timeToX(point.time), y: proj.priceToY(point.price), point }));
    ctx.strokeStyle = selected ? '#fbbf24' : '#93c5fd';
    ctx.fillStyle = selected ? 'rgba(251,191,36,0.12)' : 'rgba(147,197,253,0.12)';
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.setLineDash([]);
    const x1 = pts[0]?.x;
    const y1 = pts[0]?.y;
    const x2 = pts[1]?.x ?? x1;
    const y2 = pts[1]?.y ?? y1;
    if (drawing.kind === 'horizontal' && y1 !== null && y1 !== undefined) {
      ctx.beginPath();
      ctx.moveTo(0, y1);
      ctx.lineTo(proj.plotRight, y1);
      ctx.stroke();
    } else if ((drawing.kind === 'tendencia' || drawing.kind === 'medir') && x1 !== null && y1 !== null && x2 !== null && y2 !== null && x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (drawing.kind === 'medir') {
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '12px sans-serif';
        ctx.fillText(measureLabel(drawing.points[0], drawing.points[1], INTERVAL_MS[intervalRef.current]), (x1 + x2) / 2, (y1 + y2) / 2 - 6);
      }
    } else if (drawing.kind === 'raio' && x1 !== null && y1 !== null && x2 !== null && y2 !== null && x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const scale = dx === 0 && dy === 0 ? 1 : Math.max(proj.plotRight, proj.height) / Math.max(1, Math.hypot(dx, dy));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + dx * scale, y1 + dy * scale);
      ctx.stroke();
    } else if (drawing.kind === 'zona' && x1 !== null && y1 !== null && x2 !== null && y2 !== null && x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (drawing.kind === 'fibonacci' && drawing.points.length >= 2) {
      const left = Math.min(drawing.points[0].time, drawing.points[1].time);
      const right = Math.max(drawing.points[0].time, drawing.points[1].time);
      const xa = proj.timeToX(left);
      const xb = proj.timeToX(right);
      ctx.font = '11px sans-serif';
      FIB_LEVELS.forEach(level => {
        const price = drawing.points[0].price + (drawing.points[1].price - drawing.points[0].price) * level;
        const y = proj.priceToY(price);
        if (y === null || xa === null || xb === null) return;
        ctx.beginPath();
        ctx.moveTo(xa, y);
        ctx.lineTo(xb, y);
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`${(level * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`, xb + 4, y - 2);
      });
    } else if (drawing.kind === 'pincel') {
      ctx.beginPath();
      let started = false;
      for (const pt of pts) {
        if (pt.x === null || pt.y === null) continue;
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    } else if (drawing.kind === 'nota' && x1 !== null && y1 !== null && x1 !== undefined && y1 !== undefined) {
      ctx.fillStyle = '#fde68a';
      ctx.font = '12px sans-serif';
      ctx.fillText(drawing.text || 'nota', x1 + 4, y1);
    }
  }

  function paint() {
    const canvas = canvasRef.current;
    const chart = chartRef.current;
    const series = candleRef.current;
    const host = hostRef.current;
    if (!canvas || !chart || !series || !host) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const scaleWidth = chart.priceScale('right').width();
    project.current = {
      timeToX: time => chart.timeScale().timeToCoordinate(sec(time)),
      priceToY: price => series.priceToCoordinate(price),
      xToTime: x => {
        const time = chart.timeScale().coordinateToTime(x);
        return typeof time === 'number' ? time * 1000 : null;
      },
      yToPrice: y => series.coordinateToPrice(y),
      plotRight: Math.max(0, width - scaleWidth),
      height
    };
    const proj = project.current;
    if (layers.estruturas || layers.analogias) {
      for (const zone of zones) {
        if (zone.kind === 'analog' && !layers.analogias) continue;
        if (zone.kind !== 'analog' && !layers.estruturas) continue;
        const y1 = proj.priceToY(zone.high);
        const y2 = proj.priceToY(zone.low);
        if (y1 === null || y2 === null) continue;
        ctx.fillStyle = zone.kind === 'analog' ? 'rgba(56,189,248,0.08)' : zone.kind === 'support' ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)';
        ctx.fillRect(0, Math.min(y1, y2), proj.plotRight, Math.abs(y2 - y1));
      }
    }
    if (layers.paredes) {
      ctx.setLineDash([5, 4]);
      ctx.font = '11px sans-serif';
      for (const wall of walls) {
        const y = proj.priceToY(wall.price);
        if (y === null) continue;
        ctx.strokeStyle = wall.side === 'compra' ? UP : DOWN;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(proj.plotRight, y);
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`parede ${wall.side} ${volFmt.format(wall.usd)}`, 8, y - 4);
      }
      ctx.setLineDash([]);
    }
    if (layers.kronos && forecastBps !== null && candlesRef.current.length) {
      const last = candlesRef.current[candlesRef.current.length - 1];
      const target = last.close * (1 + forecastBps / 10_000);
      const y1 = proj.priceToY(last.close);
      const y2 = proj.priceToY(target);
      const x = proj.timeToX(last.time);
      if (y1 !== null && y2 !== null && x !== null) {
        ctx.fillStyle = 'rgba(167,139,250,0.16)';
        ctx.fillRect(x, Math.min(y1, y2), Math.max(24, proj.plotRight - x), Math.abs(y2 - y1));
        ctx.fillStyle = '#c4b5fd';
        ctx.font = '12px sans-serif';
        ctx.fillText(`previsão ${priceFmt.format(target)}`, x + 6, Math.min(y1, y2) + 14);
      }
    }
    for (const item of annotations) {
      const show = (item.kind === 'rompimento' && layers.rompimentos)
        || (item.kind === 'volume' && layers.anomalias)
        || (item.kind === 'baleia' && layers.baleias)
        || (item.kind === 'cadeia' && layers.cadeia)
        || ((item.kind === 'entrada' || item.kind === 'saida') && layers.paper)
        || (item.kind === 'analogia' && layers.analogias)
        || (item.kind === 'estrutura' && layers.estruturas);
      if (!show) continue;
      const x = proj.timeToX(item.time);
      const y = proj.priceToY(item.price);
      if (x === null || y === null) continue;
      ctx.beginPath();
      if (item.kind === 'baleia') {
        const radius = Math.max(5, Math.min(22, Math.log10(Math.max(item.usd ?? 0, 1)) * 4));
        ctx.fillStyle = item.side === 'venda' ? 'rgba(239,83,80,0.75)' : 'rgba(38,166,154,0.75)';
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      } else if (item.kind === 'cadeia') {
        ctx.fillStyle = '#fbbf24';
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 6, y);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 6, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = item.side === 'venda' ? DOWN : item.kind === 'saida' ? '#fbbf24' : UP;
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x + 6, y + 5);
        ctx.lineTo(x - 6, y + 5);
        ctx.closePath();
        ctx.fill();
      }
    }
    const drawings = draftRef.current ? [...memoryRef.current.items, draftRef.current] : memoryRef.current.items;
    for (const drawing of drawings) drawShape(ctx, drawing, drawing.id === selectedId);
  }
  paintRef.current = paint;
  legendRef.current = paintLegend;

  useEffect(() => { paint(); }, [annotations, zones, walls, forecastBps, layers, memory, draft, selectedId, candles]);

  function localXY(event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointFrom(event: React.PointerEvent<HTMLDivElement>): DrawPoint | null {
    const xy = localXY(event);
    if (!xy) return null;
    const x = Math.min(xy.x, Math.max(0, project.current.plotRight - 2));
    const time = project.current.xToTime(x) ?? candlesRef.current.at(-1)?.time ?? null;
    const price = project.current.yToPrice(xy.y);
    if (time === null || price === null) return null;
    return { time, price };
  }

  function hitDrawing(x: number, y: number): Drawing | null {
    const list = [...memoryRef.current.items].reverse();
    for (const drawing of list) {
      if (nearDrawing(drawing, x, y)) return drawing;
    }
    return null;
  }

  function nearDrawing(drawing: Drawing, x: number, y: number): boolean {
    const proj = project.current;
    const pts = drawing.points.map(point => ({ x: proj.timeToX(point.time), y: proj.priceToY(point.price) }));
    const close = (ax: number | null, ay: number | null, bx: number | null, by: number | null) => {
      if (ax === null || ay === null || bx === null || by === null) return false;
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy;
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < 8;
    };
    if (drawing.kind === 'horizontal') {
      const py = pts[0]?.y;
      return py !== null && py !== undefined && Math.abs(y - py) < 8 && x < proj.plotRight;
    }
    if (drawing.kind === 'zona' && pts[0]?.x !== null && pts[1]?.x !== null && pts[0]?.y !== null && pts[1]?.y !== null) {
      const left = Math.min(pts[0].x ?? 0, pts[1].x ?? 0);
      const right = Math.max(pts[0].x ?? 0, pts[1].x ?? 0);
      const top = Math.min(pts[0].y ?? 0, pts[1].y ?? 0);
      const bottom = Math.max(pts[0].y ?? 0, pts[1].y ?? 0);
      return x >= left && x <= right && y >= top && y <= bottom;
    }
    if (drawing.kind === 'pincel') {
      for (let index = 1; index < pts.length; index++) {
        if (close(pts[index - 1].x, pts[index - 1].y, pts[index].x, pts[index].y)) return true;
      }
      return false;
    }
    if (drawing.kind === 'fibonacci' && drawing.points.length >= 2) {
      return FIB_LEVELS.some(level => {
        const price = drawing.points[0].price + (drawing.points[1].price - drawing.points[0].price) * level;
        const py = proj.priceToY(price);
        return py !== null && Math.abs(y - py) < 8;
      });
    }
    if (drawing.kind === 'nota') {
      return pts[0]?.x !== null && pts[0]?.y !== null && Math.hypot(x - (pts[0].x ?? 0), y - (pts[0].y ?? 0)) < 14;
    }
    return close(pts[0]?.x ?? null, pts[0]?.y ?? null, pts[1]?.x ?? pts[0]?.x ?? null, pts[1]?.y ?? pts[0]?.y ?? null);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const point = pointFrom(event);
    const xy = localXY(event);
    if (!point || !xy || tool === 'navegar') return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'selecionar') {
      const hit = hitDrawing(xy.x, xy.y);
      setSelectedId(hit?.id ?? null);
      if (hit) dragRef.current = { id: hit.id, origin: point, before: memoryRef.current, original: hit };
      return;
    }
    if (tool === 'nota') {
      setNotePoint(point);
      setNoteText('');
      return;
    }
    if (tool === 'horizontal') {
      persist(commitDrawings(memoryRef.current, [...memoryRef.current.items, { id: newId(), kind: 'horizontal', points: [point] }]));
      return;
    }
    const kind = tool as DrawKind;
    setDraft({ id: newId(), kind, points: kind === 'pincel' ? [point] : [point, point] });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const point = pointFrom(event);
    if (!point) return;
    const drag = dragRef.current;
    if (drag) {
      const moved = translateDrawing(drag.original, point.time - drag.origin.time, point.price - drag.origin.price);
      const items = memoryRef.current.items.map(item => item.id === drag.id ? moved : item);
      const next = { ...memoryRef.current, items };
      memoryRef.current = next;
      setMemory(next);
      return;
    }
    const current = draftRef.current;
    if (!current) return;
    if (current.kind === 'pincel') {
      const last = current.points[current.points.length - 1];
      const lx = project.current.timeToX(last.time);
      const ly = project.current.priceToY(last.price);
      const nx = project.current.timeToX(point.time);
      const ny = project.current.priceToY(point.price);
      if (lx === null || ly === null || nx === null || ny === null) return;
      if (Math.hypot(nx - lx, ny - ly) < 3) return;
      setDraft({ ...current, points: [...current.points, point].slice(-400) });
      return;
    }
    setDraft({ ...current, points: [current.points[0], point] });
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      persist(commitDrawings(drag.before, memoryRef.current.items));
      return;
    }
    const current = draftRef.current;
    setDraft(null);
    if (!current) return;
    if (current.kind === 'pincel' && current.points.length < 2) return;
    if (current.kind !== 'pincel' && current.points.length >= 2) {
      const [a, b] = current.points;
      const ax = project.current.timeToX(a.time);
      const ay = project.current.priceToY(a.price);
      const bx = project.current.timeToX(b.time);
      const by = project.current.priceToY(b.price);
      if (ax === null || ay === null || bx === null || by === null) return;
      if (Math.hypot(bx - ax, by - ay) < 4) return;
    }
    persist(commitDrawings(memoryRef.current, [...memoryRef.current.items, current]));
    setSelectedId(current.id);
  }

  function commitNote() {
    if (!notePoint || !noteText.trim()) {
      setNotePoint(null);
      return;
    }
    persist(commitDrawings(memoryRef.current, [...memoryRef.current.items, {
      id: newId(),
      kind: 'nota',
      points: [notePoint],
      text: noteText.trim().slice(0, 80)
    }]));
    setNotePoint(null);
    setNoteText('');
  }

  function removeSelected() {
    if (!selectedId) return;
    persist(commitDrawings(memoryRef.current, memoryRef.current.items.filter(item => item.id !== selectedId)));
    setSelectedId(null);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z') {
        event.preventDefault();
        persist(event.shiftKey ? redoDrawings(memoryRef.current) : undoDrawings(memoryRef.current));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'y') {
        event.preventDefault();
        persist(redoDrawings(memoryRef.current));
        return;
      }
      if (event.key === 'Delete') {
        removeSelected();
        return;
      }
      if (event.key === 'Escape') {
        setTool('navegar');
        setDraft(null);
        setNotePoint(null);
        return;
      }
      const found = TOOLS.find(item => item.key.toLowerCase() === key);
      if (found) setTool(found.id);
      if (key === 'l') setLogScale(value => !value);
      if (key === '0') {
        setLogScale(false);
        fitRef.current = true;
        chartRef.current?.timeScale().fitContent();
        chartRef.current?.priceScale('right').applyOptions({ mode: PriceScaleMode.Normal });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    const chart = chartRef.current;
    const range = chart?.timeScale().getVisibleLogicalRange();
    if (!chart || !range) return;
    event.preventDefault();
    const span = Math.max(15, (range.to - range.from) * (event.deltaY > 0 ? 1.12 : 1 / 1.12));
    const center = (range.from + range.to) / 2;
    chart.timeScale().setVisibleLogicalRange({ from: center - span / 2, to: center + span / 2 });
  }

  const layerLabels: { id: keyof Layers; label: string }[] = [
    { id: 'estruturas', label: 'Estruturas' },
    { id: 'rompimentos', label: 'Rompimentos' },
    { id: 'anomalias', label: 'Volume anormal' },
    { id: 'analogias', label: 'Zonas análogas' },
    { id: 'baleias', label: 'Baleias' },
    { id: 'paredes', label: 'Paredes' },
    { id: 'cadeia', label: 'Cadeia' },
    { id: 'paper', label: 'Paper' },
    { id: 'kronos', label: 'Previsão' }
  ];

  return (
    <div className="pro">
      <div className="pro-tools">
        {INTERVALS.map(item => (
          <button key={item} type="button" className={item === interval ? 'tool on' : 'tool'} onClick={() => setIntervalName(item)}>{item}</button>
        ))}
        <span className="tool-gap" />
        {TOOLS.map(item => (
          <button key={item.id} type="button" className={tool === item.id ? 'tool on' : 'tool'} title={item.key} onClick={() => setTool(item.id)}>{item.label}</button>
        ))}
        <button type="button" className="tool" onClick={() => persist(undoDrawings(memoryRef.current))}>Desfazer</button>
        <button type="button" className="tool" onClick={() => persist(redoDrawings(memoryRef.current))}>Refazer</button>
        <button type="button" className="tool" onClick={removeSelected}>Apagar</button>
        <button type="button" className="tool" onClick={() => chartRef.current?.timeScale().fitContent()}>Encaixar</button>
        <button type="button" className="tool" onClick={() => { setLogScale(false); chartRef.current?.priceScale('right').applyOptions({ mode: PriceScaleMode.Normal }); chartRef.current?.timeScale().fitContent(); }}>Resetar</button>
        <button type="button" className={logScale ? 'tool on' : 'tool'} onClick={() => setLogScale(value => !value)}>{logScale ? 'Log' : 'Preço'}</button>
      </div>
      <div className="chart-frame">
        <div ref={hostRef} className="lwc-host" />
        <div
          className={tool === 'navegar' ? 'draw-layer pass' : 'draw-layer catch'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          <canvas ref={canvasRef} className="draw-canvas" />
        </div>
        <div className="cross-legend">
          <strong>{legend.title}</strong>
          {legend.rows.map((row, index) => <div key={`${index}-${row}`}>{row}</div>)}
        </div>
        {candles.length === 0 && <div className="chart-empty">{note || 'sem dados'}</div>}
        {notePoint && (
          <form className="note-form" onSubmit={event => { event.preventDefault(); commitNote(); }}>
            <input autoFocus value={noteText} placeholder="Nota no gráfico" onChange={event => setNoteText(event.target.value)} />
            <button type="submit">Fixar</button>
          </form>
        )}
      </div>
      {rsiOn && <div className="subpane"><span>RSI 14</span><div ref={rsiHost} className="pane-host" /></div>}
      {macdOn && <div className="subpane"><span>MACD</span><div ref={macdHost} className="pane-host" /></div>}
      {atrOn && <div className="subpane"><span>ATR 14</span><div ref={atrHost} className="pane-host" /></div>}
      <div className="pro-options">
        <label><input type="checkbox" checked={volumeOn} onChange={event => setVolumeOn(event.target.checked)} /> Volume</label>
        <label><input type="checkbox" checked={emaOn} onChange={event => setEmaOn(event.target.checked)} /> EMA <input className="tiny" value={emaText} onChange={event => setEmaText(event.target.value)} /></label>
        <label><input type="checkbox" checked={smaOn} onChange={event => setSmaOn(event.target.checked)} /> SMA <input className="tiny" value={smaText} onChange={event => setSmaText(event.target.value)} /></label>
        <label><input type="checkbox" checked={vwapOn} onChange={event => setVwapOn(event.target.checked)} /> VWAP</label>
        <label><input type="checkbox" checked={bbOn} onChange={event => setBbOn(event.target.checked)} /> Bollinger</label>
        <label><input type="checkbox" checked={rsiOn} onChange={event => setRsiOn(event.target.checked)} /> RSI</label>
        <label><input type="checkbox" checked={macdOn} onChange={event => setMacdOn(event.target.checked)} /> MACD</label>
        <label><input type="checkbox" checked={atrOn} onChange={event => setAtrOn(event.target.checked)} /> ATR</label>
        {layerLabels.map(item => (
          <label key={item.id}><input type="checkbox" checked={layers[item.id]} onChange={event => setLayers(current => ({ ...current, [item.id]: event.target.checked }))} /> {item.label}</label>
        ))}
      </div>
      {note && candles.length > 0 && <p className="muted">{note}</p>}
      <p className="muted">Atalhos: V navegar, S selecionar, T H R Q F P N M desenham, Delete apaga, Ctrl+Z desfaz, L troca a escala, 0 reseta. A roda e o arraste aproximam o gráfico.</p>
    </div>
  );
}
