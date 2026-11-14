import { inflateRawSync } from 'node:zlib';

/** Reads the first entry of a Zip archive (store or deflate). Binance Vision dumps are one CSV. */
export function readZipText(buffer: Buffer): { name: string; text: string } {
  if (buffer.length < 30 || buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('arquivo zip inválido');
  }
  const flags = buffer.readUInt16LE(6);
  const method = buffer.readUInt16LE(8);
  let compressedSize = buffer.readUInt32LE(18);
  const nameLength = buffer.readUInt16LE(26);
  const extraLength = buffer.readUInt16LE(28);
  const nameStart = 30;
  const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
  const dataStart = nameStart + nameLength + extraLength;
  if (flags & 0x08 || compressedSize === 0) {
    throw new Error(`zip sem tamanho no cabeçalho: ${name}`);
  }
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
  if (compressed.length !== compressedSize) {
    throw new Error(`zip truncado: ${name}`);
  }
  const text = method === 0
    ? compressed.toString('utf8')
    : method === 8
      ? inflateRawSync(compressed).toString('utf8')
      : null;
  if (text === null) throw new Error(`zip com método ${method} não suportado: ${name}`);
  return { name, text: text.replace(/^\uFEFF/, '') };
}
