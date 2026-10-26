/**
 * Deep check, step 4: turns a sentence's corrected words into changes to the
 * text, such as "a" → "an", "Add “to”" or "Remove “the”". Words are compared
 * one by one (the longest common sequence), and each run of different words
 * becomes a change (one per word when the same number of words changed).
 * Only the changed words are touched: the person's own spacing, line breaks
 * and curly apostrophes stay as they are.
 */
import type { Sentence, Word } from './sentences.ts';

export interface Change {
  /** Where the change is in the text (UTF-16 positions). */
  start: number;
  end: number;
  /** The text there now, and what it becomes. */
  before: string;
  after: string;
}

/**
 * Written without a space before them: punctuation, closing quotes, "n't",
 * "'s", also with a curly apostrophe ("n’t", "’s"), as they are in a
 * sentence that has one (audit 3 F3-5).
 */
const NO_SPACE_BEFORE = /^(?:[.,!?;:%…)\]}”’»-]|\.{2,}|n['’]t|['’](?:s|re|ve|ll|d|m)|')$/i;
/** Written without a space after them: opening brackets and quotes, currency, hyphens. */
const NO_SPACE_AFTER = /^[([{“‘«$£€#¿¡-]$/;

const joinsLeft = (word: string | undefined) => word !== undefined && NO_SPACE_BEFORE.test(word);
const joinsRight = (word: string | undefined) => word !== undefined && NO_SPACE_AFTER.test(word);

/** Pairs of positions [original, corrected] of words that stay (longest common sequence). */
export function keptWords(a: readonly string[], b: readonly string[]): [number, number][] {
  // lengths[i][j]: how many words a[i…] and b[j…] have in common.
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  const at = (i: number, j: number) => lengths[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      (lengths[i] as number[])[j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/** Words written out with normal spacing: "do" "n't" → "don't", "Hello" "," → "Hello,". */
export function written(words: readonly string[]): string {
  return words.reduce((text, word, index) => {
    const space = index > 0 && !joinsLeft(word) && !joinsRight(words[index - 1]);
    return `${text}${space ? ' ' : ''}${word}`;
  }, '');
}

/** One run of words to change: the words now (maybe none) and the new ones (maybe none). */
interface Run {
  removed: Word[];
  added: string[];
  /** The unchanged words either side, if any. */
  previous: Word | undefined;
  next: Word | undefined;
}

/** Runs of different words between the words that stay. */
function runs(words: readonly Word[], corrected: readonly string[]): Run[] {
  const found: Run[] = [];
  const anchors = keptWords(
    words.map((word) => word.model),
    corrected,
  );
  let i = 0;
  let j = 0;
  for (const [nextI, nextJ] of [...anchors, [words.length, corrected.length]]) {
    if (nextI === undefined || nextJ === undefined) continue;
    const removed = words.slice(i, nextI);
    const added = corrected.slice(j, nextJ);
    if (removed.length === added.length) {
      // Same number of words: one change per word ("has a" → "have an" is two).
      removed.forEach((word, index) => {
        const replacement = added[index] ?? '';
        if (word.model === replacement) return;
        found.push({
          removed: [word],
          added: [replacement],
          previous: words[i + index - 1],
          next: words[i + index + 1],
        });
      });
    } else {
      found.push({ removed, added, previous: words[i - 1], next: words[nextI] });
    }
    i = nextI + 1;
    j = nextJ + 1;
  }
  return found;
}

/**
 * The changes that turn `sentence` (in `text`) into the `corrected` words.
 * New apostrophes are curly if the sentence already uses curly ones.
 */
export function sentenceChanges(
  text: string,
  sentence: Sentence,
  corrected: readonly string[],
): Change[] {
  const curly = text.slice(sentence.start, sentence.end).includes('’');
  const style = (word: string) => (curly ? word.replace(/'/g, '’') : word);
  /** Only spaces (at least one) between two positions. */
  const spaced = (from: number | undefined, to: number | undefined) =>
    from !== undefined && to !== undefined && from < to && text.slice(from, to).trim() === '';

  const changes: Change[] = [];
  for (const { removed, added: addedModel, previous, next } of runs(sentence.words, corrected)) {
    const added = addedModel.map(style);
    const first = removed[0];
    const last = removed.at(-1);
    let start: number;
    let end: number;
    let after = written(added);

    if (first && last) {
      start = first.start;
      end = last.end;
      const spaceBefore = spaced(previous?.end, first.start);
      const spaceAfter = spaced(last.end, next?.start);
      if (added.length === 0) {
        // Removing words: also remove one space next to them.
        if (previous && spaceBefore && (spaceAfter || !next || joinsLeft(next.model))) {
          start = previous.end;
        } else if (
          next &&
          spaceAfter &&
          (!previous || (!spaceBefore && joinsRight(previous.model)))
        ) {
          // At the start, or just after "(" or an opening quote: the space after goes.
          end = next.start;
        } else if (
          previous &&
          next &&
          !spaceBefore &&
          !spaceAfter &&
          !joinsRight(previous.model) &&
          !joinsLeft(next.model)
        ) {
          // It was all that joined two words ("well-known" → "well known").
          after = ' ';
        }
      } else {
        if (previous && spaceBefore && joinsLeft(added[0])) start = previous.end;
        if (previous && !spaceBefore && !joinsLeft(added[0]) && !joinsRight(previous.model)) {
          after = ` ${after}`;
        }
        if (next && !spaceAfter && !joinsRight(added.at(-1)) && !joinsLeft(next.model)) {
          after = `${after} `;
        }
      }
    } else if (previous && (joinsLeft(added[0]) || !joinsRight(previous.model))) {
      // Adding words after `previous`.
      start = end = previous.end;
      if (!joinsLeft(added[0])) after = ` ${after}`;
      if (
        next &&
        !spaced(previous.end, next.start) &&
        !joinsRight(added.at(-1)) &&
        !joinsLeft(next.model)
      ) {
        after = `${after} `;
      }
    } else if (next) {
      // Adding words before `next` (at the start of the sentence, or after "(").
      start = end = next.start;
      if (!joinsRight(added.at(-1)) && !joinsLeft(next.model)) after = `${after} `;
    } else {
      continue;
    }

    const before = text.slice(start, end);
    if (before !== after) changes.push({ start, end, before, after });
  }
  return changes;
}

/** The text with one change made. */
export const applyChange = (text: string, change: Change): string =>
  text.slice(0, change.start) + change.after + text.slice(change.end);

/** The other changes, moved to where they are once `done` is made (overlapping ones dropped). */
export function remainingAfter<T extends Change>(changes: readonly T[], done: Change): T[] {
  const shift = done.after.length - (done.end - done.start);
  return changes
    .filter((change) => change !== done && (change.end <= done.start || change.start >= done.end))
    .map((change) =>
      change.start >= done.end && change.end > done.start
        ? { ...change, start: change.start + shift, end: change.end + shift }
        : change,
    );
}

/** The text with every change made (they don't overlap). */
export function applyAll(text: string, changes: readonly Change[]): string {
  return [...changes]
    .sort((a, b) => b.start - a.start)
    .reduce((result, change) => applyChange(result, change), text);
}

const quoted = (text: string) => `“${text.trim()}”`;

/** "Change “a” to “an”", "Add “to”", "Remove “the”". */
export function changeLabel(change: Pick<Change, 'before' | 'after'>): string {
  if (change.before.trim() === '') return `Add ${quoted(change.after)}`;
  if (change.after.trim() === '') return `Remove ${quoted(change.before)}`;
  return `Change ${quoted(change.before)} to ${quoted(change.after)}`;
}

/** What accepting did, for screen readers: "Changed “a” to “an”." */
export function changeDone(change: Pick<Change, 'before' | 'after'>): string {
  if (change.before.trim() === '') return `Added ${quoted(change.after)}.`;
  if (change.after.trim() === '') return `Removed ${quoted(change.before)}.`;
  return `Changed ${quoted(change.before)} to ${quoted(change.after)}.`;
}

/** "No changes suggested.", "1 change suggested.", "3 changes suggested." */
export function changesSummary(count: number): string {
  if (count === 0) return 'No changes suggested.';
  return count === 1 ? '1 change suggested.' : `${count} changes suggested.`;
}
