import type { DeviceState } from "@shkriuss/data";

/**
 * What the device knows about its backups (data model §7), for every part of the shell that shows
 * it: the backup section of the settings and the reminder in the frame. They share one store per
 * database, so that a backup made or restored in one shows in the others.
 */

/** What the database said about the device's backups, and when. */
export interface BackupStatus {
  /** `undefined` if the database could not say. */
  readonly device: DeviceState | undefined;
  /** When the database said it, in milliseconds since 1970. */
  readonly at: number;
}

/**
 * The backup status of an app's database. Its functions need no `this`, so React's
 * `useSyncExternalStore(store.subscribe, store.getStatus)` can take them as they are.
 */
export interface BackupStatusStore {
  /** The latest status: `undefined` until the first read ends, then the same object until the next. */
  readonly getStatus: () => BackupStatus | undefined;
  /** Calls `listener` after each new status, until the function it returns is called. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Reads the status again, as after a backup or a restore. It resolves once the status is at
   * least as new as the call: when reads overlap, after the latest of them.
   */
  readonly refresh: () => Promise<void>;
}

/** What the store reads of the app's database, from `openDatabase()` of `@shkriuss/data`. */
export interface DeviceReader {
  device(): Promise<DeviceState>;
}

/** Follows the backup status of `db`, with the time from `now`. It reads only on `refresh()`. */
export function createBackupStatus(
  db: DeviceReader,
  now: () => number = Date.now,
): BackupStatusStore {
  const listeners = new Set<() => void>();
  let status: BackupStatus | undefined;
  let reads = 0;
  // The latest read, which every overlapping call waits for.
  let latest: Promise<void> = Promise.resolve();

  async function read(id: number): Promise<void> {
    let device: DeviceState | undefined;
    try {
      device = await db.device();
    } catch {
      // As with a database that another version of the app closed: the status leaves it out.
      device = undefined;
    }
    // A read that answers after a later one has nothing newer to say.
    if (id !== reads) {
      return;
    }
    status = { device, at: now() };
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: async () => {
      reads += 1;
      let waited = read(reads);
      latest = waited;
      await waited;
      // Until the latest read has answered, which may have started while this one waited.
      while (waited !== latest) {
        waited = latest;
        await waited;
      }
    },
  };
}

const stores = new WeakMap<DeviceReader, BackupStatusStore>();

/** The one backup status store of `db`, which every part of the shell shares. */
export function backupStatusOf(db: DeviceReader): BackupStatusStore {
  let store = stores.get(db);
  if (store === undefined) {
    store = createBackupStatus(db);
    stores.set(db, store);
  }
  return store;
}
