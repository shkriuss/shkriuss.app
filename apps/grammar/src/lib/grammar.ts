/**
 * Grammar's data and rules, kept separate from the page so they're easy to
 * test. The checking itself is done by Harper (harper.js), on this device, in
 * a worker (scripts/checker.worker.ts). This file describes what it finds,
 * how a fix changes the text, and the messages between the page and the
 * worker.
 */

export type English = 'american' | 'british';
export const ENGLISHES: readonly English[] = ['american', 'british'];

/** Longest text that can be checked (about 3,000 words). */
export const MAX_TEXT_LENGTH = 20_000;
/** Suggestions listed at once (fixing them shows the next ones). */
export const MAX_SHOWN = 100;
export const MAX_WORDS = 500;
export const MAX_WORD_LENGTH = 60;
/** Fixes offered for one problem. */
const MAX_FIXES = 3;
/** Characters of text shown either side of a problem. */
const CONTEXT_LENGTH = 30;

export interface GrammarState {
  text: string;
  english: English;
  /** Words never marked as misspelled (names, jargon), as added. */
  words: string[];
}

/** British for English-speaking places other than the US; American otherwise. */
export function defaultEnglish(language: string): English {
  const [lang, region] = language.toLowerCase().split('-');
  return lang === 'en' && region !== undefined && region !== 'us' ? 'british' : 'american';
}

export const emptyState = (language = 'en-US'): GrammarState => ({
  text: '',
  english: defaultEnglish(language),
  words: [],
});

export function isGrammarState(value: unknown): value is GrammarState {
  if (typeof value !== 'object' || value === null) return false;
  const { text, english, words } = value as Record<string, unknown>;
  return (
    typeof text === 'string' &&
    ENGLISHES.includes(english as English) &&
    Array.isArray(words) &&
    words.every((word) => typeof word === 'string')
  );
}

/** One way to fix a problem. */
export interface Fix {
  kind: 'replace' | 'remove' | 'insert-after';
  /** The new text (empty when removing). */
  text: string;
}

/**
 * One problem Harper found. Positions count like JavaScript strings (UTF-16),
 * which is what harper.js gives.
 */
export interface Issue {
  /** Harper's category, e.g. "Spelling", "WordChoice". */
  kind: string;
  /** The category for people, e.g. "Word Choice". */
  label: string;
  start: number;
  end: number;
  /** The text from start to end. */
  problem: string;
  message: string;
  fixes: Fix[];
}

