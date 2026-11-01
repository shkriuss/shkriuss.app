import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allSaved,
  createStore,
  deleteAll,
  DOWNLOAD_URL_MS,
  downloadFile,
  exportAll,
  getLocalStorage,
  lastSaveProblem,
  ownKeys,
  type StorageLike,
} from './index.ts';

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

  it('reports failed writes instead of throwing, and says why', () => {
    storage.failWrites = true;
    expect(makeStore().save({ water: 1 })).toBe(false);
    expect(lastSaveProblem()).toBe('full');
    storage.setItem = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    expect(makeStore().save({ water: 1 })).toBe(false);
    expect(lastSaveProblem()).toBe('unavailable');
  });

  it('knows whether everything is saved: each store, until it saves again', () => {
    const counts = makeStore();
    const others = makeStore({ key: 'others' });
    expect(counts.save({ water: 1 })).toBe(true);
    expect(allSaved()).toBe(true);
    storage.failWrites = true;
    expect(counts.save({ water: 2 })).toBe(false);
    expect(allSaved()).toBe(false);
    storage.failWrites = false;
    // Another store saving doesn't save what this one holds.
    expect(others.save({ tea: 1 })).toBe(true);
    expect(allSaved()).toBe(false);
    expect(counts.save({ water: 2 })).toBe(true);
    expect(allSaved()).toBe(true);
  });

  it('says why it didn’t save: data it mustn’t save over, or a value that fails its checks', () => {
    storage.setItem('shkriuss:counts', '{"v":3,"data":{"water":1}}');
    expect(makeStore().save({ water: 2 })).toBe(false);
    expect(lastSaveProblem()).toBe('newer');
    storage.setItem('shkriuss:counts', 'not json');
    expect(makeStore().save({ water: 2 })).toBe(false);
    expect(lastSaveProblem()).toBe('unreadable');
    storage.removeItem('shkriuss:counts');
    expect(makeStore().save({ water: Number.NaN })).toBe(false);
    expect(lastSaveProblem()).toBe('invalid');
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

  it('gives what’s saved as it was saved, for sync after a data version change', () => {
    const store = makeStore();
    expect(store.raw()).toBeNull();
    storage.setItem('shkriuss:counts', '{"v":1,"data":[["water",5]]}');
    expect(store.raw()).toEqual({ v: 1, data: [['water', 5]] });
    storage.setItem('shkriuss:counts', 'not json');
    expect(store.raw()).toBeNull();
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

  it('exports a saved text that isn’t an object or a list as it is, quotes and all (audit 5 E-8)', () => {
    storage.setItem('shkriuss:quoted', '"dark"');
    storage.setItem('shkriuss:number', '42');
    storage.setItem('shkriuss:list', '[1,2]');
    storage.setItem('shkriuss:theme', 'dark');
    expect(exportAll('x', storage, new Date(0)).data).toEqual({
      'shkriuss:quoted': '"dark"',
      'shkriuss:number': '42',
      'shkriuss:list': [1, 2],
      'shkriuss:theme': 'dark',
    });
  });
});

describe('downloadFile (audit 5 Z-2)', () => {
  const link = {
    href: '',
    download: '',
    hidden: false,
    clicks: 0,
    click: () => undefined,
    remove: () => undefined,
  };
  const listeners = new Map<string, () => void>();
  let revoke: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    link.clicks = 0;
    link.click = () => {
      link.clicks += 1;
    };
    listeners.clear();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:tally/backup');
    revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('document', { createElement: () => link, body: { append: () => undefined } });
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
      clearTimeout: (timer: number) => clearTimeout(timer),
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps the file’s address for a minute: long enough for an iPhone’s download prompt', () => {
    downloadFile('tally-backup-2026-10-27.json', '{}');
    expect(link).toMatchObject({
      href: 'blob:tally/backup',
      download: 'tally-backup-2026-10-27.json',
      clicks: 1,
    });
    // A second (what it was) is too soon for "Do you want to download…?".
    vi.advanceTimersByTime(DOWNLOAD_URL_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:tally/backup');
    expect(listeners.has('pagehide')).toBe(false);
  });

  // Audit 6 C-2: Repairs' "Save a copy" had a download of its own, freed
  // after 10 seconds.
  it('downloads a file the app has, like a photo, as it is, for as long', () => {
    const photo = new Blob(['jpeg'], { type: 'image/jpeg' });
    downloadFile('bus-105-2026-10-21-photo-1.jpg', photo);
    expect(URL.createObjectURL).toHaveBeenCalledWith(photo);
    expect(link).toMatchObject({ download: 'bus-105-2026-10-21-photo-1.jpg', clicks: 1 });
    vi.advanceTimersByTime(DOWNLOAD_URL_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith('blob:tally/backup');
  });

  it('frees it when the page goes away, once', () => {
    downloadFile('tally-backup-2026-10-27.json', '{}');
    listeners.get('pagehide')?.();
    expect(revoke).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DOWNLOAD_URL_MS);
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

describe('getLocalStorage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const use = (value: unknown) =>
    Object.defineProperty(globalThis, 'localStorage', { value, configurable: true });
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('gives storage that works', () => {
    use(storage);
    expect(getLocalStorage()).toBe(storage);
  });

  it('still gives storage that’s full, so what’s saved can be read', () => {
    storage.setItem('shkriuss:counts', '{"v":2,"data":{"water":3}}');
    storage.failWrites = true;
    use(storage);
    expect(getLocalStorage()).toBe(storage);
    const store = createStore<Counts>({
      key: 'counts',
      version: 2,
      fallback: () => ({}),
      validate: isCounts,
    });
    expect(store.load()).toEqual({ water: 3 });
    expect(store.save({ water: 4 })).toBe(false);
    expect(lastSaveProblem()).toBe('full');
  });

  it('gives nothing when storage is blocked', () => {
    storage.setItem = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    use(storage);
    expect(getLocalStorage()).toBeUndefined();
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new DOMException('Access is denied.', 'SecurityError');
      },
      configurable: true,
    });
    expect(getLocalStorage()).toBeUndefined();
  });
});

describe('keeping the data (audit 3 J-4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the browser to keep the site’s data after the first save, once a page', async () => {
    // The first audit's E-9: Safari deletes a website's data after a week
    // without a visit, unless it's on the Home Screen or kept.
    vi.resetModules();
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', { storage: { persisted: async () => false, persist } });
    const fresh = await import('./index.ts');
    const store = fresh.createStore<number>({
      key: 'kept',
      version: 1,
      fallback: () => 0,
      validate: (value): value is number => typeof value === 'number',
      storage: new MemoryStorage(),
    });
    expect(persist).not.toHaveBeenCalled();
    expect(store.save(1)).toBe(true);
    expect(store.save(2)).toBe(true);
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  });
});
