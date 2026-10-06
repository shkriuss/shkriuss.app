import { describe, expect, it } from "vitest";
import { samePassphrase } from "./passphrases.ts";

describe("a passphrase that the user types twice", () => {
  it("must be typed the same way twice; spaces count", () => {
    expect(samePassphrase("a long passphrase", "a long passphrase")).toBe(true);
    expect(samePassphrase("a long passphrase", "a long passphrase ")).toBe(false);
    expect(samePassphrase("a long passphrase", "A long passphrase")).toBe(false);
    expect(samePassphrase("a long passphrase", "")).toBe(false);
  });

  it("matches when only the Unicode form of its letters differs, as encryption sees it", () => {
    // "é" as one code point, and as "e" with a combining accent.
    expect(samePassphrase("caf\u00e9 au lait!", "cafe\u0301 au lait!")).toBe(true);
  });
});
