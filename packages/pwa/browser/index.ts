/**
 * The page's side of an app's service worker and storage.
 *
 * The service worker (docs/specs/service-worker.md): the app calls `startServiceWorker()` once, as
 * `@shkriuss/shell` does, and shows its state.
 *
 * ```ts
 * import { startServiceWorker } from "@shkriuss/pwa";
 *
 * const updates = startServiceWorker();
 * updates.subscribe(() => {
 *   if (updates.getState() === "update-available") showUpdateBanner();
 * });
 * // When the user agrees:
 * updates.applyUpdate();
 * ```
 *
 * The app's `vite.config.ts` needs `pwa()` from `@shkriuss/pwa/vite`, which builds `/sw.js`.
 *
 * The storage (architecture §7): `appStorage()` says whether the browser keeps the app's data
 * until the user deletes it, and how much the app stores, and asks the browser to keep it.
 */
import { registerServiceWorker } from "@shkriuss/edge/workers";
import { type AppStorage, createAppStorage } from "./storage.ts";
import { type AppUpdates, createAppUpdates, type PageEnvironment } from "./updates.ts";

export { type AppStorage, type Persistence, type StorageStatus } from "./storage.ts";
export { UPDATE_CHECK_INTERVAL, type AppUpdates, type UpdateState } from "./updates.ts";

/** Set by `pwa()`: "remove" in a build that turns service workers off (§9). */
declare const SHKRIUSS_PWA_MODE: "serve" | "remove";

function browserEnvironment(): PageEnvironment {
  return {
    // Development builds register none (§3), and neither do browsers without service workers.
    container:
      import.meta.env.DEV || !("serviceWorker" in navigator) ? undefined : navigator.serviceWorker,
    register: async () => registerServiceWorker({ scope: "/", updateViaCache: "none" }),
    loaded: async () => {
      if (document.readyState !== "complete") {
        await new Promise<void>((resolve) => {
          window.addEventListener("load", () => {
            resolve();
          });
        });
      }
    },
    onVisible: (listener) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          listener();
        }
      });
    },
    reload: () => {
      location.reload();
    },
    now: () => Date.now(),
    caches: "caches" in globalThis ? caches : undefined,
  };
}

let updates: AppUpdates | undefined;

/** Starts the app's service worker once the page has loaded; later calls return the same. */
export function startServiceWorker(): AppUpdates {
  if (typeof SHKRIUSS_PWA_MODE === "undefined") {
    throw new Error("Add pwa() from @shkriuss/pwa/vite to the plugins of the app's Vite build.");
  }
  updates ??= createAppUpdates(browserEnvironment(), SHKRIUSS_PWA_MODE);
  return updates;
}

let storage: AppStorage | undefined;

/** The app's storage on this device; every call returns the same. */
export function appStorage(): AppStorage {
  storage ??= createAppStorage("storage" in navigator ? navigator.storage : undefined);
  return storage;
}
