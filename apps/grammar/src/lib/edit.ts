/**
 * A fix, or Deep check's changes, are made in the text box as one edit, like
 * typing or pasting, so the browser's Undo can take them back (audit G-14).
 * This finds the part of the text that changes: what's the same at the start
 * and at the end stays, and the rest is replaced in one go, however many
 * changes are in it (so one Undo takes back "Accept all").
 */

/** Replace `start` to `end` (UTF-16 positions in the old text) with `text`. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * The smallest edit that turns `before` into `after`. It never ends inside a
 * character written with two UTF-16 units (like most emoji), so it never
 * selects half of one.
 */
export function editBetween(before: string, after: string): Edit {
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before[start] === after[start]) start += 1;
  /** How much is the same at the end. */
  let same = 0;
  while (
    same < shortest - start &&
    before[before.length - 1 - same] === after[after.length - 1 - same]
  ) {
    same += 1;
  }
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start -= 1;
  if (same > 0 && isLowSurrogate(before.charCodeAt(before.length - same))) same -= 1;
  return { start, end: before.length - same, text: after.slice(start, after.length - same) };
}
