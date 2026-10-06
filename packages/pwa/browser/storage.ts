/**
 * How safe the app's data is on the device (architecture §7): whether the browser keeps it until
 * the user deletes it, and how much the app stores, for Settings to show.
 *
 * `createAppStorage()` takes the browser's `navigator.storage` as a parameter, so that tests can
 * run it; `index.ts` gives it the browser's.
 */

/**
 * Whether the browser keeps the app's data:
 *
 * - `persisted`: until the user deletes it.
 * - `best-effort`: the browser may delete it, as when the device runs low on space.
 * - `unknown`: the browser has no Storage API, or did not answer.
 */
export type Persistence = "persisted" | "best-effort" | "unknown";

export interface StorageStatus {
  readonly persistence: Persistence;
  /** How many bytes the app stores, as the browser estimates it; `undefined` while unknown. */
  readonly usage: number | undefined;
  /** How many bytes the browser lets the app store, an estimate; `undefined` while unknown. */
  readonly quota: number | undefined;
}

/**
 * The app's view of its storage. Its functions need no `this`, so React's
 * `useSyncExternalStore(storage.subscribe, storage.getStatus)` can take them as they are.
 */
export interface AppStorage {
  /** The latest status: the same object until it changes. */
  readonly getStatus: () => StorageStatus;
  /** Calls `listener` after each change of the status, until the function it returns is called. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Reads the status again, as after the app stored or deleted data. */
  readonly refresh: () => Promise<void>;
  /**
   * Asks the browser to keep the app's data until the user deletes it, and resolves to whether
   * it does. Firefox asks the user, so call it only for something the user does, such as a
   * button in Settings. Chromium and Safari decide by themselves, from how much the user uses
   * the app and whether it is installed, and ask nothing.
   */
  readonly requestPersistence: () => Promise<boolean>;
}

/** What the app uses of `navigator.storage`. */
export interface StorageManagerLike {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
  estimate(): Promise<{ readonly usage?: number; readonly quota?: number }>;
}

const UNKNOWN: StorageStatus = { persistence: "unknown", usage: undefined, quota: undefined };

async function readStatus(manager: StorageManagerLike): Promise<StorageStatus> {
  const [persisted, estimate] = await Promise.allSettled([manager.persisted(), manager.estimate()]);
  let persistence: Persistence = "unknown";
  if (persisted.status === "fulfilled") {
    persistence = persisted.value ? "persisted" : "best-effort";
  }
  return {
    persistence,
    usage: estimate.status === "fulfilled" ? estimate.value.usage : undefined,
    quota: estimate.status === "fulfilled" ? estimate.value.quota : undefined,
  };
}

function same(a: StorageStatus, b: StorageStatus): boolean {
  return a.persistence === b.persistence && a.usage === b.usage && a.quota === b.quota;
}

/**
 * Follows the storage of the app, from `manager`, which is `navigator.storage` where the browser
 * has one. It reads the status once at the start, and again on `refresh()`.
 */
export function createAppStorage(manager: StorageManagerLike | undefined): AppStorage {
  const listeners = new Set<() => void>();
  let status = UNKNOWN;
  let reads = 0;

  async function refresh(): Promise<void> {
    if (manager === undefined) {
      return;
    }
    reads += 1;
    const read = reads;
    const next = await readStatus(manager);
    // A read that answers after a later one has nothing newer to say.
    if (read !== reads || same(next, status)) {
      return;
    }
    status = next;
    for (const listener of listeners) {
      listener();
    }
  }

  void refresh();

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    requestPersistence: async () => {
      if (manager === undefined) {
        return false;
      }
      let persisted: boolean;
      try {
        persisted = await manager.persist();
      } catch {
        // As in a document that is no longer shown: the data stays as it was.
        persisted = false;
      }
      await refresh();
      return persisted;
    },
  };
}
