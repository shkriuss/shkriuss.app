/**
 * The sync client with several pretend devices, each with its own storage,
 * talking to the real server code (worker.ts) kept in memory. Devices take
 * turns, like phones that sync one after another.
 */
import { equalBytes, randomBytes, toBase64Url, utf8 } from '@shkriuss/crypto';
import { createWorker } from '@shkriuss/server';
import { createStore, deleteAll, type StorageLike, type Store } from '@shkriuss/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSync,
  saveConnection,
  stopSync,
  syncedStore,
  type LinkedData,
  type SyncClient,
  type SyncStatus,
} from './client.ts';
import { turnOffProof } from './connect.ts';
import { syncKeys } from './snapshot.ts';
import type { FileList } from './validate.ts';
import worker, { SyncCopy, syncHandler, type SyncEnv } from './worker.ts';

/** An app's Worker with files on (worker.ts's default has them off). */
const withFiles = createWorker<SyncEnv>({ '/api/sync': syncHandler({ files: true }) });

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
      delete: async (key: string) => map.delete(key),
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
  /** Ids of files, for apps with files. */
  photos?: string[];
  /** Added by data version 2, in tests with a migration. */
  color?: string | null;
}
interface Counters {
  counters: Counter[];
}
/** A store's migration of data saved with an older data version. */
type Migrate = (old: unknown, version: number) => Counters | undefined;

const ORIGIN = 'https://tally.shkriuss.app';
let server: SyncEnv;
let offline = false;

class Device {
  readonly storage: MemoryStorage;
  readonly store: Store<Counters>;
  readonly sync: SyncClient;
  readonly keepBoth: boolean;
  changes = 0;
  /** What the page shows: like the real apps, it keeps its own copy and reloads it in onChange. */
  shown: Counter[];
  status: SyncStatus | undefined;
  events: string[] = [];
  /** Files on this device, for apps with files. */
  readonly files = new Map<string, Uint8Array<ArrayBuffer>>();

  /** `reopened`: the browser storage of an earlier Device, after the app was updated (see reopen()). */
  constructor(
    appSecret: Uint8Array<ArrayBuffer> | null,
    version = 1,
    keepBoth = false,
    withFiles = false,
    linked?: LinkedData,
    reopened?: { storage: MemoryStorage; migrate?: Migrate },
  ) {
    this.storage = reopened?.storage ?? new MemoryStorage();
    this.keepBoth = keepBoth;
    this.use();
    this.store = createStore<Counters>({
      key: 'tally',
      version,
      fallback: () => ({ counters: [] }),
      validate: (value): value is Counters =>
        typeof value === 'object' &&
        value !== null &&
        Array.isArray((value as Counters).counters) &&
        (value as Counters).counters.every((item) => typeof item?.count === 'number'),
      ...(reopened?.migrate ? { migrate: reopened.migrate } : {}),
    });
    if (appSecret) {
      this.storage.setItem(
        'shkriuss-device:sync',
        JSON.stringify({ secret: toBase64Url(appSecret), code: 'K7Q2-M9XD' }),
      );
    }
    this.sync = createSync({
      app: 'tally',
      stores: [
        syncedStore({
          store: this.store,
          items: (value) => value.counters,
          withItems: (value, counters) => ({ ...value, counters }),
          ...(keepBoth
            ? {
                conflictCopy: (mine: Counter) => ({
                  ...mine,
                  id: `${mine.id}-2`,
                  name: `${mine.name} (2)`,
                }),
              }
            : {}),
        }),
      ],
      onChange: () => {
        this.changes += 1;
        this.shown = this.store.load().counters;
      },
      ...(withFiles
        ? {
            files: {
              wanted: () => new Set(this.counters.flatMap((item) => item.photos ?? [])),
              read: async (id: string) => this.files.get(id) ?? null,
            },
          }
        : {}),
      ...(linked ? { linked } : {}),
    });
    this.sync.subscribe((status, event) => {
      this.status = status;
      if (event) this.events.push(event);
    });
    this.shown = this.store.load().counters;
  }

  /** The person changes something on the page, which saves what it shows. */
  edit(change: (counters: Counter[]) => Counter[]): void {
    this.use();
    this.shown = change(this.shown);
    this.store.save({ counters: this.shown });
    this.sync.changed();
  }

  /** This browser, after the app was updated (or rolled back) to another data version. */
  reopen(version: number, migrate?: Migrate): Device {
    const reopened = { storage: this.storage, ...(migrate ? { migrate } : {}) };
    return new Device(null, version, this.keepBoth, false, undefined, reopened);
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
    this.sync.changed();
  }

  /** Comes back from "Turn on sync" on the hub with this app key. */
  connect(appSecret: Uint8Array<ArrayBuffer>, replaces: Uint8Array<ArrayBuffer>[] = []): void {
    this.use();
    expect(saveConnection({ secret: appSecret, code: 'N3W5-K3Y8', replaces })).toBe(true);
  }

  async syncNow(): Promise<SyncStatus> {
    this.use();
    await this.sync.syncNow();
    return this.sync.status();
  }

  /** Saves a file here, used by an item, as an app does. */
  addFile(item: string, id: string, bytes: Uint8Array<ArrayBuffer>): void {
    this.use();
    this.files.set(id, bytes);
    this.sync.filesAdded([id]);
    this.counters = this.counters.map((counter) =>
      counter.id === item ? { ...counter, photos: [...(counter.photos ?? []), id] } : counter,
    );
  }

