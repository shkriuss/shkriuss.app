import type { AppUpdates, UpdateState } from "@shkriuss/pwa";

/** The app's updates as the frame shows them: its service worker's, and its database's. */
export interface AppUpdatesWithDatabase extends AppUpdates {
  /**
   * For `onVersionChange` of `openDatabase()`: a newer version of the app, in another window,
   * upgraded the database and closed it here. The page runs an outdated version then, which can
   * neither read nor write, and must reload (data model §7).
   */
  readonly databaseClosed: () => void;
}

/**
 * Adds the database to the updates of the app's service worker, from `startServiceWorker()`:
 * once a newer version closed the database, the page is outdated, as when another window made a
 * new version active, and the update banner offers to reload. A version that waits is the newer
 * one, which reloading makes active; otherwise the page reloads as it is.
 */
export function appUpdates(
  updates: AppUpdates,
  reload: () => void = () => {
    location.reload();
  },
): AppUpdatesWithDatabase {
  let closed = false;
  const listeners = new Set<() => void>();
  return {
    // Updating stays so: the page is about to reload into the new version.
    getState: (): UpdateState => {
      const state = updates.getState();
      return closed && state !== "updating" ? "outdated" : state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      const unsubscribe = updates.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    applyUpdate: () => {
      if (closed && updates.getState() !== "update-available") {
        reload();
      } else {
        updates.applyUpdate();
      }
    },
    checkForUpdate: updates.checkForUpdate,
    firstUseKept: updates.firstUseKept,
    databaseClosed: () => {
      if (closed) {
        return;
      }
      closed = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
