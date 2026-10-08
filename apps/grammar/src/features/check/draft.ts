import { m } from "../../messages.ts";
import type { Mistake, Variety } from "./protocol.ts";

/** The mistakes that the checker found in a text, in a variety. */
export interface Result {
  readonly text: string;
  readonly variety: Variety;
  readonly mistakes: readonly Mistake[];
}

/**
 * What the check screen holds (docs/specs/apps/grammar.md §1): the text, its variety, the
 * mistakes that the user ignored, what Delete took, and the last check's mistakes.
 */
export interface Draft {
  readonly text: string;
  readonly variety: Variety;
  /** The mistakes that the user ignored, by `ignoreKey()`. */
  readonly ignored: ReadonlySet<string>;
  /** The text that Delete took, which Undo brings back until the user types again. */
  readonly deleted: string | undefined;
  /** The last check's mistakes, in the text and the variety that it checked. */
  readonly result: Result | undefined;
}

/** The page's draft, for React's `useSyncExternalStore(draft.subscribe, draft.getState)`. */
export interface DraftStore {
  readonly getState: () => Draft;
  readonly subscribe: (listener: () => void) => () => void;
  /** Changes what `change` gives, keeps the rest, and tells the listeners. */
  readonly update: (change: Partial<Draft>) => void;
}

/**
 * The page's draft, in `variety` until the user picks another. It lives as long as the page, not
 * the check screen, so that the text is still there when the user comes back from the settings.
 * Nothing stores it: it goes when the page closes or reloads.
 */
export function createDraftStore(variety: Variety): DraftStore {
  let draft: Draft = {
    text: "",
    variety,
    ignored: new Set(),
    deleted: undefined,
    result: undefined,
  };
  const listeners = new Set<() => void>();
  return {
    getState: () => draft,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update: (change) => {
      draft = { ...draft, ...change };
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/** Whether the last check's mistakes are those of the text as it is, in its variety. */
export function isChecked({ text, variety, result }: Draft): boolean {
  return result !== undefined && result.text === text && result.variety === variety;
}

/**
 * What the update banner says while it offers to reload the page, which clears the text: that it
 * does, once there is text.
 */
export function reloadWarning({ text }: Draft): string | undefined {
  return text === "" ? undefined : m.reloadWarning();
}