  /** Deletes a file here, and from its item. */
  removeFile(id: string): void {
    this.use();
    this.files.delete(id);
    this.sync.filesRemoved([id]);
    this.counters = this.counters.map((counter) => ({
      ...counter,
      photos: (counter.photos ?? []).filter((photo) => photo !== id),
    }));
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
    return withFiles.fetch(new Request(new URL(input, ORIGIN), init), server);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

  it('turned off and on again, still syncs what was deleted in between', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    phone.counters = [counter('a'), counter('b')];
    await phone.syncNow();
    await tablet.syncNow();

    tablet.use().sync.turnOff();
    expect(tablet.sync.status().on).toBe(false);
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [counter('a', 4)];
    tablet.connect(secret);
    await tablet.syncNow();
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a', 4)]);
    vi.useRealTimers();
  });

  it('turns off from the Account page’s link, only if it’s from this account', async () => {
    const secret = randomBytes(32);
    // Run what the client starts "a moment later".
    vi.stubGlobal('window', { ...window, setTimeout: (run: () => void) => void run() });
    vi.stubGlobal('history', { replaceState: () => undefined });
    const opened = (proof: string) => {
      vi.stubGlobal('location', {
        hash: `#sync=off&proof=${proof}`,
        pathname: '/',
        search: '',
        origin: ORIGIN,
      });
      return new Device(secret);
    };

    const fromSomeoneElse = opened(await turnOffProof(randomBytes(32)));
    await vi.waitFor(() => expect(fromSomeoneElse.events).toContain('kept-on'));
    expect(fromSomeoneElse.sync.status().on).toBe(true);

    const fromThisAccount = opened(await turnOffProof(secret));
    await vi.waitFor(() => expect(fromThisAccount.events).toEqual(['turned-off']));
    expect(fromThisAccount.sync.status().on).toBe(false);
  });

