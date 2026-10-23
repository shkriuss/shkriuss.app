/**
 * The words for problems, the same in every app (scripts/problem.ts shows
 * them). Kept apart from the page so they can be tested on their own.
 */
import type { SaveProblem } from '@shkriuss/storage';

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

/** A field's error as it's read out, with the field's name first: "Name: Enter a name." */
export function spokenFieldProblem(label: string | null | undefined, message: string): string {
  const name = (label ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:：]$/, '');
  const text = message.replace(/\s+/g, ' ').trim();
  return name ? `${name}: ${text}` : text;
}
