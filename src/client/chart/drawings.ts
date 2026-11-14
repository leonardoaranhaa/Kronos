export type DrawKind = 'tendencia' | 'horizontal' | 'raio' | 'zona' | 'fibonacci' | 'pincel' | 'nota' | 'medir';

export type DrawTool = 'navegar' | 'selecionar' | DrawKind;

export interface DrawPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  kind: DrawKind;
  points: DrawPoint[];
  text?: string;
}

export interface DrawMemory {
  items: Drawing[];
  undo: Drawing[][];
  redo: Drawing[][];
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KINDS = new Set<DrawKind>(['tendencia', 'horizontal', 'raio', 'zona', 'fibonacci', 'pincel', 'nota', 'medir']);

export function storageKey(symbol: string): string {
  return `kronos.drawings.${symbol}`;
}

export function emptyMemory(): DrawMemory {
  return { items: [], undo: [], redo: [] };
}

export function commitDrawings(memory: DrawMemory, items: Drawing[]): DrawMemory {
  return {
    items: items.slice(0, 200),
    undo: [...memory.undo, memory.items].slice(-40),
    redo: []
  };
}

export function undoDrawings(memory: DrawMemory): DrawMemory {
  const previous = memory.undo[memory.undo.length - 1];
  if (!previous) return memory;
  return {
    items: previous,
    undo: memory.undo.slice(0, -1),
    redo: [...memory.redo, memory.items].slice(-40)
  };
}

export function redoDrawings(memory: DrawMemory): DrawMemory {
  const next = memory.redo[memory.redo.length - 1];
  if (!next) return memory;
  return {
    items: next,
    undo: [...memory.undo, memory.items].slice(-40),
    redo: memory.redo.slice(0, -1)
  };
}

export function translateDrawing(drawing: Drawing, dTime: number, dPrice: number): Drawing {
  return {
    ...drawing,
    points: drawing.points.map(point => ({ time: point.time + dTime, price: point.price + dPrice }))
  };
}

function isPoint(value: unknown): value is DrawPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as DrawPoint;
  return Number.isFinite(point.time) && Number.isFinite(point.price);
}

export function isDrawing(value: unknown): value is Drawing {
  if (!value || typeof value !== 'object') return false;
  const drawing = value as Drawing;
  if (typeof drawing.id !== 'string' || !drawing.id) return false;
  if (!KINDS.has(drawing.kind)) return false;
  if (!Array.isArray(drawing.points) || drawing.points.length === 0 || drawing.points.length > 400) return false;
  if (!drawing.points.every(isPoint)) return false;
  if (drawing.text !== undefined && typeof drawing.text !== 'string') return false;
  return true;
}

export function loadDrawings(store: KeyValueStore, symbol: string): Drawing[] {
  try {
    const raw = store.getItem(storageKey(symbol));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDrawing).slice(0, 200);
  } catch {
    return [];
  }
}

export function saveDrawings(store: KeyValueStore, symbol: string, items: readonly Drawing[]): void {
  store.setItem(storageKey(symbol), JSON.stringify(items.filter(isDrawing).slice(0, 200)));
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