  it('moves everything to a new account key, and stops the old copy', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const lost = new Device(oldKey);
    const tablet = new Device(oldKey);
    const laptop = new Device(oldKey);
    lost.counters = [counter('water')];
    await lost.syncNow();
    await tablet.syncNow();
    await laptop.syncNow();
    // Only the old copy has the laptop's latest changes.
    vi.setSystemTime(Date.now() + 1000);
    laptop.counters = [counter('water', 2), counter('steps')];
    await laptop.syncNow();

    // On the tablet, the account key is replaced, and the app connects again.
    tablet.connect(newKey, [oldKey]);
    expect((await tablet.syncNow()).problem).toBeNull();
    expect(tablet.counters).toEqual([counter('water', 2), counter('steps')]);

    // Devices still on the old key stop, and say why.
    expect(await lost.syncNow()).toMatchObject({ on: false, problem: 'moved' });
    expect(await laptop.syncNow()).toMatchObject({ on: false, problem: 'moved' });
    expect(laptop.counters).toEqual([counter('water', 2), counter('steps')]);

    // Edits on the laptop while sync was off come along when it connects again.
    vi.setSystemTime(Date.now() + 2000);
    laptop.counters = [counter('water', 3)];
    laptop.connect(newKey, [oldKey]);
    expect((await laptop.syncNow()).problem).toBeNull();
    await tablet.syncNow();
    expect(tablet.counters).toEqual([counter('water', 3)]);
    vi.useRealTimers();
  });

  it('a lost device can’t start the moved copy again', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const tablet = new Device(oldKey);
    const laptop = new Device(oldKey);
    tablet.counters = [counter('water')];
    await tablet.syncNow();
    await laptop.syncNow();
    tablet.connect(newKey, [oldKey]);
    expect((await tablet.syncNow()).problem).toBeNull();

    // The lost device still has the old key: it tries to start that copy again,
    // first deleting the note that it moved.
    const restart = { method: 'PUT', body: JSON.stringify({ base: null, data: 'A'.repeat(40) }) };
    expect((await call(oldKey, '/copy', restart, worker)).status).toBe(410);
    expect((await call(oldKey, '/copy', { method: 'DELETE' }, worker)).status).toBe(204);
    const again = await call(oldKey, '/copy', restart, worker);
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ moved: true });

    // So the person's other devices still hear that it moved.
    expect(await laptop.syncNow()).toMatchObject({ on: false, problem: 'moved' });
  });

  it('finishes moving to a new key after a dropped connection', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const phone = new Device(oldKey);
    const tablet = new Device(oldKey);
    tablet.counters = [counter('water')];
    await tablet.syncNow();

    phone.connect(newKey, [oldKey]);
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new TypeError('Failed to fetch');
      return realFetch(input, init);
    });
    expect((await phone.syncNow()).problem).toBe('offline');
    expect(phone.counters).toEqual([counter('water')]);
    expect((await tablet.syncNow()).problem).toBeNull();

    vi.stubGlobal('fetch', realFetch);
    expect((await phone.syncNow()).problem).toBeNull();
    expect((await tablet.syncNow()).problem).toBe('moved');
  });

  it('deleting the online copy before a move finishes deletes the old copy too', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const lost = new Device(oldKey);
    const tablet = new Device(oldKey);
    lost.counters = [counter('water')];
    await lost.syncNow();
    await tablet.syncNow();

    // The key is replaced, but the tablet's first sync with the new one fails.
    tablet.connect(newKey, [oldKey]);
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await tablet.syncNow()).problem).toBe('offline');
    vi.stubGlobal('fetch', realFetch);

    tablet.use();
    await tablet.sync.deleteOnline();
    // The old copy is gone too, so the lost device can't read it.
    expect((await call(oldKey, '/copy', {}, worker)).status).toBe(410);
    expect((await lost.syncNow()).on).toBe(false);
    expect(tablet.counters).toEqual([counter('water')]);
  });

  it('connecting to another account leaves the old one’s copy alone', async () => {
    const mine = randomBytes(32);
    const phone = new Device(mine);
    const tablet = new Device(mine);
    phone.counters = [counter('water')];
    await phone.syncNow();
    await tablet.syncNow();

    const other = new Device(randomBytes(32));
    other.counters = [counter('theirs')];
    other.connect(randomBytes(32));
    phone.connect(randomBytes(32));
    expect((await phone.syncNow()).problem).toBeNull();
    expect(await tablet.syncNow()).toMatchObject({ on: true, problem: null });
    expect(tablet.counters).toEqual([counter('water')]);
  });

  it('keeps both versions when an app asks to', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, true);
    const tablet = new Device(secret, 1, true);
    phone.counters = [counter('water'), counter('tea')];
    await phone.syncNow();
    await tablet.syncNow();

    // Both change water, and the phone deletes tea while the tablet counts it.
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('water', 2)];
    tablet.counters = [counter('water', 5), counter('tea', 1)];
    await phone.syncNow();
    await tablet.syncNow();
    expect(tablet.events).toContain('kept-both');
    await phone.syncNow();
    const both = [
      counter('water', 2),
      counter('tea', 1),
      { ...counter('water-2', 5), name: 'water (2)' },
    ];
    expect(tablet.counters).toEqual(both);
    expect(phone.counters).toEqual(both);

    // Nothing more is copied on later syncs.
    await tablet.syncNow();
    await phone.syncNow();
    expect(phone.counters).toEqual(both);
    vi.useRealTimers();
  });

  it('keeps both versions when this device’s upload had failed', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, true);
    const tablet = new Device(secret, 1, true);
    phone.counters = [counter('water')];
    await phone.syncNow();
    await tablet.syncNow();

    // The tablet's change doesn't get online: its upload fails.
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [counter('water', 5)];
    const restore = intercept((_path, init) =>
      init?.method === 'PUT' ? new Response('{}', { status: 503 }) : undefined,
    );
    expect((await tablet.syncNow()).problem).toBe('offline');
    restore();
    // Meanwhile the phone changes it too.
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('water', 2)];
    await phone.syncNow();

    vi.setSystemTime(Date.now() + 1000);
    await tablet.syncNow();
    expect(tablet.counters).toEqual([
      counter('water', 2),
      { ...counter('water-2', 5), name: 'water (2)' },
    ]);
  });

  it('makes no copies of another device’s edits merged in before an upload failed', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, true);
    const tablet = new Device(secret, 1, true);
    phone.counters = [counter('water'), counter('tea')];
    await phone.syncNow();
    await tablet.syncNow();

    // The tablet merges in the phone's change, but its own upload fails.
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('water', 2), counter('tea')];
    await phone.syncNow();
    tablet.counters = [counter('water'), counter('tea', 1)];
    const restore = intercept((_path, init) =>
      init?.method === 'PUT' ? new Response('{}', { status: 503 }) : undefined,
    );
    await tablet.syncNow();
    restore();
    expect(tablet.counters).toEqual([counter('water', 2), counter('tea', 1)]);

    // The phone changes water again: only the phone changed it.
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('water', 3), counter('tea')];
    await phone.syncNow();
    vi.setSystemTime(Date.now() + 1000);
    await tablet.syncNow();
    expect(tablet.counters).toEqual([counter('water', 3), counter('tea', 1)]);
    expect(tablet.events).not.toContain('kept-both');
  });

  it('keeps both versions of what was changed while sync was off', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, true);
    const tablet = new Device(secret, 1, true);
    phone.counters = [counter('water')];
    await phone.syncNow();
    await tablet.syncNow();

    tablet.sync.turnOff();
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [counter('water', 5)];
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('water', 2)];
    await phone.syncNow();

    vi.setSystemTime(Date.now() + 1000);
    tablet.connect(secret);
    await tablet.syncNow();
    expect(tablet.counters).toEqual([
      counter('water', 2),
      { ...counter('water-2', 5), name: 'water (2)' },
    ]);
  });

  it('makes no copies on the first sync after updating from an older version', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, true);
    const tablet = new Device(secret, 1, true);
    phone.counters = [counter('water')];
    await phone.syncNow();
    await tablet.syncNow();
    // What older versions saved: no data version in what the tablet knew.
    const saved = JSON.parse(tablet.storage.getItem('shkriuss-device:sync') ?? '{}') as {
      known: Record<string, { v?: number }>;
    };
    for (const known of Object.values(saved.known)) delete known.v;
    tablet.storage.setItem('shkriuss-device:sync', JSON.stringify(saved));

    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('water', 2)];
    await phone.syncNow();
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [counter('water', 5)];
    await tablet.syncNow();
    expect(tablet.counters).toEqual([counter('water', 5)]);
    vi.useRealTimers();
  });

  it('lets the newest change win when keeping both isn’t asked for', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    phone.counters = [counter('water')];
    await phone.syncNow();
    await tablet.syncNow();
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('water', 2)];
    await phone.syncNow();
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [counter('water', 5)];
    await tablet.syncNow();
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('water', 5)]);
    vi.useRealTimers();
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

