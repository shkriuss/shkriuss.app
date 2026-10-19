/**
 * Colour contrast checks for the design tokens, in both themes.
 * WCAG 2.2 AA: text needs 4.5:1; UI parts (borders, focus rings) need 3:1.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { backgroundColors, iconColors } from '../../packages/ui/src/icons/colors.ts';

const tokensCss = readFileSync(
  join(import.meta.dirname, '../../packages/ui/src/styles/tokens.css'),
  'utf8',
);

/** Token name → [light, dark] colour. */
const themed = new Map<string, [string, string]>();
for (const match of tokensCss.matchAll(
  /--([\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi,
)) {
  themed.set(match[1] as string, [match[2] as string, match[3] as string]);
}
const plain = new Map<string, string>();
for (const match of tokensCss.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
  plain.set(match[1] as string, match[2] as string);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

function token(name: string): [string, string] {
  const value = themed.get(name);
  if (!value) throw new Error(`Token --${name} not found in tokens.css`);
  return value;
}

const TEXT = 4.5;
const UI = 3;

// [foreground, background, minimum ratio]
const PAIRS: [string, string, number][] = [
  ...['bg', 'surface', 'surface-sunken'].flatMap((bg): [string, string, number][] => [
    ['text', bg, TEXT],
    ['text-muted', bg, TEXT],
    ['focus', bg, UI],
  ]),
  ['accent', 'bg', TEXT],
  ['accent', 'surface', TEXT],
  ['accent-hover', 'bg', TEXT],
  ['accent-hover', 'surface', TEXT],
  ['on-accent', 'accent', TEXT],
  ['on-accent', 'accent-hover', TEXT],
  ['on-danger', 'danger', TEXT],
  ['on-danger', 'danger-hover', TEXT],
  ['danger', 'bg', TEXT],
  ['danger', 'surface', TEXT],
  // Calendar's days off, on a day being hovered.
  ['danger', 'surface-sunken', TEXT],
  ['danger', 'danger-soft', TEXT],
  ['text', 'danger-soft', TEXT],
  ['text', 'accent-soft', TEXT],
  ['border-strong', 'bg', UI],
  ['border-strong', 'surface', UI],
];

describe('design token contrast', () => {
  it('found the tokens', () => {
    expect(themed.size).toBeGreaterThan(15);
  });

  for (const [themeIndex, theme] of ['light', 'dark'].entries()) {
    it.each(PAIRS)(`${theme}: --color-%s on --color-%s is at least %d:1`, (fg, bg, minimum) => {
      const ratio = contrast(
        token(`color-${fg}`)[themeIndex] as string,
        token(`color-${bg}`)[themeIndex] as string,
      );
      expect(ratio).toBeGreaterThanOrEqual(minimum);
    });
  }

  it.each(Object.entries(iconColors))('white on the %s app icon is at least 4.5:1', (name, hex) => {
    expect(contrast('#ffffff', hex)).toBeGreaterThanOrEqual(TEXT);
    // colors.ts must match tokens.css.
    expect(plain.get(`icon-${name}`)).toBe(hex);
  });

  it('QR codes are black on white in both themes', () => {
    expect(contrast(plain.get('qr-dark') as string, plain.get('qr-light') as string)).toBe(21);
  });

  it('page background colours match tokens.css', () => {
    expect(token('color-bg')).toEqual([backgroundColors.light, backgroundColors.dark]);
  });
});
