/**
 * PNG files (W3C PNG, third edition) of 8-bit RGBA images, with Node's own zlib: the same image
 * always gives the same bytes.
 */

import { crc32, deflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

/** A chunk: its length, its type, its data, and the CRC of its type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = new Uint8Array(4 + data.length);
  typed.set(new TextEncoder().encode(type), 0);
  typed.set(data, 4);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(typed, 4);
  view.setUint32(8 + data.length, crc32(typed));
  return result;
}

/**
 * Encodes an image of `width` by `height` pixels, given row by row from the top left as red,
 * green, blue and alpha bytes, alpha not premultiplied.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`An image of ${width} by ${height} pixels is not possible.`);
  }
  if (rgba.length !== width * height * 4) {
    throw new RangeError(
      `An image of ${width} by ${height} pixels has ${width * height * 4} bytes.`,
    );
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  // 8 bits per sample, color type 6 (RGBA), deflate, adaptive filtering, no interlacing.
  header.set([8, 6, 0, 0, 0], 8);

  // Each row starts with its filter type: "Sub", which stores each byte as its difference from
  // the same sample of the pixel to its left, and so compresses even areas well.
  const stride = width * 4;
  const filtered = new Uint8Array(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    const from = row * stride;
    const to = row * (stride + 1);
    filtered[to] = 1;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? (rgba[from + index - 4] ?? 0) : 0;
      filtered[to + 1 + index] = ((rgba[from + index] ?? 0) - left) & 0xff;
    }
  }

  const parts = [
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ];
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
