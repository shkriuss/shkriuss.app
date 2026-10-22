import { beforeEach, describe, expect, it } from 'vitest';
import { createStore, deleteAll, exportAll, ownKeys, type StorageLike } from './index.ts';

/** In-memory stand-in for localStorage. */
class MemoryStorage implements StorageLike {
  #map = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.#map.size;
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
}

type Counts = Record<string, number>;
const isCounts = (value: unknown): value is Counts =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((n) => typeof n === 'number');

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

const makeStore = (extra: Partial<Parameters<typeof createStore<Counts>>[0]> = {}) =>
  createStore<Counts>({
    key: 'counts',
    version: 2,
    fallback: () => ({}),
    validate: isCounts,
    storage,
    ...extra,
  });

describe('createStore', () => {
  it('returns the fallback when nothing is saved', () => {
    expect(makeStore().load()).toEqual({});
  });

  it('saves and loads under a prefixed key', () => {
    const store = makeStore();
    expect(store.save({ water: 3 })).toBe(true);
    expect(store.load()).toEqual({ water: 3 });
    expect(storage.getItem('shkriuss:counts')).toBe('{"v":2,"data":{"water":3}}');
  });

  it('falls back on corrupt or invalid data', () => {
    storage.setItem('shkriuss:counts', 'not json');
    expect(makeStore().load()).toEqual({});
    storage.setItem('shkriuss:counts', '{"v":2,"data":{"water":"lots"}}');
    expect(makeStore().load()).toEqual({});
    storage.setItem('shkriuss:counts', '"just a string"');
    expect(makeStore().load()).toEqual({});
  });

  it('migrates data saved with an older version', () => {
    storage.setItem('shkriuss:counts', '{"v":1,"data":[["water",5]]}');
    const store = makeStore({
      migrate: (old, version) =>
        version === 1 && Array.isArray(old)
          ? Object.fromEntries(old as [string, number][])
          : undefined,
    });
    expect(store.load()).toEqual({ water: 5 });
  });

  it('falls back when there is no migration for an old version', () => {
    storage.setItem('shkriuss:counts', '{"v":1,"data":{"water":5}}');
    expect(makeStore().load()).toEqual({});
  });

  it('reports failed writes instead of throwing', () => {
    storage.failWrites = true;
    expect(makeStore().save({ water: 1 })).toBe(false);
  });

  it('checks data from elsewhere: valid, migrated, invalid or too new', () => {
    const store = makeStore({
      migrate: (old, version) =>
        version === 1 && Array.isArray(old)
          ? Object.fromEntries(old as [string, number][])
          : undefined,
    });
    expect(store.version).toBe(2);
    expect(store.empty()).toEqual({});
    expect(store.read(2, { water: 1 })).toEqual({ water: 1 });
    expect(store.read(1, [['water', 5]])).toEqual({ water: 5 });
    expect(store.read(2, { water: 'lots' })).toBeUndefined();
    expect(store.read(3, { water: 1 })).toBeUndefined();
    expect(store.read(1.5, { water: 1 })).toBeUndefined();
  });

  it('says whether what’s saved can be read', () => {
    const store = makeStore();
    expect(store.status()).toBe('empty');
    store.save({ water: 1 });
    expect(store.status()).toBe('ok');
    storage.setItem('shkriuss:counts', '{"v":3,"data":{"water":1}}');
    expect(store.status()).toBe('newer');
    storage.setItem('shkriuss:counts', '{"v":2,"data":{"water":"lots"}}');
    expect(store.status()).toBe('unreadable');
    storage.setItem('shkriuss:counts', 'not json');
    expect(store.status()).toBe('unreadable');
  });

  it('never saves over data from a newer version of the app (say, after a rollback)', () => {
    makeStore({ version: 3 }).save({ water: 5, tea: 2 });
    const saved = storage.getItem('shkriuss:counts');
    const older = makeStore();
    expect(older.load()).toEqual({});
    expect(older.save({ coffee: 1 })).toBe(false);
    expect(storage.getItem('shkriuss:counts')).toBe(saved);
    expect(makeStore({ version: 3 }).load()).toEqual({ water: 5, tea: 2 });
  });

  it('never saves over data it can’t read: a migration that fails, or one bad value', () => {
    storage.setItem('shkriuss:counts', '{"v":1,"data":[["water",5]]}');
    const buggy = makeStore({
      migrate: () => {
        throw new TypeError('Cannot read properties of undefined');
      },
    });
    expect(buggy.load()).toEqual({});
    expect(buggy.status()).toBe('unreadable');
    expect(buggy.save({ coffee: 1 })).toBe(false);
    const fixed = makeStore({ migrate: (old) => Object.fromEntries(old as [string, number][]) });
    expect(fixed.load()).toEqual({ water: 5 });

    // Saved by an older version that didn't check its values (like Budget's
    // amount of 0): the rest of the data is still there for a fixed version.
    const bad = '{"v":2,"data":{"water":5,"tea":"lots"}}';
    storage.setItem('shkriuss:counts', bad);
    expect(makeStore().save({ coffee: 1 })).toBe(false);
    expect(storage.getItem('shkriuss:counts')).toBe(bad);
  });

  it('never saves a value that fails its own checks, as it would be read back', () => {
    const store = makeStore();
    store.save({ water: 1 });
    expect(store.save({ water: 'lots' } as unknown as Counts)).toBe(false);
    // JSON saves NaN as null, which the checks would turn down when loading.
    expect(store.save({ water: Number.NaN })).toBe(false);
    expect(store.load()).toEqual({ water: 1 });
  });

  it('clears its key', () => {
    const store = makeStore();
    store.save({ a: 1 });
    store.clear();
    expect(storage.getItem('shkriuss:counts')).toBeNull();
  });
});

describe('exportAll / deleteAll', () => {
  it('exports and deletes only our own keys', () => {
    makeStore().save({ water: 2 });
    storage.setItem('shkriuss:theme', 'dark');
    storage.setItem('someone-else', 'keep me');

    expect(ownKeys(storage)).toEqual(['shkriuss:counts', 'shkriuss:theme']);

    const file = exportAll('tally', storage, new Date('2026-01-02T03:04:05Z'));
    expect(file).toEqual({
      app: 'tally',
      exportedAt: '2026-01-02T03:04:05.000Z',
      data: {
        'shkriuss:counts': { v: 2, data: { water: 2 } },
        'shkriuss:theme': 'dark',
      },
    });

    expect(deleteAll(storage)).toBe(2);
    expect(ownKeys(storage)).toEqual([]);
    expect(storage.getItem('someone-else')).toBe('keep me');
  });

  it('copes with storage being unavailable', () => {
    expect(ownKeys(undefined)).toEqual([]);
    expect(deleteAll(undefined)).toBe(0);
    expect(exportAll('x', undefined, new Date(0)).data).toEqual({});
  });
});
