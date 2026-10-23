/**
 * Comparing text people typed, for sorting lists. One shared Intl.Collator:
 * making one for each comparison, as `localeCompare` with options does, is
 * about 30 times slower on a long list.
 */

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Alphabetical order, without minding case or accents ("Item 2" before "item 10"). */
export const compareText = (a: string, b: string): number => collator.compare(a, b);
