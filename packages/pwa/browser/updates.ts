/**
 * The page's side of the service worker (docs/specs/service-worker.md §3 and §7): it registers
 * `/sw.js` once the page has loaded and follows the versions of the app, so that the app can
 * show when an update is available and apply it when the user agrees.
 *
 * `createAppUpdates()` takes what it uses of the browser as a parameter, so that tests can run
 * it; `index.ts` gives it the browser's.
 */
import { ACTIVATE_MESSAGE, CACHE_PREFIX } from "../src/protocol.ts";

/**
 * Where the page stands:
 *
 * - `unavailable`: no service worker, as in development builds, in browsers without service
 *   workers and in private windows that refuse them. The app works online only.
 * - `installing`: the first version is installing; the app works offline once it is ready.
 * - `ready`: a version is active, and the app works offline.
 * - `update-available`: a new version has installed and waits until the user agrees.
 * - `updating`: the user agreed; the page reloads once the new version is active.
 * - `outdated`: another tab or window made a new version active, and this page should reload.
 */
export type UpdateState =
  "unavailable" | "installing" | "ready" | "update-available" | "updating" | "outdated";

/**
 * The app's view of its service worker. Its functions need no `this`, so React's
 * `useSyncExternalStore(updates.subscribe, updates.getState)` can take them as they are.
 */
export interface AppUpdates {
  readonly getState: () => UpdateState;
  /** Calls `listener` after each change of the state, until the function it returns is called. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Makes the waiting version active, then reloads the page into it (§7.2). When the page is
   * outdated, it only reloads.
   */
  readonly applyUpdate: () => void;
  /** Asks the browser to look for a new version now; a failed check waits for the next (§7.1). */
  readonly checkForUpdate: () => Promise<void>;
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
  reload(): void;
  now(): number;
  readonly caches:
    { keys(): Promise<string[]>; delete(name: string): Promise<boolean> } | undefined;
}

/** How often, at most, the page asks the browser to look for a new version (§7.1): hourly. */
export const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

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
  let state: UpdateState = "unavailable";
  let registration: RegistrationLike | undefined;
  let updateRequested = false;
  let outdated = false;
  let lastCheck = environment.now();

  function refresh(): void {
    if (registration === undefined) {
      return;
    }
    let next: UpdateState;
    if (outdated) {
      next = "outdated";
    } else if (updateRequested) {
      next = "updating";
    } else if (registration.active === null) {
      next = "installing";
    } else if (registration.waiting === null) {
      next = "ready";
    } else {
      next = "update-available";
    }
    if (next !== state) {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    }
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

  async function start(container: ContainerLike): Promise<void> {
    // The first controller of a page that had none is the first version, not an update (§5).
    let controlled = container.controller !== null;
    container.addEventListener("controllerchange", () => {
      if (updateRequested) {
        environment.reload();
        return;
      }
      outdated ||= controlled;
      controlled = true;
      refresh();
    });
    await environment.loaded();
    let registered: RegistrationLike;
    try {
      registered = await environment.register();
    } catch {
      // Refused, as some private windows do: the app works online only (§3).
      return;
    }
    registration = registered;
    follow(registered.installing);
    follow(registered.waiting);
    registered.addEventListener("updatefound", () => {
      follow(registered.installing);
      refresh();
    });
    environment.onVisible(() => {
      if (environment.now() - lastCheck >= UPDATE_CHECK_INTERVAL) {
        void checkForUpdate();
      }
    });
    refresh();
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
  };
}
