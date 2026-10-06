/**
 * An app's icons, from its glyph and its colors (architecture §9): the PNG files that the web app
 * manifest lists, the touch icon that iOS puts on the home screen, and the SVG favicon. Every
 * file comes from the same glyph, so the icons always match.
 */

import { type Point, parsePath, type Subpath } from "./path.ts";
import { encodePng } from "./png.ts";
import { type FillRule, fill, flatten } from "./raster.ts";

/** One shape of the glyph: SVG path data, and how it is filled (`nonzero` if left out). */
export interface IconPath {
  readonly d: string;
  readonly fillRule?: FillRule;
}

/**
 * The glyph of an app's icon: shapes drawn in a square of `size` units, as in an SVG whose
 * `viewBox` is `0 0 size size`. Only filled paths: an outline becomes one with "outline stroke"
 * in any SVG editor.
 */
export interface IconSource {
  readonly size: number;
  readonly paths: readonly IconPath[];
}

/** The colors of an app's icons, as `#rrggbb`. */
export interface IconColors {
  /** Behind the glyph: the app's accent color. */
  readonly background: string;
  /** The glyph's. */
  readonly foreground: string;
}

/** A file of the icons, as the build writes it at the root of the site. */
export interface IconFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  /** Its entry in the manifest's `icons`; the touch icon and the favicon are linked from the page. */
  readonly manifest?: { readonly sizes: string; readonly type: string; readonly purpose: string };
}

/**
 * The kinds of icon, each with how much of the icon the glyph spans:
 *
 * - `any`: the glyph on a rounded square of the background, as desktops show apps.
 * - `maskable`: the background to every edge, with the glyph in the middle 50%, inside the safe
 *   zone that every mask leaves visible, a circle of 80% (W3C Web App Manifest, §8.4).
 * - `monochrome`: the glyph alone, in white: Android tints it for themed icons.
 * - `touch`: the background to every edge, which iOS rounds itself, with the glyph in the
 *   middle 60%.
 */
export type Kind = "any" | "maskable" | "monochrome" | "touch";

const GLYPH: Readonly<Record<Kind, number>> = {
  any: 0.6,
  maskable: 0.5,
  monochrome: 0.5,
  touch: 0.6,
};

/** The corner radius of the rounded square of `any` icons and of the favicon, by their size. */
const CORNER = 0.25;

const COLOR = /^#[\da-f]{6}$/i;

/** A color's red, green and blue, from 0 to 1. */
function channels(color: string): readonly [number, number, number] {
  if (!COLOR.test(color)) {
    throw new Error(`${JSON.stringify(color)} is not a color such as "#1d4ed8".`);
  }
  const value = Number.parseInt(color.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/** The glyph's shapes, parsed once, checked to lie within its square. */
export interface Glyph {
  readonly size: number;
  readonly shapes: readonly { readonly subpaths: Subpath[]; readonly rule: FillRule }[];
}

/** Parses the glyph's paths, and checks that they lie within its square. */
export function glyphOf(source: IconSource): Glyph {
  const { size, paths } = source;
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`An icon's size must be a positive number, not ${size}.`);
  }
  if (paths.length === 0) {
    throw new Error("An icon needs at least one path.");
  }
  // Points on the curves, as filling draws them, with a margin for their rounding.
  const margin = size * 1e-9;
  const inside = ({ x, y }: Point): boolean =>
    x >= -margin && x <= size + margin && y >= -margin && y <= size + margin;
  const shapes = paths.map(({ d, fillRule = "nonzero" }) => {
    const subpaths = parsePath(d);
    for (const subpath of subpaths) {
      if (!flatten(subpath, { scale: 1, dx: 0, dy: 0 }).every(inside)) {
        throw new Error(`An icon's paths must lie within its square of ${size} units.`);
      }
    }
    return { subpaths, rule: fillRule };
  });
  return { size, shapes };
}

/** A rounded square of `size` pixels with corners of `radius`, or a square without. */
function square(size: number, radius: number): Subpath[] {
  const r = radius;
  const far = size - r;
  return parsePath(
    r === 0
      ? `M0 0H${size}V${size}H0Z`
      : `M${r} 0H${far}A${r} ${r} 0 0 1 ${size} ${r}V${far}A${r} ${r} 0 0 1 ${far} ${size}H${r}A${r} ${r} 0 0 1 0 ${far}V${r}A${r} ${r} 0 0 1 ${r} 0Z`,
  );
}

