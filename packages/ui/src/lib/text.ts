/**
 * Comparing text people typed: sorting lists, finding names that are the
 * same, searching. One shared Intl.Collator: making one for each comparison,
 * as `localeCompare` with options does, is about 30 times slower on a long
 * list.
 */

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Alphabetical order, without minding case or accents ("Item 2" before "item 10"). */
export const compareText = (a: string, b: string): number => collator.compare(a, b);

/**
 * Text for comparing and searching: lower case, without accents or extra
 * spaces, so "cafe" finds "Café" and "Two  words " is "two words".
 */
export const foldText = (text: string): string =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim().replace(/\s+/g, ' ');
