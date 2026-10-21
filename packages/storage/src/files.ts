/**
 * Files on the device, like photos: too big for localStorage (about 5 MB for
 * everything), so they're kept in the browser's IndexedDB instead, which can
 * hold far more. Like the rest of an app's data, they stay on this device and
 * other sites can't read them. Docs: docs/adr/0013-photos-on-the-device.md
 *
 * One database per site, with one table: each file is saved under
 * "<kind>:<id>", e.g. "repair-photos:6f1c…". Browser only.
 */

const DATABASE = 'shkriuss-files';
const TABLE = 'files';

/** A file to keep: anything with an id (Blobs are saved as they are). */
export interface StoredFile {
  id: string;
}

export interface FileStore<T extends StoredFile> {
  get(id: string): Promise<T | undefined>;
  /** Saves several files together: all are saved, or none. */
  putAll(files: readonly T[]): Promise<void>;
  removeAll(ids: readonly string[]): Promise<void>;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(TABLE);
    };
    request.onsuccess = () => {
      const database = request.result;
      // "Delete all data" in another tab: let go, so it can.
      database.onversionchange = () => {
        database.close();
        opening = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Couldn’t open the files.'));
  }).catch((error: unknown) => {
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
  return {
    async get(id) {
      return (
        (await transact<T>('readonly', (table) => table.get(keyOf(id)) as IDBRequest<T>)) ??
        undefined
      );
    },
    async putAll(files) {
      if (files.length === 0) return;
      await transact('readwrite', (table) => {
        for (const file of files) table.put(file, keyOf(file.id));
        return undefined;
      });
    },
    async removeAll(ids) {
      if (ids.length === 0) return;
      await transact('readwrite', (table) => {
        for (const id of ids) table.delete(keyOf(id));
        return undefined;
      });
    },
  };
}

/**
 * Asks the browser to keep this site's files even when the device is short of
 * space (it may say no). Worth asking once someone saves something they'd
 * miss, like a photo.
 */
export async function keepFiles(): Promise<void> {
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Not supported: the files are kept as long as the browser allows.
  }
}

/**
 * Deletes every file this site saved ("Delete all data"). Resolves when it's
 * done, or after `waitMs` if the browser is slow to: the caller reloads anyway.
 */
export function deleteAllFiles(waitMs = 3000): Promise<void> {
  return new Promise<void>((resolve) => {
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
}
