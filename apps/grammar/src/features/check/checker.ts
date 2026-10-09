import type { AppInstall, AppUpdates } from "@shkriuss/pwa";
import type { Mistake, Variety } from "./protocol.ts";

/** Checks texts: the mistakes in `text` in `variety`, or a rejection if the check failed. */
export type Check = (text: string, variety: Variety) => Promise<readonly Mistake[]>;

/** A worker that checks texts, as `startWorkerCheck()` starts it. */
export interface RunningCheck {
  readonly check: Check;
  /** Stops the worker. */
  readonly stop: () => void;
}

/**
 * Where the checker stands:
 *
 * - `starting`: it has not checked its first text yet, which it does once it has started;
 * - `downloading`: the same, but it downloads its module first, 8 MB, which the app then keeps
 *   for offline use (ADR 0019);
 * - `ready`: it checks texts;
 * - `offline`: it could not download its module, as offline the first time; it tries again once
 *   the device is back online;
 * - `failed`: it cannot start, as in a browser without WebAssembly.
 */
export type CheckerState = "starting" | "downloading" | "ready" | "offline" | "failed";

/** The page's checker, for React's `useSyncExternalStore(checker.subscribe, checker.getState)`. */
export interface Checker {
  readonly getState: () => CheckerState;
  readonly subscribe: (listener: () => void) => () => void;
  /** There is text to check: the checker starts, if it has not, as soon as it can. */
  readonly prepare: () => void;
  /**
   * The mistakes in `text` in `variety`; rejects if the checker failed or has not started, or if
   * a newer check took its place before it began.
   */
  readonly check: Check;
}

/** What the checker uses of the page. */
export interface CheckerEnvironment {
  /** The app's service worker, which keeps the checker's module once it has come (ADR 0019). */
  readonly updates: AppUpdates;
  /** How the app runs: installed, it starts the checker as soon as it opens. */
  readonly install: Pick<AppInstall, "getState" | "subscribe">;
  /** Starts the checker's worker, as `startWorkerCheck()` does. */
  readonly start: () => RunningCheck;
  /** Calls `listener` whenever the device comes back online. */
  readonly onOnline: (listener: () => void) => void;
  /** Whether the browser has WebAssembly, without which the checker cannot start. */
  readonly webAssembly: boolean;
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
 * The page's checker (docs/specs/apps/grammar.md §1). It starts once there is text, or as soon as
 * the app opens if the app runs installed or the service worker keeps its module already, so
 * that an installed app works offline from its first opening (ADR 0019). It waits until the
 * service worker controls the page, so that the module, 8 MB to download, comes through it, which
 * checks it and keeps it; or until the page knows that it has none, as in a private window that
 * refuses one. The first check, of an empty text, tells when the checker is ready.
 */
export function createChecker(environment: CheckerEnvironment): Checker {
  const { updates, install, start, onOnline, webAssembly } = environment;
  const listeners = new Set<() => void>();
  let state: CheckerState = webAssembly ? "starting" : "failed";
  let running: RunningCheck | undefined;
  let check: Check | undefined;
  // Whether the checker should start: there is text, or the module is kept, or the app runs
  // installed.
  let wanted = false;
  // Whether the service worker keeps the module; undefined until the page knows.
  let kept: boolean | undefined;

  function settle(next: CheckerState): void {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  /** Whether the module comes from the network, which the service worker then keeps. */
  function downloads(): boolean {
    return kept === false && updates.getState() !== "unavailable";
  }

  function startOnce(): void {
    const worker = updates.getState();
    if (
      !wanted ||
      running !== undefined ||
      state === "failed" ||
      state === "offline" ||
      worker === "starting" ||
      worker === "installing"
    ) {
      return;
    }
    try {
      running = start();
    } catch {
      settle("failed");
      return;
    }
    check = oneAtATime(running.check);
    if (downloads()) {
      settle("downloading");
    }
    void firstCheck(check);
  }

  async function firstCheck(started: Check): Promise<void> {
    try {
      await started("", "american");
      settle("ready");
    } catch {
      running?.stop();
      running = undefined;
      check = undefined;
      // A module that is not kept yet could not come, as offline: it tries again once online.
      settle(kept === true ? "failed" : "offline");
    }
  }

  function want(): void {
    wanted = true;
    startOnce();
  }

  if (webAssembly) {
    updates.subscribe(startOnce);
    install.subscribe(() => {
      if (install.getState() === "installed") {
        want();
      }
    });
    onOnline(() => {
      if (state === "offline") {
        settle("starting");
        startOnce();
      }
    });
    void (async () => {
      kept = await updates.firstUseKept();
      if (kept) {
        want();
      } else if (running !== undefined && state === "starting" && downloads()) {
        settle("downloading");
      }
    })();
    if (install.getState() === "installed") {
      want();
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    prepare: want,
    check: async (text, variety) => {
      if (check === undefined) {
        throw new Error("The checker is not running.");
      }
      return check(text, variety);
    },
  };
}
