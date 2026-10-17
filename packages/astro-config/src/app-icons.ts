/**
 * App icons, drawn from the registry entry (icon + colour) so every app gets
 * a matching set without anyone designing image files by hand.
 */
import { createRequire } from 'node:module';
import type { SiteInfo } from '@shkriuss/registry';
import type Sharp from 'sharp';
import { iconColors } from '@shkriuss/ui/colors';
import { icons, isIconName } from '@shkriuss/ui/icons';

export interface IconVariant {
  /** Rounded corners (normal icons) or full-bleed square (maskable/Apple). */
  shape: 'rounded' | 'square';
  /** How much of the canvas the glyph covers (0–1). Maskable icons need extra padding. */
  glyphScale: number;
}

export const ICON_VARIANTS = {
  favicon: { shape: 'rounded', glyphScale: 0.62 },
  any: { shape: 'rounded', glyphScale: 0.58 },
  maskable: { shape: 'square', glyphScale: 0.46 },
  apple: { shape: 'square', glyphScale: 0.56 },
} as const satisfies Record<string, IconVariant>;

/** An SVG app icon on a 512×512 canvas. */
export function appIconSvg(site: Pick<SiteInfo, 'icon' | 'color'>, variant: IconVariant): string {
  if (!isIconName(site.icon)) {
    throw new Error(`Unknown icon "${site.icon}". See packages/ui/src/icons/index.ts.`);
  }
  const size = 512;
  const glyph = size * variant.glyphScale;
  const offset = (size - glyph) / 2;
  const scale = glyph / 24;
  const radius = variant.shape === 'rounded' ? size * 0.22 : 0;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${iconColors[site.color]}"/>`,
    `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`,
    icons[site.icon],
    '</g></svg>',
  ].join('');
}

/** Renders an icon SVG to PNG at the given size (build time only). */
export async function renderPng(svg: string, size: number): Promise<Uint8Array> {
  // sharp is a native image library. Load it with Node's own require so it is
  // found next to this package (and not bundled into the site build).
  const sharp = createRequire(import.meta.url)('sharp') as typeof Sharp;
  const buffer = await sharp(Buffer.from(svg), { density: 300 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(buffer);
}
