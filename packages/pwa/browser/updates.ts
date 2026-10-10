/**
 * The page's side of the service worker (docs/specs/service-worker.md §3 and §7): it registers
 * `/sw.js` once the page has loaded and follows the versions of the app, so that the app can
 * show when an update is available and apply it when the user agrees.
 *
 * `createAppUpdates()` takes what it uses of the browser as a parameter, so that tests can run
 * it; `index.ts` gives it the browser's.
 */
import { ACTIVATE_MESSAGE, CACHE_PREFIX, FIRST_USE_RECORD, STATE_CACHE } from "../src/protocol.ts";

/**
 * Where the page stands:
 *
 * - `starting`: the page has not registered the service worker yet, which it does once it has
 *   loaded (§3). It does not know yet whether the app works offline.
 * - `unavailable`: no service worker, as in development builds, in browsers without service
 *   workers and in private windows that refuse them, or none yet, when registering failed or the
 *   first version failed to install, until a later try works (§3). The app works online only.
 * - `installing`: the first version is installing; the app works offline once it is ready.
 * - `ready`: a version is active, and the app works offline.
 * - `update-available`: a new version has installed and waits until the user agrees.
 * - `updating`: the user agreed; the page reloads once the new version is active.
 * - `outdated`: another tab or window made a new version active, and this page should reload.
 */
export type UpdateState =
  | "starting"
  | "unavailable"
  | "installing"
  | "ready"
  | "update-available"
  | "updating"
  | "outdated";

/**
 * The app's view of its service worker. Its functions need no `this`, so React's
 * `useSyncExternalStore(updates.subscribe, updates.getState)` can take them as they are.
 */
export interface AppUpdates {
  readonly getState: () => UpdateState;
  /**
   * Calls `listener` after each change of the state, and when a version first takes control of
   * the page (`controlled`), until the function it returns is called.
   */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Makes the waiting version active, then reloads the page into it (§7.2). When the page is
   * outdated, it only reloads.
   */
  readonly applyUpdate: () => void;
  /** Asks the browser to look for a new version now; a failed check waits for the next (§7.1). */
  readonly checkForUpdate: () => Promise<void>;
  /**
   * Whether the service worker keeps the files that the app keeps on first use, as it does once
   * the app has requested one (§6.3), so that what needs them can start without the network.
   * False without a service worker, and if Cache Storage fails.
   */
  readonly firstUseKept: () => Promise<boolean>;
  /**
   * Whether a version controls the page, so that its requests, and those of its workers, go
   * through the service worker (§5): false until the first version has taken control, which
   * comes a moment after it is active, and `ready` says so; false too for a page that the
   * browser loaded past the service worker, as after a hard reload, which no version will
   * control. Listeners hear the change.
   */
  readonly controlled: () => boolean;
}

