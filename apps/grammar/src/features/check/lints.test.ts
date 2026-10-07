import { Dialect, LocalLinter, SuggestionKind } from "harper.js";
import { slimBinaryInlined } from "harper.js/slimBinaryInlined";
import { beforeAll, describe, expect, it } from "vitest";
import { type LintLike, mistakesOf } from "./lints.ts";

/** A kind of suggestion that a later Harper may add, which numeric enums let through. */
const LATER_KIND: number = 7;

/** A lint as harper.js gives one, for the cases that Harper's own rules do not make. */
function lint(
  kind: string,
  start: number,
  end: number,
  suggestions: readonly (readonly [SuggestionKind, string])[],
): LintLike {
  return {
    lint_kind: () => kind,
    message: () => `A ${kind} mistake.`,
    span: () => ({ start, end }),
    suggestions: () =>
      suggestions.map(([suggestionKind, text]) => ({
        kind: () => suggestionKind,
        get_replacement_text: () => text,
      })),
  };
}

describe("mistakesOf", () => {
  it("gives each fix once, in Harper's order, and leaves out those that change nothing", () => {
    const text = "Their is a cat.";
    const [mistake] = mistakesOf(text, [
      lint("Grammar", 0, 5, [
        [SuggestionKind.Replace, "There"],
        [SuggestionKind.Replace, "There's"],
        [SuggestionKind.Replace, "There's"],
        [SuggestionKind.Replace, "Their"],
        [SuggestionKind.Replace, ""],
        [SuggestionKind.Remove, ""],
        [SuggestionKind.InsertAfter, ","],
        [SuggestionKind.InsertAfter, ""],
        [LATER_KIND, "unknown"],
      ]),
    ]);
    expect(mistake).toStrictEqual({
      kind: "Grammar",
      message: "A Grammar mistake.",
      start: 0,
      end: 5,
      fixes: [
        { kind: "replace", text: "There" },
        { kind: "replace", text: "There's" },
        // A replacement by nothing is a removal, which Harper also suggested.
        { kind: "remove" },
        { kind: "insert", text: "," },
      ],
    });
  });

  it("lists the mistakes in the order of the text", () => {
    const mistakes = mistakesOf("a b c", [
      lint("Spelling", 4, 5, []),
      lint("Spelling", 0, 1, []),
      lint("Typo", 0, 3, []),
    ]);
    expect(
      mistakes.map(({ kind, start, end }) => `${kind} ${String(start)}-${String(end)}`),
    ).toStrictEqual(["Spelling 0-1", "Typo 0-3", "Spelling 4-5"]);
  });
});

describe("Harper's results, as the screen shows them", () => {
  let linter: LocalLinter;

  beforeAll(async () => {
    linter = new LocalLinter({ binary: slimBinaryInlined });
    await linter.setup();
  }, 60_000);

  async function check(text: string, dialect = Dialect.American) {
    await linter.setDialect(dialect);
    return mistakesOf(text, await linter.lint(text, { language: "plaintext" }));
  }

  /** The words of the mistakes in `text`. */
  async function words(text: string, dialect: Dialect): Promise<string[]> {
    return (await check(text, dialect)).map((mistake) => text.slice(mistake.start, mistake.end));
  }

  it("finds mistakes of grammar, agreement, typos and repetition, with their words and fixes", async () => {
    const text =
      "This is an test. I has a apple, and their is a problem with teh car of the the man.";
    const mistakes = await check(text);
    expect(
      mistakes.map((mistake) => ({
        kind: mistake.kind,
        words: text.slice(mistake.start, mistake.end),
        fixes: mistake.fixes,
      })),
    ).toStrictEqual([
      { kind: "Miscellaneous", words: "an", fixes: [{ kind: "replace", text: "a" }] },
      { kind: "Agreement", words: "has", fixes: [{ kind: "replace", text: "have" }] },
      { kind: "Miscellaneous", words: "a", fixes: [{ kind: "replace", text: "an" }] },
      {
        kind: "Grammar",
        words: "their",
        // Harper suggests "there's" twice.
        fixes: [
          { kind: "replace", text: "there" },
          { kind: "replace", text: "there's" },
        ],
      },
      { kind: "Typo", words: "teh", fixes: [{ kind: "replace", text: "the" }] },
      { kind: "Repetition", words: "the the", fixes: [{ kind: "replace", text: "the" }] },
    ]);
  });

  it("finds a space before a comma, which a fix removes", async () => {
    const text = "It is a nice day , is it not?";
    const [mistake] = await check(text);
    expect(mistake).toMatchObject({ kind: "Punctuation", fixes: [{ kind: "remove" }] });
    expect(text.slice(mistake?.start, mistake?.end)).toBe(" ");
  });

  it("spells as the variety of English does", async () => {
    expect(await words("The color of the sky.", Dialect.American)).toStrictEqual([]);
    expect(await words("The color of the sky.", Dialect.British)).toStrictEqual(["color"]);
    expect(await words("The colour of the sky.", Dialect.American)).toStrictEqual(["colour"]);
    expect(await words("The colour of the sky.", Dialect.British)).toStrictEqual([]);
  });

  it("gives offsets in the text's string, as JavaScript counts it, after an emoji too", async () => {
    const text = "😀 Thsi is fine.";
    const [mistake] = await check(text);
    expect(mistake).toMatchObject({ kind: "Spelling", start: 3, end: 7 });
    expect(text.slice(mistake?.start, mistake?.end)).toBe("Thsi");
  });

  it("finds nothing in a text without mistakes, or in no text", async () => {
    expect(await check("The quick brown fox jumps over the lazy dog.")).toStrictEqual([]);
    expect(await check("")).toStrictEqual([]);
  });
});
