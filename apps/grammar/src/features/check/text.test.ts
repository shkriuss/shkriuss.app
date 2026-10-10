import { describe, expect, it } from "vitest";
import type { Mistake } from "./protocol.ts";
import { applyFix, excerptOf, ignoredBy, ignoreKey, plainMessage } from "./text.ts";

function mistake(text: string, words: string, from = 0): Mistake {
  const start = text.indexOf(words, from);
  return { kind: "Spelling", message: "Wrong.", start, end: start + words.length, fixes: [] };
}

describe("applyFix", () => {
  const text = "I has a apple.";

  it("replaces the mistake's words, removes them, or adds words after them", () => {
    expect(applyFix(text, mistake(text, "has"), { kind: "replace", text: "have" })).toBe(
      "I have a apple.",
    );
    expect(applyFix(text, mistake(text, " a"), { kind: "remove" })).toBe("I has apple.");
    expect(applyFix(text, mistake(text, "I"), { kind: "insert", text: "," })).toBe(
      "I, has a apple.",
    );
  });
});

describe("plainMessage", () => {
  it("puts what Harper marks as code in quotation marks", () => {
    expect(plainMessage("Did you mean `there`?")).toBe("Did you mean “there”?");
    expect(plainMessage("Use `it's` here, not `its`.")).toBe("Use “it's” here, not “its”.");
    expect(plainMessage("Don't use a space before a comma.")).toBe(
      "Don't use a space before a comma.",
    );
  });
});

describe("excerptOf", () => {
  it("quotes the words with the text around them, on one line", () => {
    const text = "Tea.\nI has\ta cat.";
    expect(excerptOf(text, mistake(text, "has"))).toStrictEqual({
      before: "Tea. I ",
      words: "has",
      after: " a cat.",
    });
  });

  it("cuts long text around the words at a space, and says so", () => {
    const text =
      "Once upon a time there was a cat whose name nobody knew, and teh cat lived in a big old house by the river near the town.";
    expect(excerptOf(text, mistake(text, "teh"))).toStrictEqual({
      before: "…name nobody knew, and ",
      words: "teh",
      after: " cat lived in a big old…",
    });
  });
});

describe("ignoreKey", () => {
  it("stays the same while the words and the text right around them do", () => {
    const text = "Then, at five, tea and teh cake.";
    const moved = `Coffee first. ${text}`;
    expect(ignoreKey(moved, mistake(moved, "teh"))).toBe(ignoreKey(text, mistake(text, "teh")));
    const changed = "Then, at five, tea and teh pie.";
    expect(ignoreKey(changed, mistake(changed, "teh"))).not.toBe(
      ignoreKey(text, mistake(text, "teh")),
    );
  });

  it("tells the same words apart in other places", () => {
    const text = "I saw teh dog, and later teh cat.";
    expect(ignoreKey(text, mistake(text, "teh"))).not.toBe(
      ignoreKey(text, mistake(text, "teh", 10)),
    );
  });
});

/**
 * Whether the mistake at `words` in `text` is ignored, by the mistake at `ignoredWords` in
 * `ignoredText`, which the user ignored.
 */
function ignored(ignoredText: string, ignoredWords: string, text: string, words: string) {
  const isIgnored = ignoredBy(
    new Set([ignoreKey(ignoredText, mistake(ignoredText, ignoredWords))]),
  );
  return isIgnored(text, mistake(text, words));
}

describe("ignoredBy", () => {
  it("hides the mistake while its words and the 12 characters on each side stay, wherever they move", () => {
    const text = "Once upon a time there was teh cat whose name nobody knew.";
    expect(ignored(text, "teh", text, "teh")).toBe(true);
    expect(ignored(text, "teh", `Yes. ${text}`, "teh")).toBe(true);
    // Just the 12 characters on each side left.
    expect(ignored(text, "teh", "e there was teh cat whose n", "teh")).toBe(true);
    // Fewer: the text right around the words changed.
    expect(ignored(text, "teh", "there was teh cat whose n", "teh")).toBe(false);
    expect(ignored(text, "teh", "e there was teh cat whose", "teh")).toBe(false);
    expect(ignored(text, "teh", text.replace("teh cat", "teh dog"), "teh")).toBe(false);
  });

  it("keeps a mistake at the text's start or end hidden when text comes before or after it", () => {
    // Ignored at the start, with nothing before its words; then text is put before them.
    const atStart = "Teh cat sat on the mat.";
    expect(ignored(atStart, "Teh", `Hello. ${atStart}`, "Teh")).toBe(true);
    expect(ignored(atStart, "Teh", `Hello there, you. ${atStart}`, "Teh")).toBe(true);
    // Ignored near the start, with less than 12 characters before its words.
    const nearStart = "Hello. Teh cat sat on the mat.";
    expect(ignored(nearStart, "Teh", `Well, well. ${nearStart}`, "Teh")).toBe(true);
    // The text right around the words changed, or went: the mistake comes back.
    expect(ignored(nearStart, "Teh", "Hallo. Teh cat sat on the mat.", "Teh")).toBe(false);
    expect(ignored(nearStart, "Teh", atStart, "Teh")).toBe(false);
    // And at the end, with nothing after its words, then text after them.
    const atEnd = "The cat sat on teh";
    expect(ignored(atEnd, "teh", `${atEnd} mat, and slept.`, "teh")).toBe(true);
    expect(ignored(`${atEnd} mat.`, "teh", `${atEnd} mat. Then it slept.`, "teh")).toBe(true);
    expect(ignored(`${atEnd} mat.`, "teh", `${atEnd} rug.`, "teh")).toBe(false);
    expect(ignored(`${atEnd} mat.`, "teh", atEnd, "teh")).toBe(false);
  });

  it("goes by the kind, the message and the words too", () => {
    const text = "I saw teh dog.";
    const isIgnored = ignoredBy(new Set([ignoreKey(text, mistake(text, "teh"))]));
    expect(isIgnored(text, mistake(text, "teh"))).toBe(true);
    expect(isIgnored(text, { ...mistake(text, "teh"), kind: "Typo" })).toBe(false);
    expect(isIgnored(text, { ...mistake(text, "teh"), message: "Another." })).toBe(false);
    expect(isIgnored(text, mistake(text, "teh dog"))).toBe(false);
    expect(ignoredBy(new Set())(text, mistake(text, "teh"))).toBe(false);
  });
});
