import { deflateSync } from 'node:zlib';
import type { ChartCandle, PriceZone } from './types';

const WIDTH = 640;
const HEIGHT = 280;

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length - 4, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([header, body, crc]);
}

/** Small candlestick PNG with support and resistance bands, for the optional chart analyst. */
export function renderChartPng(candles: readonly ChartCandle[], zones: readonly PriceZone[] = []): Buffer {
  const width = WIDTH;
  const height = HEIGHT;
  const pixels = new Uint8Array(width * height * 3);
  const set = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 3;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
  };
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = 15;
    pixels[i + 1] = 23;
    pixels[i + 2] = 42;
  }
  const pad = 16;
  const series = candles.slice(-80);
  if (series.length >= 2) {
    let low = Math.min(...series.map(candle => candle.l));
    let high = Math.max(...series.map(candle => candle.h));
    for (const zone of zones) {
      if (zone.high < low * 0.99 || zone.low > high * 1.01) continue;
      low = Math.min(low, zone.low);
      high = Math.max(high, zone.high);
    }
    const span = high - low || 1;
    const yOf = (price: number) => Math.round(height - pad - ((price - low) / span) * (height - pad * 2));
    for (const zone of zones) {
      const y1 = yOf(zone.high);
      const y2 = yOf(zone.low);
      const top = Math.min(y1, y2);
      const bottom = Math.max(y1, y2);
      const color = zone.kind === 'support' ? [22, 80, 48] : [90, 24, 40];
      for (let y = top; y <= bottom; y += 2) {
        for (let x = pad; x < width - pad; x += 2) set(x, y, color[0], color[1], color[2]);
      }
    }
    const slot = (width - pad * 2) / series.length;
    series.forEach((candle, index) => {
      const x = Math.round(pad + index * slot + slot / 2);
      const up = candle.c >= candle.o;
      const color: [number, number, number] = up ? [74, 222, 128] : [251, 113, 133];
      const yHigh = yOf(candle.h);
      const yLow = yOf(candle.l);
      for (let y = Math.min(yHigh, yLow); y <= Math.max(yHigh, yLow); y++) set(x, y, color[0], color[1], color[2]);
      const bodyTop = yOf(Math.max(candle.o, candle.c));
      const bodyBottom = yOf(Math.min(candle.o, candle.c));
      const half = Math.max(1, Math.floor(slot * 0.3));
      for (let y = bodyTop; y <= Math.max(bodyTop, bodyBottom); y++) {
        for (let dx = -half; dx <= half; dx++) set(x + dx, y, color[0], color[1], color[2]);
      }
    });
  }

  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
