import type { AppUpdates } from "@shkriuss/pwa";
import type { Mistake, Variety } from "./protocol.ts";

/** Checks texts: the mistakes in `text` in `variety`, or a rejection if the check failed. */
export type Check = (text: string, variety: Variety) => Promise<readonly Mistake[]>;

/**
 * Where the checker stands: `starting` until it has checked its first text, then `ready`, or
 * `failed` if it could not start, as in a browser without WebAssembly.
 */
export type CheckerState = "starting" | "ready" | "failed";

/** The page's checker, for React's `useSyncExternalStore(checker.subscribe, checker.getState)`. */
export interface Checker {
  readonly getState: () => CheckerState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * The mistakes in `text` in `variety`; rejects if the checker failed or has not started, or if
   * a newer check took its place before it began.
   */
  readonly check: Check;
}

/**
 * `check`, one text at a time, as the worker checks them. Of the texts that come meanwhile, only
 * the latest waits; each takes the place of the one before, which rejects. The screen asks again
 * each time the text changes and wants only the answer about the text as it is, so the worker
 * skips the texts that changed before it could begin them.
 */
function oneAtATime(check: Check): Check {
  let running = false;
  // The latest text that waits, to check once the worker is free, or to skip.
  let waiting: { readonly run: () => void; readonly skip: () => void } | undefined;

  async function run(text: string, variety: Variety): Promise<readonly Mistake[]> {
    running = true;
    try {
      return await check(text, variety);
    } finally {
      running = false;
      const next = waiting;
      waiting = undefined;
      next?.run();
    }
  }

  return async (text, variety) => {
    if (!running) {
      return run(text, variety);
    }
    return new Promise((resolve, reject) => {
      waiting?.skip();
      waiting = {
        run: () => {
          run(text, variety).then(resolve, reject);
        },
        skip: () => {
          reject(new Error("A newer check took its place."));
        },
      };
    });
  };
}

/**
 * The page's checker (docs/specs/apps/grammar.md §1). It starts once the service worker keeps
 * the app for offline use, so that the module, 8 MB to download, comes once, then from that
 * copy: at once if a version of the app is active already, or once the page knows that it has
 * no service worker, as in a private window that refuses one. `start` starts the worker, as `startWorkerCheck()` does. The
 * first check, of an empty text, tells when the checker is ready.
 */
export function createChecker(updates: AppUpdates, start: () => Check): Checker {
  const listeners = new Set<() => void>();
  let state: CheckerState = "starting";
  let check: Check | undefined;

  function settle(next: CheckerState): void {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  function startOnce(): void {
    const kept = updates.getState();
    if (check !== undefined || kept === "starting" || kept === "installing") {
      return;
    }
    stopFollowing();
    try {
      check = oneAtATime(start());
    } catch {
      settle("failed");
      return;
    }
    void firstCheck(check);
  }

  async function firstCheck(started: Check): Promise<void> {
    try {
      await started("", "american");
      settle("ready");
    } catch {
      settle("failed");
    }
  }

  const stopFollowing = updates.subscribe(startOnce);
  startOnce();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: async (text, variety) => {
      if (check === undefined || state === "failed") {
        throw new Error("The checker is not running.");
      }
      return check(text, variety);
    },
  };
}
