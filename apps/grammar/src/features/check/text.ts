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
 * What tells a mistake apart, while its words and the text right around them stay the same:
 * Ignore hides it until they change, wherever they move in the text.
 */
export function ignoreKey(text: string, mistake: Mistake): string {
  const around = 12;
  return JSON.stringify([
    mistake.kind,
    mistake.message,
    text.slice(Math.max(0, mistake.start - around), mistake.start),
    text.slice(mistake.start, mistake.end),
    text.slice(mistake.end, mistake.end + around),
  ]);
}
