/**
 * Long lists stay fast (audit finding J-1): drawing thousands of rows at
 * every change, or at every key typed in Search, freezes a phone for
 * seconds. So a list shows a page of items at first, "Show more" adds the
 * next page, and Search waits for a pause in the typing.
 */

/** Items shown at first, and added by each "Show more". */
export const PAGE_SIZE = 100;

/** Search shows its results this long after the last key press. */
export const SEARCH_DELAY_MS = 150;

/**
 * How many of `ids` (in the order shown) to show: at least `shown`, and
 * enough to include each id in `keep` that's in the list: say one just
 * added, saved or moved, so it never vanishes from under the person.
 */
export function shownCount(
  ids: readonly string[],
  shown: number,
  keep: readonly (string | null | undefined)[] = [],
): number {
  let count = shown;
  for (const id of keep) {
    if (!id) continue;
    const index = ids.indexOf(id);
    if (index >= count) count = index + 1;
  }
  return count;
}

/** What waitForTyping() returns: call it at each key press. */
export interface Typing {
  (): void;
  /** Runs it now if it's waiting (say, before something else needs the search). */
  flush(): void;
  /** Forgets a run that's waiting. */
  cancel(): void;
}

/** Runs `run` once typing pauses for `ms`, rather than at every key press. */
export function waitForTyping(run: () => void, ms = SEARCH_DELAY_MS): Typing {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const typed = (() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, ms);
  }) as Typing;
  typed.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    run();
  };
  typed.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return typed;
}
