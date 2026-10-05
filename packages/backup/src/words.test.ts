import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WORDS } from "./words.ts";

describe("WORDS (backup format §3.1)", () => {
  it("is the English word list of BIP-39, word for word", () => {
    const file = `${WORDS.join("\n")}\n`;
    // The SHA-256 of https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt.
    expect(createHash("sha256").update(file).digest("hex")).toBe(
      "2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda",
    );
  });

  it("has 2,048 words of 3 to 8 lowercase letters, which differ in their first four", () => {
    expect(WORDS).toHaveLength(2048);
    expect(WORDS.every((word) => /^[a-z]{3,8}$/.test(word))).toBe(true);
    expect(new Set(WORDS.map((word) => word.slice(0, 4))).size).toBe(2048);
    expect(Object.isFrozen(WORDS)).toBe(true);
  });
});
