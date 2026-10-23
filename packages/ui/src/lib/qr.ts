/**
 * A small QR code encoder (ISO/IEC 18004), so a phone's camera can open a
 * link shown on another device. No network, and no package to install.
 *
 * It follows Project Nayuki's QR Code generator library
 * (https://www.nayuki.io/page/qr-code-generator-library):
 *
 *   Copyright (c) Project Nayuki. (MIT License)
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to
 *   permit persons to whom the Software is furnished to do so, subject to the
 *   following conditions:
 *   - The above copyright notice and this permission notice shall be
 *     included in all copies or substantial portions of the Software.
 *   - The Software is provided "as is", without warranty of any kind,
 *     express or implied, including but not limited to the warranties of
 *     merchantability, fitness for a particular purpose and noninfringement.
 *     In no event shall the authors or copyright holders be liable for any
 *     claim, damages or other liability, whether in an action of contract,
 *     tort or otherwise, arising from, out of or in connection with the
 *     Software or the use or other dealings in the Software.
 *
 * Pages that show a QR code link to the same notice (the hub's
 * /licenses/qrcodegen.txt), since the built file has no comments.
 *
 * It covers what links need: text as bytes (UTF-8), error correction level M
 * (about 15% of the code can be damaged and still scan), versions 1 to 10
 * (up to 213 bytes). The best of the 8 masks is chosen by the standard's
 * penalty rules, which keep the pattern easy for cameras to read.
 */

export interface QrCode {
  /** Modules per side (21 for version 1, up to 57 for version 10). */
  size: number;
  /** modules[row][column]: true is dark. */
  modules: boolean[][];
  version: number;
  mask: number;
}

export const QR_MAX_VERSION = 10;

/** Error correction level M, per version 1–10: codewords per block, and blocks. */
const EC_CODEWORDS = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const EC_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
/** Format bits for level M. */
const LEVEL_M = 0;

/** Modules available for data and error correction in a version. */
function rawDataModules(version: number): number {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    modules -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) modules -= 36;
  }
  return modules;
}

const totalCodewords = (version: number) => Math.floor(rawDataModules(version) / 8);
const dataCodewords = (version: number) =>
  totalCodewords(version) - (EC_CODEWORDS[version] as number) * (EC_BLOCKS[version] as number);
/** Bits for the length field in byte mode. */
const countBits = (version: number) => (version < 10 ? 8 : 16);

/** Centre rows/columns of the alignment patterns. */
function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const positions = [6];
  for (let position = size - 7; positions.length < count; position -= step) {
    positions.splice(1, 0, position);
  }
  return positions;
}

// ---------- Reed–Solomon error correction over GF(256) ----------

function gfMultiply(x: number, y: number): number {
  let product = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((y >>> bit) & 1) * x;
  }
  return product & 0xff;
}

