/**
 * Files on the device, like photos: too big for localStorage (about 5 MB for
 * everything), so they're kept in the browser's IndexedDB instead, which can
 * hold far more. Like the rest of an app's data, they stay on this device and
 * other sites can't read them. Docs: docs/adr/0013-photos-on-the-device.md
 *
 * One database per site, with one table: each file is saved under
 * "<kind>:<id>", e.g. "repair-photos:6f1c…". Browser only.
 */

import { keepData } from './index.ts';

const DATABASE = 'shkriuss-files';
const TABLE = 'files';

/** A file to keep: anything with an id (Blobs are saved as they are). */
export interface StoredFile {
  id: string;
}

export interface FileStore<T extends StoredFile> {
  get(id: string): Promise<T | undefined>;
  /** Every file of this kind (for small records, like a list of photos' details). */
  all(): Promise<T[]>;
  /** The ids of every file of this kind, without reading the files. */
  ids(): Promise<string[]>;
  /** Saves several files together: all are saved, or none. */
  putAll(files: readonly T[]): Promise<void>;
  removeAll(ids: readonly string[]): Promise<void>;
  /** A file ready to save together with files of other kinds (putTogether). */
  entry(file: T): FileEntry;
}

/** A file of some kind, for putTogether(): made by its store's entry(). */
export interface FileEntry {
  readonly key: string;
  readonly file: StoredFile;
}

/**
 * The lowest database version with everything upgrade() makes. Raise it when
 * adding a step there (like an index), so existing databases get the step.
 */
const VERSION = 1;

/**
 * Makes sure the database has what this code needs. Each step checks for
 * what it adds instead of trusting the version number, so it also mends a
 * database left half made (a table missing) and never fails on one that
 * already has it. Existing files are never touched.
 */
function upgrade(database: IDBDatabase): void {
  if (!database.objectStoreNames.contains(TABLE)) database.createObjectStore(TABLE);
}

const isReady = (database: IDBDatabase) =>
  database.version >= VERSION && database.objectStoreNames.contains(TABLE);

/** Opens the database: at whatever version it has, or at `version` (upgrading it). */
function request(version?: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const opened =
      version === undefined ? indexedDB.open(DATABASE) : indexedDB.open(DATABASE, version);
    opened.onupgradeneeded = () => upgrade(opened.result);
    opened.onsuccess = () => resolve(opened.result);
    opened.onerror = () => reject(opened.error ?? new Error('Couldn’t open the files.'));
  });
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= (async () => {
    let database = await request();
    if (!isReady(database)) {
      // Older, or missing its table: open it one version up, which runs upgrade().
      const version = Math.max(VERSION, database.version + 1);
      database.close();
      database = await request(version);
    }
    const ready = database;
    // "Delete all data", or an upgrade, in another tab: let go, so it can.
    ready.onversionchange = () => {
      ready.close();
      opening = null;
    };
    // The browser closed it itself (the site's data cleared in its settings,
    // or the device short of space, say): the next operation opens it again,
    // instead of every one failing until the page is reloaded (audit 5 E-5).
    ready.onclose = () => {
      opening = null;
    };
    return ready;
  })().catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

/** Runs `work` in one transaction; resolves once it's all saved. */
async function transact<R>(
  mode: IDBTransactionMode,
  work: (table: IDBObjectStore) => IDBRequest<R> | undefined,
): Promise<R | undefined> {
  const database = await open();
  return new Promise<R | undefined>((resolve, reject) => {
    const transaction = database.transaction(TABLE, mode);
    const request = work(transaction.objectStore(TABLE));
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error ?? new Error('Couldn’t save the files.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Couldn’t save the files.'));
  });
}

/** Files of one kind, e.g. createFileStore("repair-photos"). */
export function createFileStore<T extends StoredFile>(kind: string): FileStore<T> {
  const keyOf = (id: string) => `${kind}:${id}`;
  // Every key from "<kind>:" up to "<kind>;" (the next character) is this kind's.
  const range = () => IDBKeyRange.bound(`${kind}:`, `${kind};`, false, true);
  const entry = (file: T): FileEntry => ({ key: keyOf(file.id), file });
  return {
    async get(id) {
      return (
        (await transact<T>('readonly', (table) => table.get(keyOf(id)) as IDBRequest<T>)) ??
        undefined
      );
    },
    async all() {
      return (await transact<T[]>('readonly', (table) => table.getAll(range()))) ?? [];
    },
    async ids() {
      const keys = await transact<IDBValidKey[]>('readonly', (table) => table.getAllKeys(range()));
      return (keys ?? []).map((key) => String(key).slice(kind.length + 1));
    },
    putAll: (files) => putTogether(files.map(entry)),
    async removeAll(ids) {
      if (ids.length === 0) return;
      await transact('readwrite', (table) => {
        for (const id of ids) table.delete(keyOf(id));
        return undefined;
      });
    },
    entry,
  };
}

/**
 * Saves files of several kinds together, in one transaction: all are saved,
 * or none. For records that must never disagree, like a photo's details and
 * its files (each store's entry() makes them).
 */
export async function putTogether(entries: readonly FileEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await transact('readwrite', (table) => {
    for (const { key, file } of entries) table.put(file, key);
    return undefined;
  });
}

/**
 * Asks the browser to keep this site's files even when the device is short of
 * space (it may say no). Worth asking once someone saves something they'd
 * miss, like a photo.
 */
export function keepFiles(): Promise<void> {
  keepData();
  return Promise.resolve();
}

/**
 * Deletes every file this site saved ("Delete all data"): the files database,
 * and what an app downloaded into its own cache, like Grammar's Deep check
 * model. The offline copy of the site (caches named "shkriuss-…") stays.
 * Resolves when it's done, or after `waitMs` if the browser is slow to: the
 * caller reloads anyway.
 */
export function deleteAllFiles(waitMs = 3000): Promise<void> {
  const database = new Promise<void>((resolve) => {
    const done = () => resolve();
    window.setTimeout(done, waitMs);
    try {
      const closing = opening;
      opening = null;
      void closing?.then((database) => database.close()).catch(() => undefined);
      const request = indexedDB.deleteDatabase(DATABASE);
      request.onsuccess = done;
      request.onerror = done;
    } catch {
      done();
    }
  });
  return Promise.all([database, deleteDownloads()]).then(() => undefined);
}

/** Caches an app keeps itself (not the offline copy, "shkriuss-…"). */
async function deleteDownloads(): Promise<void> {
  try {
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => !name.startsWith('shkriuss-')).map((name) => caches.delete(name)),
    );
  } catch {
    // No Cache Storage here: nothing was downloaded into it.
  }
}
