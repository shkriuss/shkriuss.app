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

/** Whether an error from storage means it's full (each browser names it its own way). */
export const isStorageFull = (error: unknown): boolean =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');

/**
 * Returns localStorage, or undefined when it is unavailable (some private
 * browsing modes, or storage disabled). Apps then still work for the session.
 * Storage that's full is still returned: what's saved can be read.
 */
export function getLocalStorage(): StorageLike | undefined {
  let storage: Storage | undefined;
  try {
    storage = globalThis.localStorage;
    const probe = `${KEY_PREFIX}__probe__`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch (error) {
    return storage && isStorageFull(error) ? storage : undefined;
  }
}

/** Why a save didn't work (lastSaveProblem). */
export type SaveProblem =
  /** No storage: blocked in the browser's settings, or a private mode without it. */
  | 'unavailable'
  /** The browser has no more room for this site's data. */
  | 'full'
  /** What's saved was saved by a newer version of the app, so it isn't saved over. */
  | 'newer'
  /** What's saved can't be read by this version, so it isn't saved over. */
  | 'unreadable'
  /** The value fails the store's own checks: a mistake in the app. */
  | 'invalid';

let lastProblem: SaveProblem = 'unavailable';
/** The stores whose latest save didn't work, by key: what they hold isn't saved. */
const unsaved = new Set<string>();

/**
 * Why the latest save on this page that didn't work didn't work, for
 * telling the person (reportSave in @shkriuss/ui/problem). Ask it right
 * after a save() that gave false.
 */
export function lastSaveProblem(): SaveProblem {
  return lastProblem;
}

/**
 * Whether every store on this page saved the last time it tried. Each save
 * writes a store's whole value, so one that works again saves what didn't
 * save before, but only for that store.
 */
export function allSaved(): boolean {
  return unsaved.size === 0;
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
      const fail = (problem: SaveProblem): false => {
        lastProblem = problem;
        unsaved.add(fullKey);
        return false;
      };
      try {
        const target = storage();
        if (!target) return fail('unavailable');
        const saved = target.getItem(fullKey);
        if (saved !== null && saved !== fine) {
          const { status } = inspect(saved);
          if (status === 'newer' || status === 'unreadable') return fail(status);
        }
        const text = JSON.stringify({ v: options.version, data: value } satisfies Envelope<T>);
        // Checked as it will be read back (JSON turns NaN into null, say).
        if (read(options.version, (JSON.parse(text) as Envelope<unknown>).data) === undefined) {
          return fail('invalid');
        }
        target.setItem(fullKey, text);
        fine = text;
        unsaved.delete(fullKey);
        keepData();
        return true;
      } catch (error) {
        // Quota exceeded or storage blocked.
        return fail(isStorageFull(error) ? 'full' : 'unavailable');
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

/** What JSON.parse makes of `text` when that's an object or a list; otherwise nothing. */
function parsedObject(text: string): object | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Collects everything this app has saved into one JSON-ready object. A saved
 * text that is a JSON object or list (a store's envelope) goes in as that
 * value, so the file is readable and a restore can check it with the app's
 * stores; any other saved text goes in as it is (the theme, "dark"), quotes
 * and all if it has them, so that restoring (restoreAll in ./backup.ts)
 * writes back exactly what was saved (audit 5 E-8).
 */
export function exportAll(
  app: string,
  storage: StorageLike | undefined = getLocalStorage(),
  now: Date = new Date(),
): ExportFile {
  const data: Record<string, unknown> = {};
  for (const key of ownKeys(storage)) {
    const raw = storage?.getItem(key);
    if (raw == null) continue;
    data[key] = parsedObject(raw) ?? raw;
  }
  return { app, exportedAt: now.toISOString(), data };
}

/** Deletes everything this app has saved through these helpers. */
export function deleteAll(storage: StorageLike | undefined = getLocalStorage()): number {
  const keys = ownKeys(storage);
  for (const key of keys) storage?.removeItem(key);
  return keys.length;
}

/**
 * How long a download keeps its address (ms). The file exists only as long
 * as the address does, and Safari on an iPhone or iPad asks "Do you want to
 * download …?" and fetches the file only once the person taps Download,
 * which can take a while: freed after a second, as it was, that gave "Safari
 * cannot download this file" while the page said the backup was downloaded
 * (audit 5 Z-2). A minute, as Photos' "Save original" gives.
 */
export const DOWNLOAD_URL_MS = 60_000;

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
  // Freed after a minute, or when the page goes away.
  let timer = 0;
  const revoke = (): void => {
    window.clearTimeout(timer);
    window.removeEventListener('pagehide', revoke);
    URL.revokeObjectURL(url);
  };
  timer = window.setTimeout(revoke, DOWNLOAD_URL_MS);
  window.addEventListener('pagehide', revoke);
}
