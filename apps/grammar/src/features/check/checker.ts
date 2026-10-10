import type { AppInstall, AppUpdates } from "@shkriuss/pwa";
import type { Mistake, Variety } from "./protocol.ts";

/** Checks texts: the mistakes in `text` in `variety`, or a rejection if the check failed. */
export type Check = (text: string, variety: Variety) => Promise<readonly Mistake[]>;

/**
 * Rejects a check that waited for the worker when a newer text took its place before it began
 * (docs/specs/apps/grammar.md §1). Nothing failed: the screen asks again for the text as it is.
 */
export class Superseded extends Error {
  constructor() {
    super("A newer check took its place.");
    this.name = "Superseded";
  }
}

/**
 * Rejects a check that the worker did not answer in time, as `startWorkerCheck()` gives it. A
 * worker that the browser has ended, as for want of memory, answers nothing and reports nothing,
 * so the checker takes it for dead.
 */
export class Unanswered extends Error {
  constructor() {
    super("The checker did not answer in time.");
    this.name = "Unanswered";
  }
}

/** A worker that checks texts, as `startWorkerCheck()` starts it. */
export interface RunningCheck {
  readonly check: Check;
  /** Stops the worker, and ends the checks that wait for it, which reject. */
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
 * - `failed`: it cannot start, as in a browser without WebAssembly;
 * - `stopped`: its worker stopped answering, as when the browser ended it for want of memory,
 *   and it checks nothing more; reloading the app starts it again.
 */
export type CheckerState = "starting" | "downloading" | "ready" | "offline" | "failed" | "stopped";

/** The page's checker, for React's `useSyncExternalStore(checker.subscribe, checker.getState)`. */
export interface Checker {
  readonly getState: () => CheckerState;
  readonly subscribe: (listener: () => void) => () => void;
  /** There is text to check: the checker starts, if it has not, as soon as it can. */
  readonly prepare: () => void;
  /**
   * The mistakes in `text` in `variety`; rejects if the checker failed, has not started or has
   * stopped: with `Superseded` if a newer check took its place before it began, and with
   * `Unanswered` when the worker stopped answering, after which the checker is `stopped`.
   */
  readonly check: Check;
}

/** What the checker uses of the page. */
export interface CheckerEnvironment {
  /**
   * The app's service worker, which keeps the checker's module once it has come (ADR 0019), and
   * says whether it controls the page.
   */
  readonly updates: Pick<AppUpdates, "getState" | "subscribe" | "firstUseKept" | "controlled">;
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
 * the latest waits; each takes the place of the one before, which rejects with `Superseded`,
 * unless it is the same text in the same variety, which shares its answer. The screen asks again
 * each time the text changes and wants only the answer about the text as it is, so the worker
 * skips the texts that changed before it could begin them.
 */
function oneAtATime(check: Check): Check {
  let running = false;
  // The latest text that waits, to check once the worker is free, or to skip, with the answer
  // that it waits for.
  let waiting:
    | {
        readonly text: string;
        readonly variety: Variety;
        readonly answer: Promise<readonly Mistake[]>;
        readonly run: () => void;
        readonly skip: () => void;
      }
    | undefined;

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
    if (waiting !== undefined && waiting.text === text && waiting.variety === variety) {
      // The same text again, as after a change undone within the pause: one check serves both.
      return waiting.answer;
    }
    waiting?.skip();
    const { promise, resolve, reject } = Promise.withResolvers<readonly Mistake[]>();
    waiting = {
      text,
      variety,
      answer: promise,
      run: () => {
        run(text, variety).then(resolve, reject);
      },
      skip: () => {
        reject(new Superseded());
      },
    };
    return promise;
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
  // Whether this page saw the app's first version install. That version controls the page only
  // once it has activated and claimed it, a moment after `ready` says that it is active, and the
  // module must come after that, through it. A page that opened with a version active and none
  // in control, as after a hard reload, which the browser loads past the service worker, has no
  // control to wait for: no version will take it.
  let sawInstalling = updates.getState() === "installing";

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

  /** Whether the module would come before the service worker could check it and keep it. */
  function uncontrolled(): boolean {
    return sawInstalling && updates.getState() !== "unavailable" && !updates.controlled();
  }

  function startOnce(): void {
    const worker = updates.getState();
    if (
      !wanted ||
      running !== undefined ||
      state === "failed" ||
      state === "offline" ||
      state === "stopped" ||
      worker === "starting" ||
      worker === "installing" ||
      uncontrolled()
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

  /** Stops the worker, after which the checker checks nothing until it starts again. */
  function stop(): void {
    running?.stop();
    running = undefined;
    check = undefined;
  }

  async function firstCheck(started: Check): Promise<void> {
    try {
      await started("", "american");
      settle("ready");
    } catch {
      stop();
      // A module that is not kept yet could not come, as offline: it tries again once online.
      settle(kept === true ? "failed" : "offline");
    }
  }

  function want(): void {
    wanted = true;
    startOnce();
  }

  if (webAssembly) {
    updates.subscribe(() => {
      sawInstalling ||= updates.getState() === "installing";
      startOnce();
    });
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
      try {
        return await check(text, variety);
      } catch (error) {
        if (error instanceof Unanswered && state === "ready") {
          // The worker is dead: the checker stops, and the screen says that reloading the app,
          // which starts another, tries again.
          stop();
          settle("stopped");
        }
        throw error;
      }
    },
  };
}
