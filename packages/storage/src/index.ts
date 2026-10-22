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

/** What a store finds saved (Store.status). */
export type StoreStatus =
  /** Nothing saved yet. */
  | 'empty'
  /** Saved data this version of the app reads. */
  | 'ok'
  /** Saved by a newer version of the app (say, before a rollback): update this one. */
  | 'newer'
  /** Saved data this version can't read: it fails the store's checks, or its migration failed. */
  | 'unreadable';

export interface Store<T> {
  /** The full key, e.g. "shkriuss:counters". */
  readonly key: string;
  /** The current shape version of the data. */
  readonly version: number;
  /** The saved data, or the fallback if nothing is saved or it can't be read (see status()). */
  load(): T;
  /**
   * Saves `value`; false if it wasn't saved. Data that's saved but can't be
   * read (status() "newer" or "unreadable") is never saved over, so an
   * update can still read it. A value that fails the store's own checks is
   * never saved either: it couldn't be read back.
   */
  save(value: T): boolean;
  /** Whether the saved data can be read. When it can't, load() gives the fallback. */
  status(): StoreStatus;
  /** What's saved, as it was saved (not migrated or checked): its data version and data. */
  raw(): { v: number; data: unknown } | null;
  clear(): void;
  /** A fresh empty value (the store's fallback). */
  empty(): T;
  /**
   * Checks data saved with `version` (here or on another device), migrating
   * it if it's older. Undefined if it's invalid, or newer than this app.
   */
  read(version: number, data: unknown): T | undefined;
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

const made = new Map<string, Pick<Store<unknown>, 'version' | 'read'>>();
/**
 * Every store made on this page, by full key, so a backup can be checked
 * with them before it replaces anything (restoreAll in ./backup.ts).
 */
export const madeStores: ReadonlyMap<string, Pick<Store<unknown>, 'version' | 'read'>> = made;

let askedToKeep = false;

/**
 * Asks the browser, once per page, to keep this site's data: when the device
 * is short of space, and (as far as it decides) after a week without a visit,
 * when Safari otherwise deletes a website's data unless it's on the Home
 * Screen. It may say no, and some browsers ask the person. Called after the
 * first save, when there's something worth keeping.
 */
export function keepData(): void {
  if (askedToKeep) return;
  askedToKeep = true;
  const storage = globalThis.navigator?.storage;
  if (typeof storage?.persist !== 'function') return;
  void storage
    .persisted()
    .then((kept) => (kept ? undefined : storage.persist()))
    .catch(() => undefined);
}

export function createStore<T>(options: StoreOptions<T>): Store<T> {
  const fullKey = KEY_PREFIX + options.key;
  const storage = (): StorageLike | undefined => options.storage ?? getLocalStorage();
  /** The saved text this store last read or wrote as fine, so save() needn't check it again. */
  let fine: string | null = null;

  const read = (version: number, data: unknown): T | undefined => {
    try {
      if (version === options.version) return options.validate(data) ? data : undefined;
      if (!Number.isInteger(version) || version > options.version) return undefined;
      const migrated = options.migrate?.(data, version);
      return migrated !== undefined && options.validate(migrated) ? migrated : undefined;
    } catch {
      // A check or a migration that breaks on odd data: it can't be read.
      return undefined;
    }
  };

  /** What's saved, and the value this version makes of it. */
  const inspect = (raw: string | null | undefined): { status: StoreStatus; value?: T } => {
    if (raw == null) return { status: 'empty' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'unreadable' };
    }
    if (typeof parsed !== 'object' || parsed === null || !('v' in parsed)) {
      return { status: 'unreadable' };
    }
    const { v, data } = parsed as Envelope<unknown>;
    if (typeof v === 'number' && v > options.version) return { status: 'newer' };
    const value = read(v, data);
    if (value === undefined) return { status: 'unreadable' };
    fine = raw;
    return { status: 'ok', value };
  };

  const store: Store<T> = {
    key: fullKey,
    version: options.version,
    empty: options.fallback,
    read,
    status: () => inspect(storage()?.getItem(fullKey)).status,

    raw() {
      try {
        const parsed: unknown = JSON.parse(storage()?.getItem(fullKey) ?? 'null');
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { v, data } = parsed as Partial<Envelope<unknown>>;
        return typeof v === 'number' ? { v, data } : null;
      } catch {
        return null;
      }
    },

    load(): T {
      return inspect(storage()?.getItem(fullKey)).value ?? options.fallback();
    },

    save(value: T): boolean {
      try {
        const target = storage();
        if (!target) return false;
        const saved = target.getItem(fullKey);
        if (saved !== null && saved !== fine && inspect(saved).status !== 'ok') return false;
        const text = JSON.stringify({ v: options.version, data: value } satisfies Envelope<T>);
        // Checked as it will be read back (JSON turns NaN into null, say).
        if (read(options.version, (JSON.parse(text) as Envelope<unknown>).data) === undefined) {
          return false;
        }
        target.setItem(fullKey, text);
        fine = text;
        keepData();
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
  made.set(fullKey, store);
  return store;
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