/** Draws one icon of `pixels` by `pixels`, as RGBA with alpha not premultiplied. */
export function drawIcon(glyph: Glyph, colors: IconColors, kind: Kind, pixels: number): Uint8Array {
  const area = pixels * pixels;
  // Premultiplied red, green, blue and alpha, from 0 to 1.
  const color = new Float64Array(area * 4);
  const paint = (
    coverage: Float32Array,
    [red, green, blue]: readonly [number, number, number],
  ): void => {
    for (let index = 0; index < area; index += 1) {
      const alpha = coverage[index] ?? 0;
      if (alpha > 0) {
        const at = index * 4;
        const rest = 1 - alpha;
        color[at] = red * alpha + (color[at] ?? 0) * rest;
        color[at + 1] = green * alpha + (color[at + 1] ?? 0) * rest;
        color[at + 2] = blue * alpha + (color[at + 2] ?? 0) * rest;
        color[at + 3] = alpha + (color[at + 3] ?? 0) * rest;
      }
    }
  };

  if (kind !== "monochrome") {
    const radius = kind === "any" ? pixels * CORNER : 0;
    paint(
      fill(square(pixels, radius), { scale: 1, dx: 0, dy: 0 }, pixels, pixels, "nonzero"),
      channels(colors.background),
    );
  }
  const span = pixels * GLYPH[kind];
  const placement = { scale: span / glyph.size, dx: (pixels - span) / 2, dy: (pixels - span) / 2 };
  const foreground = kind === "monochrome" ? channels("#ffffff") : channels(colors.foreground);
  for (const { subpaths, rule } of glyph.shapes) {
    paint(fill(subpaths, placement, pixels, pixels, rule), foreground);
  }

  const rgba = new Uint8Array(area * 4);
  for (let index = 0; index < area; index += 1) {
    const at = index * 4;
    const alpha = color[at + 3] ?? 0;
    // A pixel too faint to show stays transparent black.
    if (Math.round(alpha * 255) > 0) {
      rgba[at] = Math.round(((color[at] ?? 0) / alpha) * 255);
      rgba[at + 1] = Math.round(((color[at + 1] ?? 0) / alpha) * 255);
      rgba[at + 2] = Math.round(((color[at + 2] ?? 0) / alpha) * 255);
      rgba[at + 3] = Math.round(alpha * 255);
    }
  }
  return rgba;
}

/** A number for SVG: at most four decimals, and no exponent. */
function svgNumber(value: number): string {
  const rounded = Number(value.toFixed(4));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * The SVG favicon: the glyph on a rounded square, as the `any` icons have it. Its path data is
 * written again from the parsed paths, so the file holds nothing but numbers and commands.
 */
export function faviconSvg(glyph: Glyph, colors: IconColors): string {
  channels(colors.background);
  channels(colors.foreground);
  const side = glyph.size / GLYPH.any;
  const offset = (side - glyph.size) / 2;
  const point = ({ x, y }: Point): string => `${svgNumber(x + offset)} ${svgNumber(y + offset)}`;
  const paths = glyph.shapes.map(({ subpaths, rule }) => {
    const d = subpaths
      .map(({ start, pieces }) => {
        const drawn = pieces.map((piece) =>
          piece.kind === "line"
            ? `L${point(piece.to)}`
            : `C${point(piece.c1)} ${point(piece.c2)} ${point(piece.to)}`,
        );
        return `M${point(start)}${drawn.join("")}Z`;
      })
      .join("");
    return `<path d="${d}" fill-rule="${rule}"/>`;
  });
  const size = svgNumber(side);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${svgNumber(side * CORNER)}" fill="${colors.background.toLowerCase()}"/>`,
    `<g fill="${colors.foreground.toLowerCase()}">${paths.join("")}</g>`,
    "</svg>\n",
  ].join("");
}

/** Every icon file of an app, from its glyph and its colors. */
export function appIcons(source: IconSource, colors: IconColors): IconFile[] {
  const glyph = glyphOf(source);
  const png = (fileName: string, kind: Kind, pixels: number, purpose?: string): IconFile => ({
    fileName,
    bytes: encodePng(pixels, pixels, drawIcon(glyph, colors, kind, pixels)),
    ...(purpose === undefined
      ? {}
      : { manifest: { sizes: `${pixels}x${pixels}`, type: "image/png", purpose } }),
  });
  return [
    png("icon-192.png", "any", 192, "any"),
    png("icon-512.png", "any", 512, "any"),
    png("icon-maskable-192.png", "maskable", 192, "maskable"),
    png("icon-maskable-512.png", "maskable", 512, "maskable"),
    png("icon-monochrome-512.png", "monochrome", 512, "monochrome"),
    png("apple-touch-icon.png", "touch", 180),
    { fileName: "favicon.svg", bytes: new TextEncoder().encode(faviconSvg(glyph, colors)) },
  ];
}
