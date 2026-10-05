import { WORDS } from "./words.ts";

/** A source of random bytes. Tests pass their own; everything else uses `crypto.getRandomValues`. */
export type RandomBytes = (length: number) => Uint8Array;

const randomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** The words of a generated passphrase: six, of 11 bits each, so 66 bits (backup format §3.1). */
export const PASSPHRASE_WORDS = 6;

/** The fewest characters of a passphrase that the user picks (backup format §3.1). */
export const MIN_PASSPHRASE_LENGTH = 12;

const BITS_PER_WORD = 11;

/**
 * A new passphrase (backup format §3.1): six words of the 2,048 in `WORDS`, joined by hyphens.
 * Each word takes 11 random bits, so that every word is equally likely.
 */
export function generatePassphrase(random: RandomBytes = randomBytes): string {
  const length = Math.ceil((PASSPHRASE_WORDS * BITS_PER_WORD) / 8);
  const bytes = random(length);
  if (bytes.length !== length) {
    throw new TypeError(`A passphrase needs ${length} random bytes.`);
  }
  const words: string[] = [];
  let bits = 0;
  let count = 0;
  let next = 0;
  while (words.length < PASSPHRASE_WORDS) {
    while (count < BITS_PER_WORD) {
      bits = (bits << 8) | (bytes[next] ?? 0);
      next += 1;
      count += 8;
    }
    count -= BITS_PER_WORD;
    words.push(WORDS[bits >> count] ?? "");
    bits &= (1 << count) - 1;
  }
  return words.join("-");
}

/**
 * A passphrase as encryption uses it: in Unicode NFC, so that the same passphrase typed on
 * different devices gives the same bytes. Nothing else changes; spaces count (§3.1).
 */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize("NFC");
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Whether a passphrase that the user picks is long enough: 12 characters or more, counted as
 * people see them, so that an emoji or a letter with an accent counts once.
 */
export function isLongEnough(passphrase: string): boolean {
  let count = 0;
  for (const _ of graphemes.segment(normalizePassphrase(passphrase))) {
    count += 1;
  }
  return count >= MIN_PASSPHRASE_LENGTH;
}