describe('turning sync off while a sync is under way', () => {
  it('“Delete all data” stays done, and the other devices keep their data', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    phone.counters = [counter('a'), counter('b')];
    await phone.syncNow();
    await tablet.syncNow();

    // The person confirms "Delete all data" while the tablet's sync waits for
    // the server (DataControls: stopSync, then deleteAll).
    let deleted = false;
    const restore = intercept((path) => {
      if (!deleted && path.startsWith('/api/sync/copy')) {
        deleted = true;
        stopSync();
        deleteAll();
      }
      return undefined;
    });
    await tablet.syncNow();
    restore();
    expect(tablet.sync.status().on).toBe(false);

    // The page reloads, empty as asked, and the phone syncs.
    expect((await tablet.syncNow()).on).toBe(false);
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a'), counter('b')]);
  });

  for (const during of ['GET', 'PUT']) {
    it(`“Turn off” stays off (tapped during the ${during})`, async () => {
      const secret = randomBytes(32);
      const phone = new Device(secret);
      const tablet = new Device(secret);
      phone.counters = [counter('a')];
      await phone.syncNow();
      await tablet.syncNow();

      vi.setSystemTime(Date.now() + 1000);
      phone.counters = [counter('a', 1)];
      await phone.syncNow();
      tablet.counters = [counter('a'), counter('b')];
      let tapped = false;
      const restore = intercept((path, init) => {
        if (!tapped && path.startsWith('/api/sync/copy') && (init?.method ?? 'GET') === during) {
          tapped = true;
          tablet.sync.turnOff();
        }
        return undefined;
      });
      await tablet.syncNow();
      restore();
      expect(tablet.sync.status()).toMatchObject({ on: false, problem: null });
      // Nothing from the online copy is saved here once sync is off.
      if (during === 'GET') expect(tablet.counters).toEqual([counter('a'), counter('b')]);
      vi.useRealTimers();
    });
  }
});

describe('showing changes from other devices', () => {
  /** Two devices with a and b; then the phone adds c and deletes b. */
  async function phoneAddsCDeletesB() {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    phone.counters = [counter('a'), counter('b')];
    await phone.syncNow();
    await tablet.syncNow();
    expect(tablet.shown).toEqual([counter('a'), counter('b')]);
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('a'), counter('c')];
    await phone.syncNow();
    vi.setSystemTime(Date.now() + 1000);
    return { phone, tablet };
  }
  const count = (id: string, value: number) => (counters: Counter[]) =>
    counters.map((item) => (item.id === id ? { ...item, count: value } : item));

  it('as soon as they’re saved here, even if the upload then fails', async () => {
    const { phone, tablet } = await phoneAddsCDeletesB();
    // The tablet counts a. Its sync merges in the phone's changes, but the
    // upload fails ("too many changes", or a weak signal).
    tablet.edit(count('a', 1));
    const restore = intercept((_path, init) =>
      init?.method === 'PUT' ? new Response('{}', { status: 429 }) : undefined,
    );
    expect((await tablet.syncNow()).problem).toBe('server');
    restore();
    expect(tablet.shown).toEqual([counter('a', 1), counter('c')]);

    // The next count is saved from what the page shows: c stays, b stays deleted.
    vi.setSystemTime(Date.now() + 1000);
    tablet.edit(count('a', 2));
    await tablet.syncNow();
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a', 2), counter('c')]);
  });

  it('before the upload, so an edit made while it uploads keeps them', async () => {
    const { phone, tablet } = await phoneAddsCDeletesB();
    tablet.edit(count('a', 1));
    let tapped = false;
    const restore = intercept((_path, init) => {
      if (init?.method === 'PUT' && !tapped) {
        tapped = true;
        tablet.edit(count('a', 2));
      }
      return undefined;
    });
    await tablet.syncNow();
    restore();
    vi.setSystemTime(Date.now() + 1000);
    await tablet.syncNow();
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a', 2), counter('c')]);
  });
});

describe('data this version of the app can’t read', () => {
  /** Two devices in step with a and b. */
  async function inStep(version = 1) {
    const secret = randomBytes(32);
    const phone = new Device(secret, version);
    const tablet = new Device(secret, version);
    phone.counters = [counter('a'), counter('b')];
    await phone.syncNow();
    await tablet.syncNow();
    return { secret, phone, tablet };
  }
  const TALLY = 'shkriuss:tally';

  it('from a newer version (after a rollback) is never synced or saved over', async () => {
    const { phone, tablet } = await inStep(2);
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [counter('a', 1), counter('b')];
    await tablet.syncNow();

    // The change that brought data version 2 is rolled back. The app syncs as
    // it opens: it must wait, not upload its empty view of the data.
    const rolledBack = tablet.reopen(1);
    expect(await rolledBack.syncNow()).toMatchObject({ on: true, problem: 'update-needed' });
    expect(rolledBack.store.save({ counters: [counter('c')] })).toBe(false);
    expect((await rolledBack.syncNow()).problem).toBe('update-needed');
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a', 1), counter('b')]);

    // The fix is deployed: version 2 again, and nothing was lost.
    const fixed = tablet.reopen(2);
    expect((await fixed.syncNow()).problem).toBeNull();
    expect(fixed.counters).toEqual([counter('a', 1), counter('b')]);
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a', 1), counter('b')]);
  });

  it('waits, too, when this device last synced with a newer version', async () => {
    const { phone, tablet } = await inStep();
    // What a newer version remembers after syncing (its data here unchanged).
    const state = JSON.parse(tablet.storage.getItem('shkriuss-device:sync') ?? '{}') as {
      known: Record<string, { v?: number }>;
    };
    for (const known of Object.values(state.known)) known.v = 2;
    tablet.storage.setItem('shkriuss-device:sync', JSON.stringify(state));
    expect((await tablet.syncNow()).problem).toBe('update-needed');
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a'), counter('b')]);
  });

  it('that it can’t read (a migration that fails, or one bad value) is kept, not synced', async () => {
    const { phone, tablet } = await inStep();
    const broken = tablet.reopen(2, () => {
      throw new TypeError('Cannot read properties of undefined');
    });
    expect(broken.counters).toEqual([]);
    expect((await broken.syncNow()).problem).toBe('unreadable');
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a'), counter('b')]);

    // Saved by a version that didn't check a value (like Budget's amount of 0).
    const saved = tablet.storage.getItem(TALLY);
    const bad = { ...counter('b'), count: 'lots' };
    tablet.storage.setItem(
      TALLY,
      JSON.stringify({ v: 1, data: { counters: [counter('a'), bad] } }),
    );
    expect((await tablet.syncNow()).problem).toBe('unreadable');
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a'), counter('b')]);
    tablet.storage.setItem(TALLY, saved ?? '');
    expect((await tablet.syncNow()).problem).toBeNull();
  });

  it('while sync is off, isn’t taken as everything deleted', async () => {
    const { secret, phone, tablet } = await inStep();
    tablet.sync.turnOff();
    const saved = tablet.storage.getItem(TALLY);
    const bad = { ...counter('b'), count: 'lots' };
    tablet.storage.setItem(
      TALLY,
      JSON.stringify({ v: 1, data: { counters: [counter('a'), bad] } }),
    );
    tablet.edit((counters) => [...counters, counter('c')]); // couldn't save
    // An update reads it again. Meanwhile a was counted on the phone.
    tablet.storage.setItem(TALLY, saved ?? '');
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('a', 5), counter('b')];
    await phone.syncNow();

    vi.setSystemTime(Date.now() + 1000);
    tablet.connect(secret);
    expect((await tablet.syncNow()).problem).toBeNull();
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a', 5), counter('b')]);
  });
});

