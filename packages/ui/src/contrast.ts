/** A color as `#rrggbb`, the form the design tokens use. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Whether `value` is a color as `#rrggbb`. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

/** One channel of an sRGB color, from 0 to 1, made linear (WCAG 2.2, relative luminance). */
function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** The relative luminance of a color, from 0 for black to 1 for white (WCAG 2.2). */
export function relativeLuminance(color: string): number {
  if (!isHexColor(color)) {
    throw new TypeError(`"${color}" is not a color as #rrggbb.`);
  }
  const channel = (start: number): number =>
    linear(Number.parseInt(color.slice(start, start + 2), 16) / 255);
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The contrast ratio of two colors, from 1 to 21 (WCAG 2.2). Normal text needs 4.5 (1.4.3), and
 * the borders of controls and focus outlines need 3 (1.4.11).
 */
export function contrastRatio(first: string, second: string): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
