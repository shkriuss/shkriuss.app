import { describe, expect, it } from "vitest";
import type { Mistake } from "./protocol.ts";
import { applyFix, excerptOf, ignoreKey, plainMessage } from "./text.ts";

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
