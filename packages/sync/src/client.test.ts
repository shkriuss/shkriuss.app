/**
 * The sync client with several pretend devices, each with its own storage,
 * talking to the real server code (worker.ts) kept in memory. Devices take
 * turns, like phones that sync one after another.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import { createStore, type StorageLike, type Store } from '@shkriuss/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSync, syncedStore, type SyncClient, type SyncStatus } from './client.ts';
import worker, { SyncCopy, type SyncEnv } from './worker.ts';

class MemoryStorage implements StorageLike {
  #map = new Map<string, string>();
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
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
}

// ---------- The server, in memory ----------

function memoryServer(): SyncEnv {
  const objects = new Map<string, SyncCopy>();
  const storageFor = () => {
    const map = new Map<string, unknown>();
    return {
      get: async <T>(key: string) => structuredClone(map.get(key)) as T | undefined,
      put: async (key: string, value: unknown) => void map.set(key, structuredClone(value)),
      deleteAll: async () => map.clear(),
      setAlarm: async () => undefined,
      deleteAlarm: async () => undefined,
    };
  };
  return {
    ASSETS: { fetch: async () => new Response('page') },
    SYNC_COPIES: {
      idFromName: (name: string) => ({ toString: () => name }),
      get: (id) => ({
        fetch: (input: string, init?: RequestInit) => {
          const name = id.toString();
          const object =
            objects.get(name) ??
            new SyncCopy({
              storage: storageFor(),
              blockConcurrencyWhile: (callback) => callback(),
            });
          objects.set(name, object);
          return object.fetch(new Request(input, init));
        },
      }),
    },
  };
}

// ---------- Pretend devices ----------

interface Counter {
  id: string;
  name: string;
  count: number;
}
interface Counters {
  counters: Counter[];
}

const ORIGIN = 'https://tally.shkriuss.app';
let server: SyncEnv;
let offline = false;

class Device {
  readonly storage = new MemoryStorage();
  readonly store: Store<Counters>;
  readonly sync: SyncClient;
  changes = 0;
  status: SyncStatus | undefined;

  constructor(appSecret: Uint8Array<ArrayBuffer>, version = 1) {
    this.use();
    this.store = createStore<Counters>({
      key: 'tally',
      version,
      fallback: () => ({ counters: [] }),
      validate: (value): value is Counters =>
        typeof value === 'object' && value !== null && Array.isArray((value as Counters).counters),
    });
    this.storage.setItem(
      'shkriuss-device:sync',
      JSON.stringify({ secret: toBase64Url(appSecret), code: 'K7Q2-M9XD' }),
    );
    this.sync = createSync({
      app: 'tally',
      stores: [
        syncedStore({
          store: this.store,
          items: (value) => value.counters,
          withItems: (value, counters) => ({ ...value, counters }),
        }),
      ],
      onChange: () => {
        this.changes += 1;
      },
    });
    this.sync.subscribe((status) => {
      this.status = status;
    });
  }

  /** Makes this device's storage the one the code sees. */
  use(): this {
    vi.stubGlobal('localStorage', this.storage);
    return this;
  }

  get counters(): Counter[] {
    this.use();
    return this.store.load().counters;
  }

  set counters(counters: Counter[]) {
    this.use();
    this.store.save({ counters });
  }

  async syncNow(): Promise<SyncStatus> {
    this.use();
    await this.sync.syncNow();
    return this.sync.status();
  }
}

const counter = (id: string, count = 0): Counter => ({ id, name: id, count });

