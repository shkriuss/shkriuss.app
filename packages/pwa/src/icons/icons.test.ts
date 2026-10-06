import { describe, expect, it } from "vitest";
import { appIcons, faviconSvg, glyphOf, type IconColors, type IconSource } from "./icons.ts";
import { PathError } from "./path.ts";
import { type Decoded, decodePng } from "./test/decode.ts";

const COLORS: IconColors = { background: "#1d4ed8", foreground: "#FFFFFF" };
const BLUE = [0x1d, 0x4e, 0xd8, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

/** A glyph that fills its whole square, to see where each kind puts it. */
const SQUARE: IconSource = { size: 24, paths: [{ d: "M0 0H24V24H0Z" }] };

/** A ring, whose hole comes from the even-odd rule. */
const RING: IconSource = {
  size: 24,
  paths: [
    {
      d: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20Z M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12Z",
      fillRule: "evenodd",
    },
  ],
};

function decoded(source: IconSource, fileName: string): Decoded {
  const file = appIcons(source, COLORS).find((icon) => icon.fileName === fileName);
  if (file === undefined) {
    throw new Error(`No ${fileName}.`);
  }
  return decodePng(file.bytes);
}

function pixel({ width, rgba }: Decoded, x: number, y: number): number[] {
  const at = (y * width + x) * 4;
  return [...rgba.subarray(at, at + 4)];
}

describe("appIcons", () => {
  it("makes every icon file, with what the manifest lists of each", () => {
    expect(
      appIcons(SQUARE, COLORS).map(({ fileName, manifest }) => ({ fileName, manifest })),
    ).toStrictEqual([
      {
        fileName: "icon-192.png",
        manifest: { sizes: "192x192", type: "image/png", purpose: "any" },
      },
      {
        fileName: "icon-512.png",
        manifest: { sizes: "512x512", type: "image/png", purpose: "any" },
      },
      {
        fileName: "icon-maskable-192.png",
        manifest: { sizes: "192x192", type: "image/png", purpose: "maskable" },
      },
      {
        fileName: "icon-maskable-512.png",
        manifest: { sizes: "512x512", type: "image/png", purpose: "maskable" },
      },
      {
        fileName: "icon-monochrome-512.png",
        manifest: { sizes: "512x512", type: "image/png", purpose: "monochrome" },
      },
      { fileName: "apple-touch-icon.png", manifest: undefined },
      { fileName: "favicon.svg", manifest: undefined },
    ]);
  });

  it("draws each PNG at its size, with the same bytes every time", () => {
    const first = appIcons(RING, COLORS);
    expect(first).toStrictEqual(appIcons(RING, COLORS));
    expect(
      first
        .filter(({ fileName }) => fileName.endsWith(".png"))
        .map(({ fileName, bytes }) => {
          const { width, height } = decodePng(bytes);
          return [fileName, width, height];
        }),
    ).toStrictEqual([
      ["icon-192.png", 192, 192],
      ["icon-512.png", 512, 512],
      ["icon-maskable-192.png", 192, 192],
      ["icon-maskable-512.png", 512, 512],
      ["icon-monochrome-512.png", 512, 512],
      ["apple-touch-icon.png", 180, 180],
    ]);
  });

  it("puts the glyph on a rounded square for desktops, in its middle 60%, with clear corners", () => {
    const icon = decoded(SQUARE, "icon-512.png");
    expect(pixel(icon, 0, 0)).toStrictEqual(CLEAR);
    expect(pixel(icon, 511, 511)).toStrictEqual(CLEAR);
    // The middle of each side reaches the edge.
    expect(pixel(icon, 0, 256)).toStrictEqual(BLUE);
    expect(pixel(icon, 256, 511)).toStrictEqual(BLUE);
    // 60% of 512 is 307.2 pixels, from 102.4 on.
    expect(pixel(icon, 101, 256)).toStrictEqual(BLUE);
    expect(pixel(icon, 103, 256)).toStrictEqual(WHITE);
    expect(pixel(icon, 408, 256)).toStrictEqual(WHITE);
    expect(pixel(icon, 410, 256)).toStrictEqual(BLUE);
    // The pixel on the glyph's edge is mixed, by how much of it the glyph covers.
    const [red = 0] = pixel(icon, 102, 256);
    expect(red).toBeGreaterThan(BLUE[0] ?? 0);
    expect(red).toBeLessThan(255);
  });

  it("fills maskable icons to every edge, with the glyph in the safe zone", () => {
    for (const fileName of ["icon-maskable-192.png", "icon-maskable-512.png"]) {
      const { rgba } = decoded(SQUARE, fileName);
      const alphas = new Set(rgba.filter((_, index) => index % 4 === 3));
      expect({ fileName, alphas: [...alphas] }).toStrictEqual({ fileName, alphas: [255] });
    }
    // The middle 50%: from 128 to 384 of 512, which a circle of 80% holds.
    const icon = decoded(SQUARE, "icon-maskable-512.png");
    expect(pixel(icon, 0, 0)).toStrictEqual(BLUE);
    expect(pixel(icon, 127, 256)).toStrictEqual(BLUE);
    expect(pixel(icon, 128, 256)).toStrictEqual(WHITE);
    expect(pixel(icon, 383, 383)).toStrictEqual(WHITE);
    expect(pixel(icon, 384, 256)).toStrictEqual(BLUE);
  });

  it("draws the monochrome icon as the glyph alone, in white", () => {
    const icon = decoded(SQUARE, "icon-monochrome-512.png");
    expect(pixel(icon, 0, 0)).toStrictEqual(CLEAR);
    expect(pixel(icon, 127, 256)).toStrictEqual(CLEAR);
    expect(pixel(icon, 256, 256)).toStrictEqual(WHITE);
    // Every pixel that shows is white; only its alpha varies.
    const shown = new Set<string>();
    for (let index = 0; index < icon.rgba.length; index += 4) {
      if ((icon.rgba[index + 3] ?? 0) > 0) {
        shown.add(icon.rgba.subarray(index, index + 3).join());
      }
    }
    expect([...shown]).toStrictEqual(["255,255,255"]);
  });

  it("fills the touch icon to every edge, which iOS rounds itself", () => {
    const icon = decoded(SQUARE, "apple-touch-icon.png");
    expect(pixel(icon, 0, 0)).toStrictEqual(BLUE);
    expect(pixel(icon, 179, 179)).toStrictEqual(BLUE);
    // 60% of 180 is 108 pixels, from 36 on.
    expect(pixel(icon, 35, 90)).toStrictEqual(BLUE);
    expect(pixel(icon, 36, 90)).toStrictEqual(WHITE);
    expect(pixel(icon, 143, 90)).toStrictEqual(WHITE);
    expect(pixel(icon, 144, 90)).toStrictEqual(BLUE);
  });

  it("fills each path by its rule: the ring keeps its hole", () => {
    const icon = decoded(RING, "icon-maskable-512.png");
    // The glyph spans 256 pixels from 128: its center is at 256, its ring 8 to 13.3 units out.
    expect(pixel(icon, 256, 256)).toStrictEqual(BLUE);
    expect(pixel(icon, 256, 256 - Math.round((256 / 24) * 8))).toStrictEqual(WHITE);
    expect(pixel(icon, 256, 256 - Math.round((256 / 24) * 11))).toStrictEqual(BLUE);
  });

  it("refuses a glyph or colors that cannot be drawn", () => {
    expect(() => appIcons({ size: 0, paths: SQUARE.paths }, COLORS)).toThrow("positive number");
    expect(() => appIcons({ size: Number.NaN, paths: SQUARE.paths }, COLORS)).toThrow(
      "positive number",
    );
    expect(() => appIcons({ size: 24, paths: [] }, COLORS)).toThrow("at least one path");
    expect(() => appIcons({ size: 24, paths: [{ d: "M0 0L25 0L0 1Z" }] }, COLORS)).toThrow(
      "within its square of 24 units",
    );
    // A curve that leaves the square, though its ends are inside.
    expect(() => appIcons({ size: 24, paths: [{ d: "M0 1C40 0 40 2 0 2Z" }] }, COLORS)).toThrow(
      "within its square",
    );
    // A curve whose control points leave the square, but which stays inside, is drawn: a circle
    // that touches every side.
    expect(() =>
      appIcons({ size: 24, paths: [{ d: "M0 12a12 12 0 1 0 24 0a12 12 0 1 0-24 0Z" }] }, COLORS),
    ).not.toThrow();
    expect(() => appIcons({ size: 24, paths: [{ d: "M0 0C-1 8 -1 16 0 24H4Z" }] }, COLORS)).toThrow(
      "within its square",
    );
    expect(() => appIcons({ size: 24, paths: [{ d: "M0 0L1 1 q" }] }, COLORS)).toThrow(PathError);
    expect(() => appIcons(SQUARE, { ...COLORS, background: "blue" })).toThrow(
      '"blue" is not a color',
    );
    expect(() => appIcons(SQUARE, { ...COLORS, foreground: "#fff" })).toThrow(
      '"#fff" is not a color',
    );
  });
});

describe("faviconSvg", () => {
  it("writes the glyph on a rounded square, as numbers and commands only", () => {
    expect(faviconSvg(glyphOf(SQUARE), COLORS)).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">' +
        '<rect width="40" height="40" rx="10" fill="#1d4ed8"/>' +
        '<g fill="#ffffff"><path d="M8 8L32 8L32 32L8 32Z" fill-rule="nonzero"/></g>' +
        "</svg>\n",
    );
  });

  it("writes curves with at most four decimals, and the rule of each path", () => {
    const svg = faviconSvg(glyphOf(RING), COLORS);
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toMatch(/<path d="M20 10C\d+(?:\.\d{1,4})? /);
    expect(svg).not.toMatch(/\d\.\d{5}/);
  });
});
