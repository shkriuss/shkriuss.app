/**
 * Parts of the page loaded with import() after the page itself (the task
 * form and the list editor), the way Repairs' forms are: opening the page
 * then loads less, and stays within its size budget (audit 5 J-2).
 */
import { RELOAD_TO_UPDATE, showProblem } from '@shkriuss/ui/problem';

/** A part of the page that loads after the page itself (later()). */
export interface Later<T> {
  /** The part, once loaded. Before, it was never opened: nothing in it needs keeping up. */
  readonly now: T | null;
  /** Starts loading the part, without doing anything with it yet. */
  load(): void;
  /** Loads the part if need be, then does `act` with it (while loading, only the last asked). */
  use(act: (part: T) => void): void;
}

export function later<T>(load: () => Promise<T>): Later<T> {
  let now: T | null = null;
  let loading: Promise<void> | null = null;
  let next: ((part: T) => void) | null = null;
  const start = (): void => {
    loading ??= load().then(
      (part) => {
        now = part;
        next?.(part);
        next = null;
      },
      () => {
        // The next tap tries again. Said only when a tap is waiting for it:
        // after an update while the page stayed open, its old file is gone.
        loading = null;
        if (next === null) return;
        next = null;
        showProblem(`Tasks couldn’t open that. ${RELOAD_TO_UPDATE}`);
      },
    );
  };
  return {
    get now() {
      return now;
    },
    load: start,
    use(act) {
      if (now) {
        act(now);
        return;
      }
      next = act;
      start();
    },
  };
}

/** Runs `task` once the page has nothing else to do (soon after it opened). */
export function whenIdle(task: () => void): void {
  // Safari has no requestIdleCallback: a moment after loading will do.
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: 2000 });
  } else window.setTimeout(task, 500);
}