describe('the first sync after a data version change', () => {
  // Version 2 adds a colour to every counter, the way Calendar 2 added reminders.
  const toVersion2: Migrate = (old, version) =>
    version === 1
      ? { counters: (old as Counters).counters.map((item) => ({ ...item, color: null })) }
      : undefined;
  const v2 = (item: Counter): Counter => ({ ...item, color: null });
  const DAY = 24 * HOUR;

  for (const keepBoth of [false, true]) {
    it(`doesn’t count every item as edited${keepBoth ? ' (keeping both)' : ''}`, async () => {
      const secret = randomBytes(32);
      const phone = new Device(secret, 1, keepBoth);
      const tablet = new Device(secret, 1, keepBoth);
      phone.counters = [counter('a'), counter('b')];
      await phone.syncNow();
      await tablet.syncNow();

      // A week of use on the phone: a counted, b deleted.
      vi.setSystemTime(Date.now() + 7 * DAY);
      phone.counters = [counter('a', 9)];
      await phone.syncNow();

      // The app is updated. A day later the tablet opens it and syncs; nothing
      // was changed on it, so the phone's newer edits must stay.
      vi.setSystemTime(Date.now() + DAY);
      const updated = tablet.reopen(2, toVersion2);
      expect((await updated.syncNow()).problem).toBeNull();
      expect(updated.counters).toEqual([v2(counter('a', 9))]);
      const phoneUpdated = phone.reopen(2, toVersion2);
      await phoneUpdated.syncNow();
      expect(phoneUpdated.counters).toEqual([v2(counter('a', 9))]);
    });

    it(`still counts what was changed here before updating${keepBoth ? ' (keeping both)' : ''}`, async () => {
      const secret = randomBytes(32);
      const phone = new Device(secret, 1, keepBoth);
      const tablet = new Device(secret, 1, keepBoth);
      phone.counters = [counter('a'), counter('b')];
      await phone.syncNow();
      await tablet.syncNow();

      // On the tablet, with no connection: a counted, b deleted.
      vi.setSystemTime(Date.now() + 1000);
      offline = true;
      tablet.counters = [counter('a', 3)];
      await tablet.syncNow();
      offline = false;

      vi.setSystemTime(Date.now() + 1000);
      expect((await tablet.reopen(2, toVersion2).syncNow()).problem).toBeNull();
      const phoneUpdated = phone.reopen(2, toVersion2);
      await phoneUpdated.syncNow();
      expect(phoneUpdated.counters).toEqual([v2(counter('a', 3))]);
    });
  }

  it('still counts an edit made after updating, before the first sync', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    phone.counters = [counter('a'), counter('b')];
    await phone.syncNow();
    await tablet.syncNow();

    // Opened after the update, and counted straight away (saved in version 2).
    vi.setSystemTime(Date.now() + 1000);
    const updated = tablet.reopen(2, toVersion2);
    updated.edit((counters) =>
      counters.map((item) => (item.id === 'a' ? { ...item, count: 4 } : item)),
    );
    expect((await updated.syncNow()).problem).toBeNull();
    const phoneUpdated = phone.reopen(2, toVersion2);
    await phoneUpdated.syncNow();
    expect(phoneUpdated.counters).toEqual([v2(counter('a', 4)), v2(counter('b'))]);
  });
});

describe('items with any id', () => {
  it('sync, even "__proto__" (a calendar file can give an event that id)', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, true);
    const tablet = new Device(secret, 1, true);
    phone.counters = [counter('a')];
    await phone.syncNow();
    await tablet.syncNow();
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('a'), counter('__proto__'), counter('constructor')];
    expect((await phone.syncNow()).problem).toBeNull();
    vi.setSystemTime(Date.now() + 1000);
    phone.counters = [counter('a', 1), counter('__proto__', 2), counter('constructor')];
    expect((await phone.syncNow()).problem).toBeNull();
    expect((await tablet.syncNow()).problem).toBeNull();
    expect(tablet.counters).toEqual([
      counter('a', 1),
      counter('__proto__', 2),
      counter('constructor'),
    ]);

    // Deleted on the tablet: gone on the phone too.
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [counter('a', 1)];
    await tablet.syncNow();
    await phone.syncNow();
    expect(phone.counters).toEqual([counter('a', 1)]);
  });
});