/** Harper writes `words` in backticks; show them in quotes instead. */
export const plainMessage = (message: string): string => message.replace(/`([^`]*)`/g, '“$1”');

/** The text with one fix made. */
export function applyFix(text: string, issue: Pick<Issue, 'start' | 'end'>, fix: Fix): string {
  const before = text.slice(0, issue.start);
  const after = text.slice(issue.end);
  if (fix.kind === 'remove') return before + after;
  if (fix.kind === 'insert-after') return text.slice(0, issue.end) + fix.text + after;
  return before + fix.text + after;
}

/** How to say a piece of text in a button: spaces aren't visible in quotes. */
function quoted(text: string): string {
  if (text === ' ') return 'a space';
  if (text.trim() === '') return 'the spaces';
  return `“${text}”`;
}

/** "Change to “an”", "Remove the space", "Add “,”". */
export function fixLabel(issue: Pick<Issue, 'problem'>, fix: Fix): string {
  if (fix.kind === 'remove') {
    return issue.problem === ' ' ? 'Remove the space' : `Remove ${quoted(issue.problem)}`;
  }
  if (fix.kind === 'insert-after') return `Add ${quoted(fix.text)}`;
  return `Change to ${quoted(fix.text)}`;
}

/** What a fix did, for screen readers: "Changed “a” to “an”." */
export function fixDone(issue: Pick<Issue, 'problem'>, fix: Fix): string {
  if (fix.kind === 'remove') {
    return issue.problem === ' ' ? 'Removed the space.' : `Removed ${quoted(issue.problem)}.`;
  }
  if (fix.kind === 'insert-after') return `Added ${quoted(fix.text)}.`;
  return `Changed ${quoted(issue.problem)} to ${quoted(fix.text)}.`;
}

/** Up to three fixes, without ones that would look the same. */
export function fixesToShow(issue: Pick<Issue, 'problem' | 'fixes'>): Fix[] {
  const seen = new Set<string>();
  return issue.fixes
    .filter((fix) => {
      const label = fixLabel(issue, { ...fix, text: fix.text.trim() || fix.text });
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .slice(0, MAX_FIXES);
}

export interface Context {
  before: string;
  problem: string;
  after: string;
}

/** The problem with a little text either side, on one line ("…I has a apple…"). */
export function contextOf(text: string, issue: Pick<Issue, 'start' | 'end'>): Context {
  const oneLine = (part: string) => part.replace(/\s+/g, ' ');
  const from = Math.max(0, issue.start - CONTEXT_LENGTH);
  const to = Math.min(text.length, issue.end + CONTEXT_LENGTH);
  return {
    before: (from > 0 ? '…' : '') + oneLine(text.slice(from, issue.start)).trimStart(),
    problem: text.slice(issue.start, issue.end),
    after: oneLine(text.slice(issue.end, to)).trimEnd() + (to < text.length ? '…' : ''),
  };
}

/** "No problems found.", "1 suggestion.", or how many are shown of how many. */
export function summary(count: number): string {
  if (count === 0) return 'No problems found.';
  if (count === 1) return '1 suggestion.';
  if (count > MAX_SHOWN) return `${count} suggestions. Showing the first ${MAX_SHOWN}.`;
  return `${count} suggestions.`;
}

/** A misspelling that could be a real word (a name, say) to add to the dictionary. */
export function wordToAdd(issue: Pick<Issue, 'kind' | 'problem'>): string | undefined {
  const word = issue.problem.trim();
  return issue.kind === 'Spelling' &&
    word.length <= MAX_WORD_LENGTH &&
    /^\p{L}[\p{L}\p{M}'’-]*$/u.test(word)
    ? word
    : undefined;
}

/** The dictionary with a word added (once), in alphabetical order. */
export function addWord(words: readonly string[], word: string): string[] {
  if (words.includes(word) || words.length >= MAX_WORDS) return [...words];
  return [...words, word].sort((a, b) => a.localeCompare(b));
}

export const removeWord = (words: readonly string[], word: string): string[] =>
  words.filter((entry) => entry !== word);

// ---------- Sync ----------

/**
 * What syncs between devices (with the optional account): the English choice
 * and the dictionary, as items with ids. The text isn't one of them, so it
 * never leaves this device.
 */
export type SyncedSetting =
  { id: 'english'; english: English } | { id: `word:${string}`; word: string };

export const syncedSettings = (state: GrammarState): SyncedSetting[] => [
  { id: 'english', english: state.english },
  ...state.words.map((word): SyncedSetting => ({ id: `word:${word}`, word })),
];

/** `state` with the settings that came back from syncing (its text stays as it is). */
export function withSyncedSettings(
  state: GrammarState,
  settings: readonly SyncedSetting[],
): GrammarState {
  let { english } = state;
  const words = new Set<string>();
  for (const setting of settings) {
    if (setting.id === 'english') {
      if (ENGLISHES.includes(setting.english)) english = setting.english;
    } else if (typeof setting.word === 'string') {
      words.add(setting.word);
    }
  }
  return { ...state, english, words: [...words].sort((a, b) => a.localeCompare(b)) };
}

/** Messages from the page to the checker (scripts/checker.worker.ts). */
export type ToChecker =
  | { type: 'start'; english: English; words: string[] }
  | { type: 'check'; id: number; text: string }
  | { type: 'english'; english: English }
  | { type: 'words'; words: string[] };

/** Messages from the checker to the page. */
export type FromChecker =
  { type: 'ready' } | { type: 'checked'; id: number; issues: Issue[] } | { type: 'failed' };
