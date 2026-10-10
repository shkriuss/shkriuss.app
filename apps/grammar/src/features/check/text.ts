import type { Fix, Mistake } from "./protocol.ts";

/**
 * `text` with `fix` applied to the words of `mistake`, which were found in it: words in their
 * place, none, or words after them.
 */
export function applyFix(text: string, mistake: Mistake, fix: Fix): string {
  const before = text.slice(0, fix.kind === "insert" ? mistake.end : mistake.start);
  return before + (fix.kind === "remove" ? "" : fix.text) + text.slice(mistake.end);
}

/** Harper's message, with what it marks as code, between backticks, in quotation marks. */
export function plainMessage(message: string): string {
  return message.replaceAll(/`([^`]*)`/g, "“$1”");
}

/** How many characters of the text around a mistake's words the list shows, at most. */
const AROUND = 24;

/** A mistake's words in the text, with some of the text before and after them. */
export interface Excerpt {
  readonly before: string;
  readonly words: string;
  readonly after: string;
}

/** One line: line breaks and tabs as spaces. */
function oneLine(text: string): string {
  return text.replaceAll(/\s/g, " ");
}

/**
 * The words of `mistake` in `text`, as the list quotes them, with up to `AROUND` characters on
 * each side, cut at a space where it can, and marked with an ellipsis where it was cut.
 */
export function excerptOf(text: string, mistake: Mistake): Excerpt {
  let before = text.slice(Math.max(0, mistake.start - AROUND), mistake.start);
  if (mistake.start > AROUND) {
    const space = before.indexOf(" ");
    before = `…${space === -1 ? before : before.slice(space + 1)}`;
  }
  let after = text.slice(mistake.end, mistake.end + AROUND);
  if (mistake.end + AROUND < text.length) {
    const space = after.lastIndexOf(" ");
    after = `${space === -1 ? after : after.slice(0, space)}…`;
  }
  return {
    before: oneLine(before),
    words: oneLine(text.slice(mistake.start, mistake.end)),
    after: oneLine(after),
  };
}

/**
 * How many characters of the text on each side of a mistake's words Ignore goes by
 * (docs/specs/apps/grammar.md §1).
 */
const AROUND_IGNORED = 12;

/**
 * What tells a mistake apart, while its words and the text right around them stay the same:
 * Ignore hides it until they change, wherever they move in the text. The key has the mistake's
 * kind, its message, up to `AROUND_IGNORED` characters before its words, the words, and up to as
 * many after: fewer only where the text starts or ends within them, which `ignoredBy()` allows
 * for.
 */
export function ignoreKey(text: string, mistake: Mistake): string {
  return JSON.stringify([
    mistake.kind,
    mistake.message,
    text.slice(Math.max(0, mistake.start - AROUND_IGNORED), mistake.start),
    text.slice(mistake.start, mistake.end),
    text.slice(mistake.end, mistake.end + AROUND_IGNORED),
  ]);
}

/** A key of `ignoreKey()`, read back. */
type IgnoreKey = readonly [
  kind: string,
  message: string,
  before: string,
  words: string,
  after: string,
];

function isIgnoreKey(value: unknown): value is IgnoreKey {
  return (
    Array.isArray(value) && value.length === 5 && value.every((part) => typeof part === "string")
  );
}

/**
 * Whether the text on one side of a mistake's words, `now`, is what a key recorded there,
 * `then`: the same, or more of it where the key's stopped short of `AROUND_IGNORED` characters,
 * as it only does at the text's start or end. Text added there since does not change what was
 * around the words; text taken away does.
 */
function sameAround(then: string, now: string, side: "before" | "after"): boolean {
  if (then.length === AROUND_IGNORED) {
    return then === now;
  }
  return side === "before" ? now.endsWith(then) : now.startsWith(then);
}

/**
 * Whether a mistake in a text is one that the user ignored, by `ignored`, keys of `ignoreKey()`:
 * one with the same kind, message and words, and the same text right around them,
 * `AROUND_IGNORED` characters on each side, or more of it where the text started or ended when
 * it was ignored.
 */
export function ignoredBy(
  ignored: ReadonlySet<string>,
): (text: string, mistake: Mistake) => boolean {
  const keys = [...ignored].flatMap((key) => {
    const value: unknown = JSON.parse(key);
    return isIgnoreKey(value) ? [value] : [];
  });
  if (keys.length === 0) {
    return () => false;
  }
  return (text, mistake) => {
    const before = text.slice(Math.max(0, mistake.start - AROUND_IGNORED), mistake.start);
    const words = text.slice(mistake.start, mistake.end);
    const after = text.slice(mistake.end, mistake.end + AROUND_IGNORED);
    return keys.some(
      ([kind, message, thenBefore, thenWords, thenAfter]) =>
        kind === mistake.kind &&
        message === mistake.message &&
        thenWords === words &&
        sameAround(thenBefore, before, "before") &&
        sameAround(thenAfter, after, "after"),
    );
  };
}