beforeEach(() => {
  server = memoryServer();
  offline = false;
  const noop = () => 0;
  vi.stubGlobal('window', {
    setTimeout: noop,
    clearTimeout: noop,
    setInterval: noop,
    addEventListener: noop,
  });
  vi.stubGlobal('document', { addEventListener: noop, visibilityState: 'visible' });
  vi.stubGlobal('location', { hash: '', pathname: '/', search: '', origin: ORIGIN });
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    if (offline) throw new TypeError('Failed to fetch');
    return worker.fetch(new Request(new URL(input, ORIGIN), init), server);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('syncing between devices', () => {
  it('adds, changes and deletes on every device', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);

    phone.counters = [counter('water'), counter('steps')];
    expect((await phone.syncNow()).problem).toBeNull();
    await tablet.syncNow();
    expect(tablet.counters).toEqual([counter('water'), counter('steps')]);
    expect(tablet.changes).toBe(1);

    tablet.counters = [counter('water', 3)];
    await tablet.syncNow();
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('water', 3)]);
    expect(phone.status?.last).not.toBeNull();
  });

  it('merges when two devices changed different things before syncing', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    phone.counters = [counter('a'), counter('b')];
    await phone.syncNow();
    await tablet.syncNow();

    phone.counters = [counter('a', 1), counter('b')];
    tablet.counters = [counter('a'), counter('b', 2), counter('c')];
    await phone.syncNow();
    await tablet.syncNow();
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a', 1), counter('b', 2), counter('c')]);
    expect(tablet.counters).toEqual(phone.counters);
  });

  it('never mistakes a merge that failed to upload for new edits', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    const laptop = new Device(secret);
    phone.counters = [counter('water')];
    await phone.syncNow();
    await tablet.syncNow();
    await laptop.syncNow();

    // The tablet changes water; the phone merges that in, but its upload fails.
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [counter('water', 1)];
    await tablet.syncNow();
    phone.use();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.method === 'PUT') throw new TypeError('Failed to fetch');
      return realFetch(input, init);
    });
    phone.counters = [counter('water', 1), counter('juice')];
    expect((await phone.syncNow()).problem).toBe('offline');
    vi.stubGlobal('fetch', realFetch);

    // Meanwhile the laptop changes water again, later.
    vi.setSystemTime(Date.now() + 2000);
    await laptop.syncNow();
    laptop.counters = laptop.counters.map((item) =>
      item.id === 'water' ? counter('water', 9) : item,
    );
    await laptop.syncNow();

    // The phone's retry must keep the laptop's newer count.
    vi.setSystemTime(Date.now() + 3000);
    expect((await phone.syncNow()).problem).toBeNull();
    expect(phone.counters).toEqual([counter('water', 9), counter('juice')]);
    vi.useRealTimers();
  });

  it('says when offline, and catches up later', async () => {
    const phone = new Device(randomBytes(32));
    phone.counters = [counter('water')];
    offline = true;
    expect((await phone.syncNow()).problem).toBe('offline');
    offline = false;
    expect((await phone.syncNow()).problem).toBeNull();
  });

  it('waits instead of overwriting data from a newer version of the app', async () => {
    const secret = randomBytes(32);
    const newer = new Device(secret, 2);
    newer.counters = [counter('water', 5)];
    await newer.syncNow();
    const older = new Device(secret, 1);
    older.counters = [counter('water', 1)];
    expect((await older.syncNow()).problem).toBe('update-needed');
    expect(older.counters).toEqual([counter('water', 1)]);
    await newer.syncNow();
    expect(newer.counters).toEqual([counter('water', 5)]);
  });

  it('stops on every device when the online copy is deleted, keeping their data', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    phone.counters = [counter('water')];
    await phone.syncNow();
    await tablet.syncNow();

    phone.use();
    await phone.sync.deleteOnline();
    expect(phone.sync.status().on).toBe(false);
    const status = await tablet.syncNow();
    expect(status).toMatchObject({ on: false, problem: 'deleted' });
    expect(tablet.counters).toEqual([counter('water')]);
  });

  it('keeps separate accounts apart', async () => {
    const mine = new Device(randomBytes(32));
    const theirs = new Device(randomBytes(32));
    mine.counters = [counter('mine')];
    theirs.counters = [counter('theirs')];
    await mine.syncNow();
    await theirs.syncNow();
    await mine.syncNow();
    expect(mine.counters).toEqual([counter('mine')]);
  });
});
