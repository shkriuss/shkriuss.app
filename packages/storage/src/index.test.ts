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