describe('a device whose clock is behind', () => {
  const MINUTE = 60 * 1000;
  const T0 = Date.UTC(2026, 9, 1, 12);
  /** The tablet's clock is 10 minutes slow (set by hand, say). */
  const SLOW = -10 * MINUTE;

  for (const keepBoth of [false, true]) {
    it(`keeps the edits it makes after syncing${keepBoth ? ' (keeping both)' : ''}`, async () => {
      const secret = randomBytes(32);
      const phone = new Device(secret, 1, keepBoth);
      const tablet = new Device(secret, 1, keepBoth);
      vi.setSystemTime(T0 - HOUR);
      phone.counters = [counter('milk'), counter('eggs')];
      await phone.syncNow();
      vi.setSystemTime(T0 - HOUR + SLOW);
      await tablet.syncNow();

      // The phone counts both, and the tablet syncs…
      vi.setSystemTime(T0);
      phone.counters = [counter('milk', 1), counter('eggs', 1)];
      await phone.syncNow();
      vi.setSystemTime(T0 + MINUTE + SLOW);
      await tablet.syncNow();
      expect(tablet.counters).toEqual([counter('milk', 1), counter('eggs', 1)]);

      // …then, a minute later, milk is corrected on the tablet and eggs deleted.
      // Nobody else changed them since, so that must stay.
      vi.setSystemTime(T0 + 2 * MINUTE + SLOW);
      tablet.counters = [counter('milk', 3)];
      await tablet.syncNow();
      vi.setSystemTime(T0 + 3 * MINUTE);
      await phone.syncNow();
      expect(phone.counters).toEqual([counter('milk', 3)]);
      expect(tablet.counters).toEqual([counter('milk', 3)]);
    });
  }
});

describe('deletions older than the markers (180 days)', () => {
  const T0 = Date.UTC(2026, 0, 10, 12);
  const DAY = 24 * HOUR;

  it('reach a device that hasn’t synced since', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    vi.setSystemTime(T0);
    phone.counters = [counter('a'), counter('old-bill'), counter('kept')];
    await phone.syncNow();
    await tablet.syncNow();
    // The tablet goes in a drawer, after one more edit that it keeps.
    vi.setSystemTime(T0 + HOUR);
    tablet.counters = [counter('a'), counter('old-bill'), counter('kept', 1)];
    offline = true;
    await tablet.syncNow();
    offline = false;

    // On the phone: old-bill and kept deleted, then months of use (any
    // sync drops markers older than 180 days).
    vi.setSystemTime(T0 + DAY);
    phone.counters = [counter('a')];
    await phone.syncNow();
    vi.setSystemTime(T0 + 200 * DAY);
    phone.counters = [counter('a', 1)];
    await phone.syncNow();

    vi.setSystemTime(T0 + 210 * DAY);
    await tablet.syncNow();
    await phone.syncNow();
    // Changed on the tablet since: that stays, like any edit made after a deletion.
    expect(phone.counters).toEqual([counter('a', 1), counter('kept', 1)]);
    expect(tablet.counters).toEqual(phone.counters);
  });

  it('made while sync was off, still reach the other devices', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    vi.setSystemTime(T0);
    phone.counters = [counter('a'), counter('b')];
    await phone.syncNow();
    await tablet.syncNow();

    tablet.sync.turnOff();
    vi.setSystemTime(T0 + DAY);
    tablet.counters = [counter('a')];
    vi.setSystemTime(T0 + 200 * DAY);
    tablet.connect(secret);
    await tablet.syncNow();
    vi.setSystemTime(T0 + 200 * DAY + HOUR);
    await phone.syncNow();
    await tablet.syncNow();
    expect(phone.counters).toEqual([counter('a')]);
    expect(tablet.counters).toEqual([counter('a')]);
  });

  it('don’t touch a copy that was started again', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    const tablet = new Device(secret);
    vi.setSystemTime(T0);
    phone.counters = [counter('a'), counter('b')];
    await phone.syncNow();
    await tablet.syncNow();

    // "Delete the online copy" on the phone, then sync on again: a new copy without b.
    phone.use();
    await phone.sync.deleteOnline();
    vi.setSystemTime(T0 + DAY);
    phone.counters = [counter('a')];
    phone.connect(secret);
    await phone.syncNow();
    // The tablet stops; turned on again, it brings its data into the new copy.
    expect((await tablet.syncNow()).problem).toBe('deleted');
    tablet.connect(secret);
    await tablet.syncNow();
    expect(tablet.counters).toEqual([counter('a'), counter('b')]);
  });
});

// ---------- Files, like photos ----------

/** A request straight to the server, as the account with this app key. */
async function call(
  secret: Uint8Array<ArrayBuffer>,
  path: string,
  init: RequestInit = {},
  app = withFiles,
): Promise<Response> {
  const { token } = await syncKeys(secret);
  const headers = { Authorization: `Bearer ${token}` };
  return app.fetch(new Request(`${ORIGIN}/api/sync${path}`, { ...init, headers }), server);
}

/** The ids of the account's files online, or the error status. */
async function fileIds(secret: Uint8Array<ArrayBuffer>): Promise<string[] | number> {
  const response = await call(secret, '/files');
  if (!response.ok) return response.status;
  return Object.keys(((await response.json()) as FileList).files).sort();
}

