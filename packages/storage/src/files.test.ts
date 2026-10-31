import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createFileStore as createFileStoreType } from './files.ts';

/** A request as IndexedDB answers one: its result is read once the transaction completes. */
const answer = <T>(result: T) => ({ result });

/** A pretend connection to the files database, with one table of rows. */
class FakeConnection {
  version = 1;
  objectStoreNames = { contains: (name: string) => name === 'files' };
  onversionchange: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  readonly rows: Map<string, unknown>;

  constructor(rows: Map<string, unknown>) {
    this.rows = rows;
  }

  close(): void {
    this.closed = true;
  }

  /** As the browser does when it closes a connection itself: it's dead, and the page is told. */
  closedByBrowser(): void {
    this.closed = true;
    this.onclose?.();
  }

  transaction(_name: string, _mode: IDBTransactionMode) {
    if (this.closed) {
      throw new DOMException('The database connection is closing.', 'InvalidStateError');
    }
    const { rows } = this;
    const inRange = ([lower, upper]: [string, string]) =>
      [...rows.keys()].filter((key) => key >= lower && key < upper).sort();
    const table = {
      get: (key: string) => answer(rows.get(key)),
      getAll: (range: [string, string]) => answer(inRange(range).map((key) => rows.get(key))),
      getAllKeys: (range: [string, string]) => answer(inRange(range)),
      put: (value: unknown, key: string) => answer(rows.set(key, value) && undefined),
      delete: (key: string) => answer(rows.delete(key) && undefined),
    };
    const transaction = {
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      error: null,
      objectStore: () => table,
    };
    // Done once the page's code has set its handlers.
    queueMicrotask(() => transaction.oncomplete?.());
    return transaction;
  }
}

/** A pretend IndexedDB: counts how often the database is opened, and keeps every connection it gave. */
function fakeIndexedDB() {
  const rows = new Map<string, unknown>();
  const connections: FakeConnection[] = [];
  const indexedDB = {
    open(_name: string, _version?: number) {
      const connection = new FakeConnection(rows);
      connections.push(connection);
      const request = {
        result: connection,
        error: null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  const IDBKeyRange = { bound: (lower: string, upper: string) => [lower, upper] };
  return { indexedDB, IDBKeyRange, connections, rows };
}

let fake: ReturnType<typeof fakeIndexedDB>;
let createFileStore: typeof createFileStoreType;

beforeEach(async () => {
  fake = fakeIndexedDB();
  vi.stubGlobal('indexedDB', fake.indexedDB);
  vi.stubGlobal('IDBKeyRange', fake.IDBKeyRange);
  // The module keeps its connection; each test starts with none.
  vi.resetModules();
  ({ createFileStore } = await import('./files.ts'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the files database', () => {
  it('is opened once, and shared by every operation', async () => {
    const photos = createFileStore<{ id: string; name: string }>('photos');
    const notes = createFileStore<{ id: string }>('notes');
    await photos.putAll([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    await notes.putAll([{ id: 'a' }]);
    expect(await photos.ids()).toEqual(['a', 'b']);
    expect(await photos.get('b')).toEqual({ id: 'b', name: 'B' });
    expect(await notes.all()).toEqual([{ id: 'a' }]);
    await photos.removeAll(['a']);
    expect(await photos.ids()).toEqual(['b']);
    expect(fake.connections).toHaveLength(1);
  });

  it('opens the database again after the browser closed the connection itself (audit 5 E-5)', async () => {
    const photos = createFileStore<{ id: string }>('photos');
    await photos.putAll([{ id: 'a' }]);
    // The site's data cleared in the browser's settings, or the device short
    // of space, say: the browser closes the connection, and tells the page.
    fake.connections[0]?.closedByBrowser();
    // Every operation failed from here on, until the page was reloaded.
    expect(await photos.ids()).toEqual(['a']);
    expect(fake.connections).toHaveLength(2);
    expect(fake.connections[1]?.closed).toBe(false);
  });

  it('lets go when another tab deletes or upgrades the database, and opens it again after', async () => {
    const photos = createFileStore<{ id: string }>('photos');
    expect(await photos.ids()).toEqual([]);
    fake.connections[0]?.onversionchange?.();
    expect(fake.connections[0]?.closed).toBe(true);
    expect(await photos.ids()).toEqual([]);
    expect(fake.connections).toHaveLength(2);
  });
});
