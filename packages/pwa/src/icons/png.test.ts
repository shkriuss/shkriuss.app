import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { encodePng } from "./png.ts";
import { decodePng } from "./test/decode.ts";

describe("encodePng", () => {
  it("writes the signature, the header, the image and the end, each chunk with its CRC", () => {
    const rgba = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 128);
    const file = encodePng(2, 1, rgba);
    expect([...file.subarray(0, 8)]).toStrictEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(decodePng(file)).toStrictEqual({ width: 2, height: 1, rgba });
  });

  it("gives back every image exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.infiniteStream(fc.integer({ min: 0, max: 255 })),
        (width, height, bytes) => {
          const rgba = Uint8Array.from(bytes.take(width * height * 4));
          expect(decodePng(encodePng(width, height, rgba))).toStrictEqual({ width, height, rgba });
        },
      ),
    );
  });

  it("always writes the same bytes for the same image", () => {
    const rgba = new Uint8Array(64 * 64 * 4).map((_, index) => (index * 7) % 256);
    expect(encodePng(64, 64, rgba)).toStrictEqual(encodePng(64, 64, rgba));
  });

  it("refuses sizes that are no image, and bytes that are not the image's", () => {
    expect(() => encodePng(0, 1, new Uint8Array(0))).toThrow(RangeError);
    expect(() => encodePng(1.5, 1, new Uint8Array(6))).toThrow(RangeError);
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow("has 16 bytes");
  });
});