describe('data linked to the copy', () => {
  /** What the app's linked data was asked to do, in order. */
  function recorder(fail = { delete: false, move: false }) {
    const calls: string[] = [];
    const linked: LinkedData = {
      delete: async (secret) => {
        calls.push(`delete ${toBase64Url(secret)}`);
        if (fail.delete) throw new Error('offline');
      },
      move: async (from, to) => {
        calls.push(`move ${toBase64Url(from)} ${toBase64Url(to)}`);
        if (fail.move) throw new Error('offline');
      },
    };
    return { calls, linked, fail };
  }

  it('gives the app its own key while sync is on', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret);
    expect(equalBytes(phone.sync.secret() ?? new Uint8Array(), secret)).toBe(true);
    phone.sync.turnOff();
    expect(phone.sync.secret()).toBeNull();
  });

  it('is deleted before the copy; if that fails, nothing is deleted', async () => {
    const secret = randomBytes(32);
    const linked = recorder({ delete: true, move: false });
    const phone = new Device(secret, 1, false, false, linked.linked);
    const tablet = new Device(secret);
    phone.counters = [counter('water')];
    await phone.syncNow();

    phone.use();
    await expect(phone.sync.deleteOnline()).rejects.toThrow();
    expect(phone.sync.status().on).toBe(true);
    expect((await tablet.syncNow()).problem).toBeNull();

    linked.fail.delete = false;
    phone.use();
    await phone.sync.deleteOnline();
    expect(linked.calls).toEqual([
      `delete ${toBase64Url(secret)}`,
      `delete ${toBase64Url(secret)}`,
    ]);
    expect(await tablet.syncNow()).toMatchObject({ on: false, problem: 'deleted' });
  });

  it('moves to a new account key before the old copy is deleted, and only once', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const linked = recorder({ delete: false, move: true });
    const tablet = new Device(oldKey, 1, false, false, linked.linked);
    const laptop = new Device(oldKey);
    tablet.counters = [counter('water')];
    await tablet.syncNow();
    await laptop.syncNow();

    // The move fails (say, no connection): the old copy stays until it works.
    tablet.connect(newKey, [oldKey]);
    await tablet.syncNow();
    expect((await laptop.syncNow()).problem).toBeNull();

    linked.fail.move = false;
    expect((await tablet.syncNow()).problem).toBeNull();
    const move = `move ${toBase64Url(oldKey)} ${toBase64Url(newKey)}`;
    expect(linked.calls).toEqual([move, move]);
    expect(await laptop.syncNow()).toMatchObject({ on: false, problem: 'moved' });
    await tablet.syncNow();
    expect(linked.calls).toEqual([move, move]);
  });
});

const photo = (text: string) => utf8(text.repeat(100));
const HOUR = 60 * 60 * 1000;

/** Answers some requests itself, for as long as `answer` returns a response. */
function intercept(answer: (path: string, init?: RequestInit) => Response | undefined) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    async (input: string, init?: RequestInit) => answer(input, init) ?? realFetch(input, init),
  );
  return () => vi.stubGlobal('fetch', realFetch);
}

