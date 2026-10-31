/**
 * The words for problems, the same in every app (scripts/problem.ts shows
 * them). Kept apart from the page so they can be tested on their own.
 */
import type { SaveProblem, StoreStatus } from '@shkriuss/storage';

/** What to tell the person when saving didn't work, for each reason. */
const SAVE_PROBLEMS: Record<SaveProblem, string> = {
  unavailable: 'Couldn’t save. Is this browser in private mode, or is storage blocked?',
  full: 'Couldn’t save: there’s no room left for this app’s data in this browser. Delete something you don’t need, then try again.',
  newer:
    'Couldn’t save, so as not to replace what a newer version of this app saved. Reload the page to get the newer version.',
  unreadable:
    'Couldn’t save, so as not to replace saved data this version of the app can’t read. Reload the page to get the latest version.',
  invalid: 'Couldn’t save: something went wrong. Please try again.',
};

/** Every message saving can give, to recognise one (say, to take it away once saving works). */
export const SAVE_PROBLEM_TEXTS: readonly string[] = Object.values(SAVE_PROBLEMS);

export function saveProblemText(problem: SaveProblem): string {
  return SAVE_PROBLEMS[problem];
}

/** Why what's saved can't be shown: a store's status that isn't "ok" or "empty". */
export type LoadProblem = Extract<StoreStatus, 'newer' | 'unreadable'>;

/**
 * What to tell the person when what's saved can't be shown, so the app
 * doesn't just look empty, and a backup isn't restored over the newer data
 * (reportLoad in ../scripts/problem.ts, audit 5 E-3).
 */
const LOAD_PROBLEMS: Record<LoadProblem, string> = {
  newer:
    'Your data here was saved by a newer version of this app, so this version can’t show it yet. It isn’t lost: reload the page to get the newer version, or wait for the next update. Restoring a backup now would replace it.',
  unreadable:
    'Your data here can’t be read by this version of the app, so it isn’t shown. Reload the page to get the latest version. If that doesn’t help, you can restore a backup under Your data.',
};

export function loadProblemText(problem: LoadProblem): string {
  return LOAD_PROBLEMS[problem];
}

/** A field's error as it's read out, with the field's name first: "Name: Enter a name." */
export function spokenFieldProblem(label: string | null | undefined, message: string): string {
  const name = (label ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:：]$/, '');
  const text = message.replace(/\s+/g, ' ').trim();
  return name ? `${name}: ${text}` : text;
}