function generatorPolynomial(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let term = 0; term < degree; term += 1) {
      result[term] = gfMultiply(result[term] as number, root);
      if (term + 1 < degree) result[term] = (result[term] as number) ^ (result[term + 1] as number);
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function errorCorrection(data: readonly number[], generator: readonly number[]): number[] {
  const result = new Array<number>(generator.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    generator.forEach((coefficient, index) => {
      result[index] = (result[index] as number) ^ gfMultiply(coefficient, factor);
    });
  }
  return result;
}

// ---------- Building the code ----------

/** The data as codewords: mode, length, bytes, terminator and padding. */
function dataCodewordsOf(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    codewords.push(bits.slice(index, index + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  return codewords;
}

/** Splits into blocks, adds error correction, and interleaves (the standard's order). */
function finalCodewords(data: readonly number[], version: number): number[] {
  const blocks = EC_BLOCKS[version] as number;
  const ecLength = EC_CODEWORDS[version] as number;
  const total = totalCodewords(version);
  const shortBlocks = blocks - (total % blocks);
  const shortLength = Math.floor(total / blocks);
  const generator = generatorPolynomial(ecLength);
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (let block = 0; block < blocks; block += 1) {
    const length = shortLength - ecLength + (block < shortBlocks ? 0 : 1);
    const part = data.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(part);
    ecBlocks.push(errorCorrection(part, generator));
  }
  const result: number[] = [];
  const longest = shortLength - ecLength + 1;
  for (let index = 0; index < longest; index += 1) {
    for (const block of dataBlocks) if (index < block.length) result.push(block[index] as number);
  }
  for (let index = 0; index < ecLength; index += 1) {
    for (const block of ecBlocks) result.push(block[index] as number);
  }
  return result;
}

class Grid {
  readonly size: number;
  readonly dark: boolean[][];
  /** Finder, timing, alignment, format and version areas: never masked or used for data. */
  readonly reserved: boolean[][];

  constructor(size: number) {
    this.size = size;
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  set(row: number, column: number, dark: boolean): void {
    (this.dark[row] as boolean[])[column] = dark;
    (this.reserved[row] as boolean[])[column] = true;
  }

  isReserved(row: number, column: number): boolean {
    return (this.reserved[row] as boolean[])[column] as boolean;
  }
}

function drawFinder(grid: Grid, centreRow: number, centreColumn: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const row = centreRow + dy;
      const column = centreColumn + dx;
      if (row < 0 || row >= grid.size || column < 0 || column >= grid.size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      grid.set(row, column, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(grid: Grid, centreRow: number, centreColumn: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      grid.set(centreRow + dy, centreColumn + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

/** BCH code used by the format and version information. */
function bch(value: number, dataBits: number, generator: number, generatorBits: number): number {
  let remainder = value << (generatorBits - 1);
  for (let bit = dataBits + generatorBits - 2; bit >= generatorBits - 1; bit -= 1) {
    if ((remainder >>> bit) & 1) remainder ^= generator << (bit - generatorBits + 1);
  }
  return (value << (generatorBits - 1)) | remainder;
}

function drawFormat(grid: Grid, mask: number): void {
  const bits = bch((LEVEL_M << 3) | mask, 5, 0x537, 11) ^ 0x5412;
  const bit = (index: number) => ((bits >>> index) & 1) === 1;
  const size = grid.size;
  // Around the top-left finder.
  for (let index = 0; index <= 5; index += 1) grid.set(index, 8, bit(index));
  grid.set(7, 8, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(8, 7, bit(8));
  for (let index = 9; index < 15; index += 1) grid.set(8, 14 - index, bit(index));
  // Split between the top-right and bottom-left finders.
  for (let index = 0; index < 8; index += 1) grid.set(8, size - 1 - index, bit(index));
  for (let index = 8; index < 15; index += 1) grid.set(size - 15 + index, 8, bit(index));
  grid.set(size - 8, 8, true);
}

function drawVersion(grid: Grid, version: number): void {
  if (version < 7) return;
  const bits = bch(version, 6, 0x1f25, 13);
  for (let index = 0; index < 18; index += 1) {
    const dark = ((bits >>> index) & 1) === 1;
    const a = grid.size - 11 + (index % 3);
    const b = Math.floor(index / 3);
    grid.set(b, a, dark);
    grid.set(a, b, dark);
  }
}

function drawFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size;
  for (let index = 0; index < size; index += 1) {
    grid.set(6, index, index % 2 === 0);
    grid.set(index, 6, index % 2 === 0);
  }
  drawFinder(grid, 3, 3);
  drawFinder(grid, 3, size - 4);
  drawFinder(grid, size - 4, 3);
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((row, i) => {
    positions.forEach((column, j) => {
      // Not where they would overlap the three finders.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      drawAlignment(grid, row, column);
    });
  });
  drawFormat(grid, 0);
  drawVersion(grid, version);
}

/** Places the codewords' bits in the standard's zigzag, two columns at a time. */
function drawCodewords(grid: Grid, codewords: readonly number[]): void {
  const size = grid.size;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - step : step;
        if (grid.isReserved(row, column)) continue;
        const byte = codewords[bitIndex >>> 3] ?? 0;
        (grid.dark[row] as boolean[])[column] = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex += 1;
      }
    }
  }
}

const MASKS: ((row: number, column: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, mask: number): boolean[][] {
  const condition = MASKS[mask] as (row: number, column: number) => boolean;
  return grid.dark.map((line, row) =>
    line.map((dark, column) =>
      grid.isReserved(row, column) ? dark : dark !== condition(row, column),
    ),
  );
}

/** The standard's penalty score: lower is easier for cameras to read. */
export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const at = (row: number, column: number) => (modules[row] as readonly boolean[])[column];
  let score = 0;
  const lines: boolean[][] = [];
  for (let index = 0; index < size; index += 1) {
    lines.push([...(modules[index] as readonly boolean[])]);
    lines.push(modules.map((line) => line[index] as boolean));
  }
  // Rule 1: runs of 5 or more modules of one colour. Rule 3: finder-like patterns.
  const finderLike = [true, false, true, true, true, false, true];
  for (const line of lines) {
    let run = 1;
    for (let index = 1; index <= size; index += 1) {
      if (index < size && line[index] === line[index - 1]) {
        run += 1;
        continue;
      }
      if (run >= 5) score += run - 2;
      run = 1;
    }
    for (let start = 0; start + 7 <= size; start += 1) {
      if (!finderLike.every((dark, index) => line[start + index] === dark)) continue;
      const lightBefore = [1, 2, 3, 4].every((d) => start - d < 0 || line[start - d] === false);
      const lightAfter = [0, 1, 2, 3].every(
        (d) => start + 7 + d >= size || line[start + 7 + d] === false,
      );
      if (lightBefore) score += 40;
      if (lightAfter) score += 40;
    }
  }
  // Rule 2: 2×2 blocks of one colour.
  for (let row = 0; row + 1 < size; row += 1) {
    for (let column = 0; column + 1 < size; column += 1) {
      const colour = at(row, column);
      if (
        colour === at(row, column + 1) &&
        colour === at(row + 1, column) &&
        colour === at(row + 1, column + 1)
      ) {
        score += 3;
      }
    }
  }
  // Rule 4: far from half dark.
  const dark = modules.reduce((total, line) => total + line.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

export interface QrOptions {
  /** Use this version (the smallest that fits by default). */
  version?: number;
  /** Use this mask, 0–7 (the best by default). */
  mask?: number;
}

/** Encodes text (as UTF-8) in the smallest QR code that holds it. */
export function encodeQr(text: string, options: QrOptions = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  const fits = (version: number) =>
    4 + countBits(version) + bytes.length * 8 <= dataCodewords(version) * 8;
  let version = options.version ?? 1;
  while (version <= QR_MAX_VERSION && !fits(version)) {
    if (options.version !== undefined) throw new RangeError('Text too long for this version');
    version += 1;
  }
  if (version > QR_MAX_VERSION) throw new RangeError('Text too long for a QR code here');

  const size = version * 4 + 17;
  const grid = new Grid(size);
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, finalCodewords(dataCodewordsOf(bytes, version), version));

  const candidates = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
  let best: { mask: number; modules: boolean[][]; score: number } | undefined;
  for (const mask of candidates) {
    drawFormat(grid, mask);
    const modules = applyMask(grid, mask);
    const score = candidates.length === 1 ? 0 : penalty(modules);
    if (!best || score < best.score) best = { mask, modules, score };
  }
  const chosen = best as { mask: number; modules: boolean[][] };
  return { size, modules: chosen.modules, version, mask: chosen.mask };
}