describe('syncing files', () => {
  it('uploads files saved here, sealed, downloads them elsewhere, and deletes them', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, false, true);
    const tablet = new Device(secret, 1, false, true);
    phone.counters = [counter('door')];
    await phone.syncNow();
    await tablet.syncNow();

    const puts: string[] = [];
    const restore = intercept((path, init) => {
      if (init?.method === 'PUT') puts.push(path);
      return undefined;
    });
    phone.addFile('door', 'p1', photo('cracked glass'));
    expect((await phone.syncNow()).problem).toBeNull();
    restore();
    // The photo first, so it's there when another device gets the data that uses it.
    expect(puts).toEqual(['/api/sync/files/p1', '/api/sync/copy']);
    expect(await fileIds(secret)).toEqual(['p1']);
    // Sealed on the phone: the server can't read it.
    const stored = new Uint8Array(await (await call(secret, '/files/p1')).arrayBuffer());
    expect(stored.length).toBe(1300 + 28);
    expect(new TextDecoder().decode(stored)).not.toContain('cracked glass');

    await tablet.syncNow();
    expect(tablet.counters[0]?.photos).toEqual(['p1']);
    tablet.use();
    const downloaded = await tablet.sync.download('p1');
    expect(downloaded && equalBytes(downloaded, photo('cracked glass'))).toBe(true);
    expect(await tablet.sync.download('nothing-like-it')).toBeNull();

    phone.removeFile('p1');
    await phone.syncNow();
    expect(await fileIds(secret)).toEqual([]);
    tablet.use();
    expect(await tablet.sync.download('p1')).toBeNull();
  });

  it('keeps a file online that another device still uses', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, false, true);
    const tablet = new Device(secret, 1, false, true);
    phone.counters = [counter('door')];
    phone.addFile('door', 'p1', photo('glass'));
    await phone.syncNow();
    await tablet.syncNow();

    // The phone takes the photo off, but deleting it online doesn't get through…
    vi.setSystemTime(Date.now() + 1000);
    const restore = intercept((path, init) => {
      if (init?.method === 'DELETE' && path.includes('/files/')) throw new TypeError('offline');
      return undefined;
    });
    phone.removeFile('p1');
    expect((await phone.syncNow()).problem).toBe('offline');
    restore();
    // …and the tablet, which still had it, changes the same item later, photo and all.
    vi.setSystemTime(Date.now() + 1000);
    tablet.counters = [{ ...counter('door', 4), photos: ['p1'] }];
    await tablet.syncNow();
    expect((await phone.syncNow()).problem).toBeNull();
    expect(phone.counters[0]?.photos).toEqual(['p1']);
    expect(await fileIds(secret)).toEqual(['p1']);
    vi.useRealTimers();
  });

  it('only deletes a file while the copy is the version the device synced', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, false, true);
    phone.counters = [counter('door')];
    phone.addFile('door', 'p1', photo('glass'));
    await phone.syncNow();
    const { version } = (await (await call(secret, '/files')).json()) as FileList;
    const remove = (base: number) => call(secret, `/files/p1?base=${base}`, { method: 'DELETE' });
    expect((await remove(version + 1)).status).toBe(409);
    expect(await fileIds(secret)).toEqual(['p1']);
    expect((await remove(version)).status).toBe(204);
    expect(await fileIds(secret)).toEqual([]);
  });

  it('checks every file once a day: brings up missing ones, deletes unused ones', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, false, true);
    // Saved before sync was turned on: the first check brings it up.
    phone.use().files.set('p1', photo('glass'));
    phone.counters = [{ ...counter('door'), photos: ['p1'] }];
    await phone.syncNow();
    expect(await fileIds(secret)).toEqual(['p1']);

    // Online, but nothing uses it (say its item was deleted on a phone that then broke).
    await call(secret, '/files/stray', { method: 'PUT', body: randomBytes(100) });
    await phone.syncNow();
    expect(await fileIds(secret)).toEqual(['p1', 'stray']);
    vi.setSystemTime(Date.now() + 25 * HOUR);
    // Just added: another device may be about to use it.
    await call(secret, '/files/fresh', { method: 'PUT', body: randomBytes(100) });
    await phone.syncNow();
    expect(await fileIds(secret)).toEqual(['fresh', 'p1']);
    vi.useRealTimers();
  });

  it('deleting the online copy deletes its files', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, false, true);
    phone.counters = [counter('door')];
    phone.addFile('door', 'p1', photo('glass'));
    await phone.syncNow();
    await phone.sync.deleteOnline();
    expect(await fileIds(secret)).toBe(410);
    expect(
      (await call(secret, '/files/p2', { method: 'PUT', body: randomBytes(100) })).status,
    ).toBe(410);
    expect(phone.files.has('p1')).toBe(true);
  });

  it('moves files to a new account key', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const lost = new Device(oldKey, 1, false, true);
    const tablet = new Device(oldKey, 1, false, true);
    lost.counters = [counter('door')];
    lost.addFile('door', 'p1', photo('glass'));
    await lost.syncNow();
    // The tablet has the data, but never downloaded the photo.
    await tablet.syncNow();

    tablet.connect(newKey, [oldKey]);
    expect((await tablet.syncNow()).problem).toBeNull();
    expect(await fileIds(newKey)).toEqual(['p1']);
    expect(await fileIds(oldKey)).toBe(410);
    tablet.use();
    const moved = await tablet.sync.download('p1');
    expect(moved && equalBytes(moved, photo('glass'))).toBe(true);
  });

  it('says when there’s no room online, and tries again the next day', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, false, true);
    phone.counters = [counter('door')];
    await phone.syncNow();
    let tries = 0;
    const restore = intercept((path, init) => {
      if (init?.method !== 'PUT' || !path.includes('/files/')) return undefined;
      tries += 1;
      return new Response(null, { status: 507 });
    });
    phone.addFile('door', 'p1', photo('glass'));
    expect((await phone.syncNow()).problem).toBe('files-full');
    expect(phone.files.has('p1')).toBe(true);
    // Not tried again at every sync.
    expect((await phone.syncNow()).problem).toBeNull();
    expect(tries).toBe(1);

    restore();
    vi.setSystemTime(Date.now() + 25 * HOUR);
    await phone.syncNow();
    expect(await fileIds(secret)).toEqual(['p1']);
    vi.useRealTimers();
  });

  it('waits a while when the server says there are too many changes', async () => {
    const secret = randomBytes(32);
    const phone = new Device(secret, 1, false, true);
    phone.counters = [counter('door')];
    await phone.syncNow();
    let tries = 0;
    const restore = intercept((path, init) => {
      if (init?.method !== 'PUT' || !path.includes('/files/')) return undefined;
      tries += 1;
      return new Response(null, { status: 429 });
    });
    phone.addFile('door', 'p1', photo('glass'));
    expect((await phone.syncNow()).problem).toBeNull();
    await phone.syncNow();
    expect(tries).toBe(1);

    restore();
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await phone.syncNow();
    expect(await fileIds(secret)).toEqual(['p1']);
    vi.useRealTimers();
  });

  it('the server: files only for apps that turn them on, and only sensible ones', async () => {
    const secret = randomBytes(32);
    const put = (path: string, body: Uint8Array<ArrayBuffer>) =>
      call(secret, path, { method: 'PUT', body });
    expect((await call(secret, '/files', {}, worker)).status).toBe(404);
    // Files go up before the data, so even before there's a copy; deleting needs one.
    expect((await put('/files/p0', randomBytes(100))).status).toBe(204);
    expect((await call(secret, '/files/p0?base=1', { method: 'DELETE' })).status).toBe(409);

    const phone = new Device(secret, 1, false, true);
    phone.counters = [counter('door')];
    await phone.syncNow();
    expect((await put('/files/.hidden', randomBytes(100))).status).toBe(400);
    expect((await put('/files/a%2Fb', randomBytes(100))).status).toBe(400);
    expect((await put('/files/p1', randomBytes(20))).status).toBe(400);
    expect((await put('/files/p1', new Uint8Array(1_500_001))).status).toBe(413);
    expect((await call(secret, '/files/p1', { method: 'DELETE' })).status).toBe(400);
    expect((await call(secret, '/files', { method: 'POST' })).status).toBe(405);
    expect((await call(secret, '/files/p1')).status).toBe(404);
    expect((await put('/files/p1', randomBytes(100))).status).toBe(204);
    expect((await call(secret, '/files/p1')).status).toBe(200);
  });
});
