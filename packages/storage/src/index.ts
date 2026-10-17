/**
 * On-device storage for apps: a small, typed wrapper around localStorage.
 *
 * Why: every app saves data the same way, can export it as a file, and can
 * delete it all. Nothing here ever sends data off the device.
 *
 * Each app runs on its own subdomain (its own "origin"), so browsers keep each
 * app's localStorage separate. Apps cannot read each other's data.
 */

/** The parts of the Web Storage API we use (lets tests pass an in-memory fake). */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** All keys written by these helpers start with this prefix. */
export const KEY_PREFIX = 'shkriuss:';

interface Envelope<T> {
  /** Schema version of `data`, so apps can migrate old saved data. */
  v: number;
  data: T;
}

export interface StoreOptions<T> {
  /** Short name, e.g. "counters". Stored as "shkriuss:counters". */
  key: string;
  /** Bump this when the shape of the data changes. */
  version: number;
  /** Value used when nothing is saved yet (or saved data can't be read). */
  fallback: () => T;
  /** Returns true if loaded data has the expected shape. */
  validate: (value: unknown) => value is T;
  /** Optional: turn data saved with an older version into the current shape. */
  migrate?: (oldData: unknown, oldVersion: number) => T | undefined;
  /** Defaults to window.localStorage. */
  storage?: StorageLike | undefined;
}

export interface Store<T> {
  readonly key: string;
  load(): T;
  save(value: T): boolean;
  clear(): void;
}

/**
 * Returns localStorage, or undefined when it is unavailable (some private
 * browsing modes, or storage disabled). Apps then still work for the session.
 */
export function getLocalStorage(): StorageLike | undefined {
  try {
    const storage = globalThis.localStorage;
    const probe = `${KEY_PREFIX}__probe__`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return undefined;
  }
}

export function createStore<T>(options: StoreOptions<T>): Store<T> {
  const fullKey = KEY_PREFIX + options.key;
  const storage = (): StorageLike | undefined => options.storage ?? getLocalStorage();

  return {
    key: fullKey,

    load(): T {
      const raw = storage()?.getItem(fullKey);
      if (raw == null) return options.fallback();
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || !('v' in parsed)) {
          return options.fallback();
        }
        const { v, data } = parsed as Envelope<unknown>;
        if (v === options.version) {
          return options.validate(data) ? data : options.fallback();
        }
        const migrated = options.migrate?.(data, v);
        return migrated !== undefined && options.validate(migrated) ? migrated : options.fallback();
      } catch {
        return options.fallback();
      }
    },

    save(value: T): boolean {
      const envelope: Envelope<T> = { v: options.version, data: value };
      try {
        const target = storage();
        if (!target) return false;
        target.setItem(fullKey, JSON.stringify(envelope));
        return true;
      } catch {
        // Quota exceeded or storage blocked.
        return false;
      }
    },

    clear(): void {
      storage()?.removeItem(fullKey);
    },
  };
}

/** Every key this app has saved through these helpers. */
export function ownKeys(storage: StorageLike | undefined = getLocalStorage()): string[] {
  if (!storage) return [];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(KEY_PREFIX)) keys.push(key);
  }
  return keys.sort();
}

export interface ExportFile {
  app: string;
  exportedAt: string;
  data: Record<string, unknown>;
}

/** Collects everything this app has saved into one JSON-ready object. */
export function exportAll(
  app: string,
  storage: StorageLike | undefined = getLocalStorage(),
  now: Date = new Date(),
): ExportFile {
  const data: Record<string, unknown> = {};
  for (const key of ownKeys(storage)) {
    const raw = storage?.getItem(key);
    if (raw == null) continue;
    try {
      data[key] = JSON.parse(raw);
    } catch {
      data[key] = raw;
    }
  }
  return { app, exportedAt: now.toISOString(), data };
}

/** Deletes everything this app has saved through these helpers. */
export function deleteAll(storage: StorageLike | undefined = getLocalStorage()): number {
  const keys = ownKeys(storage);
  for (const key of keys) storage?.removeItem(key);
  return keys.length;
}

/** Starts a download of `content` as a file. Browser only. */
export function downloadFile(filename: string, content: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before freeing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
