/**
 * Comparing text people typed: sorting lists, finding names that are the
 * same, searching. One shared Intl.Collator: making one for each comparison,
 * as `localeCompare` with options does, is about 30 times slower on a long
 * list.
 */

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Alphabetical order, without minding case or accents ("Item 2" before "item 10"). */
export const compareText = (a: string, b: string): number => collator.compare(a, b);

/** The combining accents of Latin, Greek and Cyrillic letters (see foldText). */
const ACCENTS = /[\u0300-\u036F]/g;

/**
 * Text for comparing and searching: lower case, without accents or extra
 * spaces, so "cafe" finds "Café" and "Two  words " is "two words".
 *
 * Only the accents of Latin, Greek and Cyrillic letters go (the combining
 * marks U+0300 to U+036F, once letters and accents are split by NFD). In
 * scripts like Hindi, Bengali, Tamil and Thai the vowel signs are marks
 * too, but they're letters: "चीनी" (sugar) and "चना" (chickpeas) stay
 * different words. Vietnamese tone marks are in that range, so they go:
 * "Bơ" is "Bò". Lower case is the same on every device (toLowerCase, not
 * the device language's own, which makes a Turkish "I" a dotless "ı").
 */
export const foldText = (text: string): string =>
  text.normalize('NFD').replace(ACCENTS, '').toLowerCase().trim().replace(/\s+/g, ' ');
