import { crc32, inflateSync } from "node:zlib";

/** An image that `decodePng()` read: its size, and its RGBA bytes row by row. */
export interface Decoded {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

/**
 * Reads a PNG file of the kind that `encodePng()` writes, checking every chunk's CRC: 8-bit RGBA,
 * not interlaced, each row with the filter type None or Sub. Anything else throws.
 */
export function decodePng(file: Uint8Array): Decoded {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const signature = [...file.subarray(0, 8)];
  if (signature.join() !== [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].join()) {
    throw new Error("Not a PNG file.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  const data: Uint8Array[] = [];
  const types: string[] = [];
  while (offset < file.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(file.subarray(offset + 4, offset + 8));
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (
      view.getUint32(offset + 8 + length) !== crc32(file.subarray(offset + 4, offset + 8 + length))
    ) {
      throw new Error(`The CRC of the ${type} chunk is wrong.`);
    }
    types.push(type);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if ([...body.subarray(8)].join() !== "8,6,0,0,0") {
        throw new Error("Not an 8-bit RGBA image without interlacing.");
      }
    } else if (type === "IDAT") {
      data.push(body);
    }
    offset += 12 + length;
  }
  if (types.join() !== "IHDR,IDAT,IEND") {
    throw new Error(`Unexpected chunks: ${types.join()}.`);
  }
  const filtered = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  if (filtered.length !== height * (stride + 1)) {
    throw new Error("The image data has the wrong length.");
  }
  const rgba = new Uint8Array(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * (stride + 1)];
    for (let index = 0; index < stride; index += 1) {
      const value = filtered[row * (stride + 1) + 1 + index] ?? 0;
      if (filter === 0) {
        rgba[row * stride + index] = value;
      } else if (filter === 1) {
        const left = index >= 4 ? (rgba[row * stride + index - 4] ?? 0) : 0;
        rgba[row * stride + index] = (value + left) & 0xff;
      } else {
        throw new Error(`Unexpected filter type ${filter}.`);
      }
    }
  }
  return { width, height, rgba };
}
