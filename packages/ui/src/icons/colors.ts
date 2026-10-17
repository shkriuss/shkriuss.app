import type { IconColor } from '@shkriuss/registry';

/**
 * App icon background colours, as plain values for places that can't read CSS
 * variables (generated PNG icons, the web manifest). Keep these in sync with
 * the --icon-* tokens in styles/tokens.css (a unit test checks this).
 */
export const iconColors: Record<IconColor, string> = {
  teal: '#0f766e',
  blue: '#1d4ed8',
  indigo: '#4338ca',
  violet: '#6d28d9',
  pink: '#be185d',
  red: '#b91c1c',
  orange: '#c2410c',
  green: '#15803d',
  slate: '#334155',
};

/** Page background colours for each theme (used for theme-color and the manifest). */
export const backgroundColors = {
  light: '#f7f7f5',
  dark: '#111214',
} as const;
