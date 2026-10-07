import { SuggestionKind } from "harper.js";
import type { Fix, Mistake } from "./protocol.ts";

/** What the checker reads of a suggestion of harper.js. */
export interface SuggestionLike {
  kind(): SuggestionKind;
  get_replacement_text(): string;
}

/** What the checker reads of a lint of harper.js: a mistake that Harper found. */
export interface LintLike {
  lint_kind(): string;
  message(): string;
  /** Where the mistake's words are, as offsets in the text's string. */
  span(): { readonly start: number; readonly end: number };
  suggestions(): readonly SuggestionLike[];
}

/**
 * A suggestion for a mistake's `words` as a fix that the page applies, or none if it would
 * change nothing, or if the page does not know its kind.
 */
function fixOf(suggestion: SuggestionLike, words: string): Fix | undefined {
  const text = suggestion.get_replacement_text();
  switch (suggestion.kind()) {
    case SuggestionKind.Replace:
      if (text === words) {
        return undefined;
      }
      // A replacement by nothing removes the words.
      return text === "" ? { kind: "remove" } : { kind: "replace", text };
    case SuggestionKind.Remove:
      return { kind: "remove" };
    case SuggestionKind.InsertAfter:
      return text === "" ? undefined : { kind: "insert", text };
    default:
      return undefined;
  }
}

/**
 * The mistakes that Harper found in `text`, in its order, each with its fixes once: Harper may
 * suggest the same words twice.
 */
export function mistakesOf(text: string, lints: readonly LintLike[]): Mistake[] {
  const mistakes = lints.map((lint): Mistake => {
    const { start, end } = lint.span();
    const words = text.slice(start, end);
    const fixes = new Map<string, Fix>();
    for (const suggestion of lint.suggestions()) {
      const fix = fixOf(suggestion, words);
      if (fix !== undefined) {
        const key = JSON.stringify(fix);
        if (!fixes.has(key)) {
          fixes.set(key, fix);
        }
      }
    }
    return {
      kind: lint.lint_kind(),
      message: lint.message(),
      start,
      end,
      fixes: [...fixes.values()],
    };
  });
  return mistakes.toSorted((a, b) => a.start - b.start || a.end - b.end);
}
