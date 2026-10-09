import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  MIN_DIFFERENT_CHARACTERS,
  MIN_PASSPHRASE_LENGTH,
  PASSPHRASE_WORDS,
  generatePassphrase,
  isEasyToGuess,
  isLongEnough,
  normalizePassphrase,
} from "./passphrase.ts";
import { WORDS } from "./words.ts";

/** Random bytes that are always `bytes`. */
function fixed(bytes: readonly number[]): (length: number) => Uint8Array {
  return (length) => Uint8Array.from(bytes.slice(0, length));
}

/** The 11-bit numbers that a passphrase's words stand for. */
function indexes(passphrase: string): number[] {
  return passphrase.split("-").map((word) => WORDS.indexOf(word));
}

describe("generatePassphrase (backup format §3.1)", () => {
  it("joins six words with hyphens", () => {
    const passphrase = generatePassphrase();
    expect(passphrase.split("-")).toHaveLength(PASSPHRASE_WORDS);
    expect(indexes(passphrase).every((index) => index >= 0)).toBe(true);
    expect(generatePassphrase()).not.toBe(passphrase);
  });

  it("takes 11 bits for each word, the first bits first", () => {
    expect(generatePassphrase(fixed(Array.from({ length: 9 }, () => 0)))).toBe(
      "abandon-abandon-abandon-abandon-abandon-abandon",
    );
    expect(generatePassphrase(fixed(Array.from({ length: 9 }, () => 0xff)))).toBe(
      "zoo-zoo-zoo-zoo-zoo-zoo",
    );
    // 00000000001 00000000010 00000000011 00000000100 00000000101 00000000110, and 6 unused bits.
    const bytes = [0x00, 0x20, 0x08, 0x01, 0x80, 0x40, 0x0a, 0x01, 0x80];
    expect(indexes(generatePassphrase(fixed(bytes)))).toStrictEqual([1, 2, 3, 4, 5, 6]);
  });

  it("uses all 66 random bits and nothing else, so every word is equally likely", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 9, maxLength: 9 }), (bytes) => {
        const bits = Array.from(bytes, (byte) => byte.toString(2).padStart(8, "0")).join("");
        const expected = Array.from({ length: PASSPHRASE_WORDS }, (_, word) =>
          Number.parseInt(bits.slice(word * 11, word * 11 + 11), 2),
        );
        expect(indexes(generatePassphrase(() => bytes))).toStrictEqual(expected);
      }),
    );
  });

  it("refuses too few random bytes", () => {
    expect(() => generatePassphrase(fixed([1, 2, 3]))).toThrow(TypeError);
  });
});

describe("normalizePassphrase (backup format §3.1)", () => {
  it("composes characters, so that each passphrase has one form, and keeps everything else", () => {
    const decomposed = String.fromCodePoint(0x63, 0x61, 0x66, 0x65, 0x301);
    const composed = String.fromCodePoint(0x63, 0x61, 0x66, 0xe9);
    expect(normalizePassphrase(decomposed)).toBe(composed);
    expect(normalizePassphrase(` ${composed}  Tea `)).toBe(` ${composed}  Tea `);
  });
});

describe("isLongEnough (backup format §3.1)", () => {
  it("wants at least 12 characters", () => {
    expect(MIN_PASSPHRASE_LENGTH).toBe(12);
    expect(isLongEnough("x".repeat(11))).toBe(false);
    expect(isLongEnough("x".repeat(12))).toBe(true);
    expect(isLongEnough(generatePassphrase())).toBe(true);
  });

  it("counts characters as people see them", () => {
    const accented = String.fromCodePoint(0x65, 0x301);
    const family = String.fromCodePoint(0x1f469, 0x200d, 0x1f467);
    expect(isLongEnough(accented.repeat(11))).toBe(false);
    expect(isLongEnough(accented.repeat(12))).toBe(true);
    expect(isLongEnough(family.repeat(11))).toBe(false);
    expect(isLongEnough(`${family.repeat(11)}x`)).toBe(true);
  });
});

describe("isEasyToGuess (backup format §3.1)", () => {
  it("refuses what the audit found: blanks, one letter over and over, and the digits", () => {
    expect(isEasyToGuess(" ".repeat(12))).toBe(true);
    expect(isEasyToGuess("aaaaaaaaaaaa")).toBe(true);
    expect(isEasyToGuess("123456789012")).toBe(true);
  });

  it("accepts passphrases that people make up, and generated ones", () => {
    expect(isEasyToGuess("correct horse battery staple")).toBe(false);
    expect(isEasyToGuess("vivid lantern orbits quietly")).toBe(false);
    expect(isEasyToGuess("Mein Hund heißt Bello!")).toBe(false);
    expect(isEasyToGuess("burst-swarm-slender-curve-ability-various")).toBe(false);
    expect(isEasyToGuess(generatePassphrase())).toBe(false);
  });

  it(`wants ${MIN_DIFFERENT_CHARACTERS} different characters, ignoring case and spaces`, () => {
    expect(MIN_DIFFERENT_CHARACTERS).toBe(5);
    expect(isEasyToGuess("abcd dcba abcd")).toBe(true);
    expect(isEasyToGuess("AbCd aBcD dDcC")).toBe(true);
    expect(isEasyToGuess("abcde edcba aa")).toBe(false);
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom("a", "B", "c", "D", " "), { minLength: 12 }),
        (parts) => {
          expect(isEasyToGuess(parts.join(""))).toBe(true);
        },
      ),
    );
  });

  it("refuses a passphrase that repeats a shorter part", () => {
    expect(isEasyToGuess("passwordpassword")).toBe(true);
    expect(isEasyToGuess("Hello world hello world")).toBe(true);
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 2, max: 5 }),
        (part, times) => {
          expect(isEasyToGuess(part.repeat(times))).toBe(true);
        },
      ),
    );
  });

  it("refuses runs along the digits, the alphabet and the keyboard, either way and around again", () => {
    for (const run of ["123456789012", "210987654321", "abcdefghijkl", "XYZABCDEFGHI"]) {
      expect(isEasyToGuess(run)).toBe(true);
    }
    for (const run of ["qwertyuiopas", "lkjhgfdsapoi", "asdf ghjk lzxc"]) {
      expect(isEasyToGuess(run)).toBe(true);
    }
    const keyboard = "qwertyuiopasdfghjklzxcvbnm";
    const backwards = "mnbvcxzlkjhgfdsapoiuytrewq";
    fc.assert(
      fc.property(
        fc.constantFrom(keyboard, backwards),
        fc.nat({ max: keyboard.length - 1 }),
        fc.integer({ min: 12, max: 40 }),
        (keys, start, length) => {
          expect(isEasyToGuess(keys.repeat(3).slice(start, start + length))).toBe(true);
        },
      ),
    );
  });

  it("refuses long passwords that people often use, in any case", () => {
    expect(isEasyToGuess("qwerty123456")).toBe(true);
    expect(isEasyToGuess("Password1234")).toBe(true);
    expect(isEasyToGuess("1QAZ 2WSX 3EDC")).toBe(true);
    expect(isEasyToGuess("qwerty1234567")).toBe(false);
  });

  it("does not change with case or spaces", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 35 }), { minLength: 12 }), (picks) => {
        const characters = picks.map((pick) => "abcdefghijklmnopqrstuvwxyz0123456789".charAt(pick));
        const spaced = characters.join(" ").toUpperCase();
        expect(isEasyToGuess(spaced)).toBe(isEasyToGuess(characters.join("")));
      }),
    );
  });
});