/** A service worker as the page sees it. */
export interface WorkerLike extends EventTarget {
  readonly state: ServiceWorkerState;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

export interface RegistrationLike extends EventTarget {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  readonly active: WorkerLike | null;
  update(): Promise<unknown>;
}

export interface ContainerLike extends EventTarget {
  readonly controller: unknown;
  getRegistrations(): Promise<readonly { unregister(): Promise<boolean> }[]>;
}

/** What the page uses of the browser. */
export interface PageEnvironment {
  /** `navigator.serviceWorker`, unless the page must not use one. */
  readonly container: ContainerLike | undefined;
  /** Registers `/sw.js` for the whole app. */
  register(): Promise<RegistrationLike>;
  /** Resolves once the page has loaded. */
  loaded(): Promise<void>;
  /** Calls `listener` whenever the page becomes visible. */
  onVisible(listener: () => void): void;
  /** Calls `listener` whenever the device comes back online. */
  onOnline(listener: () => void): void;
  /** Calls `listener` every `interval` milliseconds while the page is open. */
  every(interval: number, listener: () => void): void;
  reload(): void;
  now(): number;
  readonly caches:
    | {
        keys(): Promise<string[]>;
        delete(name: string): Promise<boolean>;
        match(request: string, options: { cacheName: string }): Promise<Response | undefined>;
      }
    | undefined;
}

/** How often, at most, the page asks the browser to look for a new version (§7.1): hourly. */
export const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

/** How often the page looks whether a check is due while it stays open (§7.1). */
const CHECK_TICK = 10 * 60 * 1000;

/** Whether `worker` is there, and the browser has not given up on it. */
function alive(worker: WorkerLike | null): boolean {
  return worker !== null && worker.state !== "redundant";
}

/**
 * Starts the page's side of the service worker. In a build that turns service workers off
 * (`mode` "remove", §9), it registers none, and unregisters any it finds and deletes their
 * caches instead.
 */
export function createAppUpdates(
  environment: PageEnvironment,
  mode: "serve" | "remove",
): AppUpdates {
  const listeners = new Set<() => void>();
  let state: UpdateState =
    environment.container !== undefined && mode === "serve" ? "starting" : "unavailable";
  let registration: RegistrationLike | undefined;
  // Whether the page has a service worker to follow: false until it has registered, and again
  // when registering failed or the first version failed to install, which leaves none (§3).
  let registered = false;
  let updateRequested = false;
  let outdated = false;
  let lastCheck = environment.now();
  // Whether a version controls the page (§5); a change of controller says so.
  let controlled =
    environment.container !== undefined &&
    mode === "serve" &&
    environment.container.controller !== null;

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function set(next: UpdateState): void {
    if (next !== state) {
      state = next;
      notify();
    }
  }

  function refresh(): void {
    if (registration === undefined) {
      return;
    }
    // A worker that has become redundant may stay in its place for a moment after it says so.
    const installing = alive(registration.installing);
    const waiting = alive(registration.waiting);
    const active = alive(registration.active);
    // A first version that failed to install leaves no worker: the browser drops the
    // registration, and the page must register again (§3).
    registered = installing || waiting || active;
    let next: UpdateState;
    if (outdated) {
      next = "outdated";
    } else if (!registered) {
      next = "unavailable";
    } else if (updateRequested) {
      next = "updating";
    } else if (!active) {
      next = "installing";
    } else if (!waiting) {
      next = "ready";
    } else {
      next = "update-available";
    }
    set(next);
  }

  function follow(worker: WorkerLike | null): void {
    worker?.addEventListener("statechange", refresh);
  }

  async function checkForUpdate(): Promise<void> {
    if (registration === undefined) {
      return;
    }
    lastCheck = environment.now();
    try {
      await registration.update();
    } catch {
      // Offline, for example: the next check tries again.
    }
  }

  /** Registers `/sw.js`, and follows the versions of the app that it brings. */
  async function register(): Promise<void> {
    lastCheck = environment.now();
    let added: RegistrationLike;
    try {
      added = await environment.register();
    } catch {
      // Refused, as some private windows do, or the script could not be fetched: the app works
      // online only, until a later try works (§3).
      registered = false;
      set("unavailable");
      return;
    }
    registration = added;
    follow(added.installing);
    follow(added.waiting);
    added.addEventListener("updatefound", () => {
      follow(added.installing);
      refresh();
    });
    refresh();
  }

  /**
   * Registers again, or asks the browser to look for a new version, once an hour has passed
   * since the last try (§3, §7.1). Coming back online, the page registers again at once: the
   * first install may have failed for the want of a network.
   */
  function poke(online: boolean): void {
    const due = environment.now() - lastCheck >= UPDATE_CHECK_INTERVAL;
    if (!registered && (online || due)) {
      void register();
    } else if (registered && due) {
      void checkForUpdate();
    }
  }

  async function start(container: ContainerLike): Promise<void> {
    container.addEventListener("controllerchange", () => {
      if (updateRequested) {
        environment.reload();
        return;
      }
      // The first controller of a page that had none is the first version, not an update (§5).
      const first = !controlled;
      outdated ||= controlled;
      controlled = true;
      refresh();
      if (first) {
        notify();
      }
    });
    await environment.loaded();
    await register();
    environment.onVisible(() => {
      poke(false);
    });
    environment.onOnline(() => {
      poke(true);
    });
    environment.every(CHECK_TICK, () => {
      poke(false);
    });
  }

  async function remove(container: ContainerLike): Promise<void> {
    try {
      for (const old of await container.getRegistrations()) {
        await old.unregister();
      }
      const { caches } = environment;
      if (caches !== undefined) {
        for (const name of await caches.keys()) {
          if (name.startsWith(CACHE_PREFIX)) {
            await caches.delete(name);
          }
        }
      }
    } catch {
      // Nothing more can be done here; the app works online all the same.
    }
  }

  const { container } = environment;
  if (container !== undefined) {
    void (mode === "serve" ? start(container) : remove(container));
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyUpdate: () => {
      if (outdated) {
        // Another window already made the new version active: the page only has to reload.
        environment.reload();
        return;
      }
      const waiting = registration?.waiting ?? null;
      if (waiting === null || updateRequested) {
        return;
      }
      updateRequested = true;
      waiting.addEventListener("statechange", () => {
        // A newer version replaced it before it became active: offer that one instead.
        if (waiting.state === "redundant") {
          updateRequested = false;
          refresh();
        }
      });
      refresh();
      waiting.postMessage(ACTIVATE_MESSAGE, []);
    },
    checkForUpdate,
    controlled: () => controlled,
    firstUseKept: async () => {
      const { caches } = environment;
      if (container === undefined || mode === "remove" || caches === undefined) {
        return false;
      }
      try {
        return (await caches.match(FIRST_USE_RECORD, { cacheName: STATE_CACHE })) !== undefined;
      } catch {
        return false;
      }
    },
  };
}
