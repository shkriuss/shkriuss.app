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
 * marks U+0300 to U+036F, once letters and accents are split by NFKD). In
 * scripts like Hindi, Bengali, Tamil and Thai the vowel signs are marks
 * too, but they're letters: "चीनी" (sugar) and "चना" (chickpeas) stay
 * different words. Vietnamese tone marks are in that range, so they go:
 * "Bơ" is "Bò". Lower case is the same on every device (toLowerCase, not
 * the device language's own, which makes a Turkish "I" a dotless "ı").
 *
 * NFKD also makes the wide and narrow letters that Japanese and Chinese
 * keyboards type into ordinary ones: "ＵＮＩＱＬＯ" is "uniqlo", and "ｺｰﾋｰ"
 * is "コーヒー" (audit 4 F3-6).
 */
export const foldText = (text: string): string =>
  text.normalize('NFKD').replace(ACCENTS, '').toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Characters as people see them, to cut between. Firefox before 125 can't
 * tell them apart: there, each code point is one (an emoji's two halves
 * still stay together), and this file still loads, for the apps that use it
 * only to compare text.
 */
const characters =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('en', { granularity: 'grapheme' })
    : null;

/**
 * At most this many JavaScript characters for each character as people see
 * them, on average. The longest emoji are about 14 (a family is 11, the flag
 * of Scotland 14), but one letter can carry thousands of accents (pasted
 * "Zalgo" text), and text with a limit mustn't grow without one.
 */
const MOST_PER_CHARACTER = 16;

/**
 * The start of `text`, at most `max` characters as people see them: an
 * emoji (a family, a flag or a skin tone too) or a letter with its accents
 * counts once, and is never cut in half. That's how Safari and every iPhone
 * browser count a text box's maxlength, the most any box lets in (others
 * count each JavaScript character, so they let in less). Text cut this way
 * on saving loses nothing a box let in (audit 4 F3-4), unless it's made of
 * characters far longer than any typed (MOST_PER_CHARACTER).
 */
export function cutToLength(text: string, max: number): string {
  // Never more characters than JavaScript counts: nothing to cut.
  if (text.length <= max) return text;
  const most = max * MOST_PER_CHARACTER;
  const parts = characters ? characters.segment(text) : [...text].map((segment) => ({ segment }));
  let end = 0;
  let count = 0;
  for (const { segment } of parts) {
    if (count === max || end + segment.length > most) break;
    end += segment.length;
    count += 1;
  }
  return text.slice(0, end);
}
