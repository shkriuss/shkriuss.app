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
 * What people do not see in a passphrase: white space, and format characters such as a
 * zero-width space or joiner, which hide in a passphrase and add nothing to guessing it.
 */
const INVISIBLE = /[\p{White_Space}\p{Cf}]/gu;

/**
 * The characters of a passphrase as people see them (backup format §3.1): its graphemes, so that
 * an emoji or a letter with an accent counts once, without white space and format characters. A
 * zero-width joiner inside an emoji, such as a family, goes with its grapheme, which stays one
 * character; one between letters attaches to the letter before it, which stays that letter.
 */
function visibleCharacters(passphrase: string): string[] {
  return Array.from(graphemes.segment(passphrase), ({ segment }) =>
    segment.replace(INVISIBLE, ""),
  ).filter((character) => character !== "");
}

/**
 * Whether a passphrase that the user picks is long enough: 12 characters or more, counted as
 * people see them, so that an emoji or a letter with an accent counts once, and spaces,
 * zero-width and other invisible characters do not count (backup format §3.1).
 */
export function isLongEnough(passphrase: string): boolean {
  return visibleCharacters(normalizePassphrase(passphrase)).length >= MIN_PASSPHRASE_LENGTH;
}

/**
 * The fewest different characters of a passphrase that the user picks, ignoring case, spaces
 * and invisible characters (backup format §3.1).
 */
export const MIN_DIFFERENT_CHARACTERS = 5;

/** What people type along: the digits, the alphabet, and the keyboard's letters, row by row. */
const RUNS = ["0123456789", "abcdefghijklmnopqrstuvwxyz", "qwertyuiopasdfghjklzxcvbnm"];

/**
 * Long passwords that people often use, which the other rules of §3.1 let through: mostly
 * runs along the keyboard with digits, by rows or by columns.
 */
const COMMON: ReadonlySet<string> = new Set([
  "123456qwerty",
  "123qweasdzxc",
  "1q2w3e4r5t6y",
  "1qaz2wsx3edc",
  "1qazxsw23edc",
  "a1b2c3d4e5f6",
  "abcd12345678",
  "administrator",
  "iloveyou1234",
  "passw0rd1234",
  "password1234",
  "password12345",
  "password123456",
  "q1w2e3r4t5y6",
  "qazwsxedcrfv",
  "qwer1234asdf",
  "qwerty123456",
  "qwertyuiop123",
  "zaq12wsxcde3",
  "zxcvbnm12345",
]);

/** Whether `text` follows `run`, from any place in it and around again. */
function runsAlong(text: string, run: string): boolean {
  return run.repeat(Math.ceil(text.length / run.length) + 1).includes(text);
}

/**
 * Whether a passphrase that the user picks is easy to guess (backup format §3.1). Ignoring case,
 * spaces and invisible characters, it is when it has fewer than 5 different characters, repeats
 * a shorter part, runs along the digits, the alphabet or the keyboard, or is a long password
 * that people often use.
 */
export function isEasyToGuess(passphrase: string): boolean {
  const characters = visibleCharacters(normalizePassphrase(passphrase).toLowerCase());
  const text = characters.join("");
  const backwards = characters.toReversed().join("");
  return (
    new Set(characters).size < MIN_DIFFERENT_CHARACTERS ||
    // A text that repeats a shorter part is found in itself twice over before its own length.
    `${text}${text}`.indexOf(text, 1) < text.length ||
    RUNS.some((run) => runsAlong(text, run) || runsAlong(backwards, run)) ||
    COMMON.has(text)
  );
}
