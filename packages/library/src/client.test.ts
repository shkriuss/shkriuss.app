/**
 * The library's browser side (client.ts) against the real server code in
 * memory (testing.ts): keys, sealing, changes, downloads, moving to a new
 * account key, and deleting; and, with the real sync client and server,
 * which library devices use as their records sync.
 */
import { randomBytes, toBase64Url, utf8 } from '@shkriuss/crypto';
import { createSync, saveConnection, syncedStore, type SyncClient } from '@shkriuss/sync';
import { memorySync } from '@shkriuss/sync/testing';
import syncWorker from '@shkriuss/sync/worker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isLibraryRecord,
  libraryAccess,
  libraryApi,
  LibraryError,
  libraryRecord,
  linkedLibrary,
  tidyRecords,
  usableRecord,
  useLibrary,
  type LibraryItem,
  type LibraryRecord,
} from './client.ts';
import { memoryLibrary } from './testing.ts';

const ORIGIN = 'https://photos.example';
const CODE = 'correct horse battery staple';
let server: ReturnType<typeof memoryLibrary>;

beforeEach(() => {
  server = memoryLibrary(CODE);
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    // Browsers say how big a file they send is; Node's Request doesn't add it.
    const headers = new Headers(init.headers);
    if (init.body instanceof Blob) headers.set('Content-Length', String(init.body.size));
    return server.fetch(new Request(new URL(input, ORIGIN), { ...init, headers }));
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const photo = { name: 'IMG_0001.HEIC', taken: '2026-10-21T14:03:22' };
const parts = () => [utf8('thumbnail'.repeat(5)), null, utf8('the original, byte for byte')];

async function device(secret: Uint8Array<ArrayBuffer>, record?: LibraryRecord) {
  const kept = record ?? (await libraryRecord(secret, undefined));
  return { record: kept, api: libraryApi(await libraryAccess(secret, kept)) };
}

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(LibraryError);
  return error as LibraryError;
}

describe('the library record', () => {
  it('is the same from the same key, and gains the new key after a replaced one', async () => {
    const secret = randomBytes(32);
    const first = await libraryRecord(secret, undefined);
    expect(await libraryRecord(secret, undefined)).toEqual(first);
    expect(await libraryRecord(secret, first)).toBe(first);

    const replaced = await libraryRecord(randomBytes(32), first);
    expect(replaced.library).toBe(first.library);
    expect(replaced.keys.length).toBe(2);
    expect(replaced.keys[0]).toEqual(first.keys[0]);
  });

  it('is one per library, so a merge keeps every library’s', async () => {
    const one = await libraryRecord(randomBytes(32), undefined);
    const other = await libraryRecord(randomBytes(32), undefined);
    expect(one.id).toBe(`library:${one.library}`);
    expect(other.id).not.toBe(one.id);
    expect(isLibraryRecord(one)).toBe(true);
    expect(isLibraryRecord({ ...one, id: `library:${other.library}` })).toBe(false);
  });

  it('saved by the version before (one record, "library") becomes its library’s', async () => {
    const record = await libraryRecord(randomBytes(32), undefined);
    const older = { ...record, id: 'library' };
    expect(isLibraryRecord(older)).toBe(true);
    expect(tidyRecords([older])).toEqual([record]);
    // Both, from two devices: one record, with every key.
    const moved = await libraryRecord(randomBytes(32), record);
    expect(tidyRecords([older, moved])).toEqual([moved]);
    const tidy = [record];
    expect(tidyRecords(tidy)).toBe(tidy);
  });

  it('this key uses the oldest library it can, never another account’s', async () => {
    const [oldKey, newKey, otherAccount] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    const real = await libraryRecord(newKey, await libraryRecord(oldKey, undefined));
    const own = await libraryRecord(newKey, undefined);
    const theirs = await libraryRecord(otherAccount, undefined);
    const records = [own, theirs, real];
    expect((await usableRecord(newKey, records))?.library).toBe(real.library);
    expect((await usableRecord(otherAccount, records))?.library).toBe(theirs.library);
    // A record that wasn't moved to the new key (or is another account's) isn't used.
    expect(await usableRecord(newKey, [theirs, await libraryRecord(oldKey, undefined)])).toBe(
      undefined,
    );
  });

  it('a new library is started only once a sync found none, and other accounts’ stay as they are', async () => {
    const secret = randomBytes(32);
    expect(await useLibrary(secret, [], false)).toEqual({ record: undefined, records: [] });
    const made = await useLibrary(secret, [], true);
    expect(made.record).toEqual(await libraryRecord(secret, undefined));
    expect(made.records).toEqual([made.record]);
    expect(await useLibrary(secret, made.records, true)).toEqual(made);

    const theirs = await libraryRecord(randomBytes(32), undefined);
    const mine = await useLibrary(secret, [theirs], true);
    expect(mine.records).toEqual([theirs, made.record]);
  });
});

describe('items', () => {
  it('go up sealed, and come back to another device opened, in parts', async () => {
    const secret = randomBytes(32);
    const phone = await device(secret);
    await phone.api.unlock(CODE);
    const uploaded = await phone.api.upload('photo-0001', photo, parts());
    expect(uploaded.seq).toBe(1);
    expect(uploaded.parts[1]).toBe(0);

    // Nothing readable reaches the server.
    const stored = new TextDecoder().decode([...server.bucket.files.values()][0]);
    expect(stored).not.toContain('original');
    const listed = JSON.stringify([...(server.objects.values().next().value?.storage.map ?? [])]);
    expect(listed).not.toContain('IMG_0001');

    const tablet = await device(secret, phone.record);
    const changes = await tablet.api.changes(0);
    expect(changes).toMatchObject({ seq: 1, last: 1, more: false, unlocked: true, unreadable: 0 });
    expect((await tablet.api.changes(1)).last).toBe(1);
    const item = changes.changes[0] as LibraryItem;
    expect(item).toMatchObject({ id: 'photo-0001', details: photo, parts: uploaded.parts });

    const thumbs = await tablet.api.firstParts([item, { ...item, id: 'photo-none' }]);
    expect([...thumbs.keys()]).toEqual(['photo-0001']);
    expect(new TextDecoder().decode(thumbs.get('photo-0001'))).toBe('thumbnail'.repeat(5));
    expect(await tablet.api.part(item, 1)).toBeNull();
    expect(new TextDecoder().decode((await tablet.api.part(item, 2)) ?? new Uint8Array())).toBe(
      'the original, byte for byte',
    );
  });

  it('say why they can’t go up', async () => {
    const phone = await device(randomBytes(32));
    expect((await failure(phone.api.upload('photo-0001', photo, parts()))).problem).toBe('locked');
    expect((await failure(phone.api.unlock('guess'))).problem).toBe('wrong-code');
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    expect((await failure(phone.api.upload('photo-0001', photo, parts()))).problem).toBe('exists');
    await phone.api.remove(['photo-0001']);
    expect((await failure(phone.api.upload('photo-0001', photo, parts()))).problem).toBe('deleted');
    expect((await phone.api.changes(0)).changes).toEqual([
      { id: 'photo-0001', seq: 2, deleted: true },
    ]);
  });

  it('can’t be read by another account', async () => {
    const phone = await device(randomBytes(32));
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    // Someone who learned the library's id, with an account of their own.
    const stranger = await device(randomBytes(32), phone.record);
    expect((await failure(stranger.api.changes(0))).problem).toBe('server');
  });
});

describe('deletion notes', () => {
  /** The server adds `rows` to every list of changes, as a server that went wrong could. */
  function addRows(rows: object[]): void {
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (init.body instanceof Blob) headers.set('Content-Length', String(init.body.size));
      const response = await server.fetch(
        new Request(new URL(input, ORIGIN), { ...init, headers }),
      );
      if (!new URL(input, ORIGIN).pathname.endsWith('/changes')) return response;
      const page = (await response.json()) as { rows: object[] };
      return Response.json({ ...page, rows: [...page.rows, ...rows] });
    });
  }

  it('count only when a device of this account made them (audit A-8)', async () => {
    const secret = randomBytes(32);
    const phone = await device(secret);
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    await phone.api.upload('photo-0002', photo, parts());
    await phone.api.remove(['photo-0001']);
    const real = (await phone.api.changes(0)).changes;
    expect(real.map((change) => [change.id, 'deleted' in change])).toEqual([
      ['photo-0002', false],
      ['photo-0001', true],
    ]);

    // Made up by the server: without a seal, or with the seal of another item's note.
    const listed = (await (
      await fetch(`${ORIGIN}/api/library/changes?since=0`, {
        headers: {
          Authorization: `Bearer ${(await libraryAccess(secret, phone.record)).token}`,
          'X-Library': phone.record.library,
        },
      })
    ).json()) as { rows: { id: string; proof?: string }[] };
    const sealOfAnother = listed.rows.find((row) => row.id === 'photo-0001')?.proof;
    expect(sealOfAnother).toMatch(/\./);
    addRows([
      { id: 'photo-0002', seq: 9, deleted: true, at: 1 },
      { id: 'photo-0002', seq: 10, deleted: true, at: 1, proof: sealOfAnother },
    ]);
    const tablet = await device(secret, phone.record);
    expect((await tablet.api.changes(0)).changes).toEqual(real);
  });

  it('that a refused upload gives must be real too', async () => {
    const phone = await device(randomBytes(32));
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    await phone.api.remove(['photo-0001']);
    expect((await failure(phone.api.upload('photo-0001', photo, parts()))).problem).toBe('deleted');

    // A server that says "deleted" with no seal: the photo just doesn't go up.
    vi.stubGlobal('fetch', async () => Response.json({ deleted: true }, { status: 409 }));
    expect((await failure(phone.api.upload('photo-0002', photo, parts()))).problem).toBe(
      'unproven-deletion',
    );
  });
});

describe('a replaced account key', () => {
  it('moves the library: old items still open, new ones use the new key, the old token stops', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const phone = await device(oldKey);
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());

    const record = await libraryRecord(newKey, phone.record);
    await linkedLibrary(() => [record]).move(oldKey, newKey);
    const tablet = await device(newKey, record);
    await tablet.api.upload('photo-0002', { ...photo, name: 'new' }, parts());
    const changes = await tablet.api.changes(0);
    expect(changes.unreadable).toBe(0);
    expect(changes.changes.map((change) => change.id)).toEqual(['photo-0001', 'photo-0002']);
    const [older, newer] = changes.changes as LibraryItem[];
    expect(older?.key).not.toBe(newer?.key);

    // A device still on the old key is told the library moved, and can't download anything.
    expect((await failure(phone.api.changes(0))).problem).toBe('moved');
    expect((await failure(phone.api.part(newer as LibraryItem, 2))).problem).toBe('moved');
  });

  it('moves every library the old key had, not only the one in use, and adds the new key', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const phone = await device(oldKey);
    await phone.api.changes(0);
    // A library a device with only the new key started meanwhile, and another account's.
    const own = await device(newKey);
    await own.api.changes(0);
    const theirs = await libraryRecord(randomBytes(32), undefined);

    let saved: readonly LibraryRecord[] = [own.record, theirs, phone.record];
    await linkedLibrary(
      () => saved,
      (records) => {
        saved = records;
        return true;
      },
    ).move(oldKey, newKey);
    expect(saved).toEqual([own.record, theirs, await libraryRecord(newKey, phone.record)]);
    expect((await failure(phone.api.changes(0))).problem).toBe('moved');
    expect((await usableRecord(newKey, saved))?.library).toBe(phone.record.library);
  });

  it('a device with the old key that moves the library first takes it: the move says so, without failing', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const phone = await device(oldKey);
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    // The lost device, with an account of its own.
    await linkedLibrary(() => [phone.record]).move(oldKey, randomBytes(32));

    let saved: readonly LibraryRecord[] = [phone.record];
    const linked = linkedLibrary(
      () => saved,
      (records) => {
        saved = records;
        return true;
      },
    );
    await linked.move(oldKey, newKey);
    expect(saved).toEqual([{ ...phone.record, taken: true }]);
    expect(isLibraryRecord(saved[0])).toBe(true);
    // So a new library is started with the new key, and that's the one deleted with the copy.
    const next = await useLibrary(newKey, saved, true);
    expect(next.record?.library).not.toBe(phone.record.library);
    expect(next.records).toEqual([...saved, next.record]);
    const fresh = await device(newKey, next.record);
    const { epoch } = await fresh.api.changes(0);
    await linkedLibrary(() => next.records).delete(newKey, []);
    expect((await fresh.api.changes(0)).epoch).not.toBe(epoch);
  });
});

describe('deleting with the online copy', () => {
  it('deletes everything in the library', async () => {
    const secret = randomBytes(32);
    const phone = await device(secret);
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    await linkedLibrary(() => [phone.record]).delete(secret, []);
    expect(await phone.api.changes(0)).toMatchObject({ wiping: true, changes: [] });
  });

  it('deletes the libraries in the online copy too, for a device that hasn’t synced yet', async () => {
    // Its own records are empty: only the online copy knows the library (audit 4 D-2).
    const secret = randomBytes(32);
    const phone = await device(secret);
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    const online = [{ id: 'not-a-record' }, phone.record, 'nonsense'];
    await linkedLibrary(() => []).delete(secret, online);
    expect(await phone.api.changes(0)).toMatchObject({ wiping: true, changes: [] });
  });

  it('does nothing without a library, or for one that isn’t this key’s', async () => {
    const secret = randomBytes(32);
    await linkedLibrary(() => []).delete(secret, []);
    const phone = await device(randomBytes(32));
    await phone.api.changes(0);
    await linkedLibrary(() => [phone.record]).delete(secret, []);
    expect((await phone.api.changes(0)).wiping).toBe(false);
  });

  it('fails, instead of saying it’s done, when the library was taken', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const phone = await device(oldKey);
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    // The record has the new key (as older versions added it), but a device
    // with the old key took the library before it was moved.
    const record = await libraryRecord(newKey, phone.record);
    await linkedLibrary(() => [phone.record]).move(oldKey, randomBytes(32));
    const error = await failure(linkedLibrary(() => [record]).delete(newKey, []));
    expect(error.status).toBe(403);
  });
});

// ---------- With sync, as Photos uses it ----------

/** Web Storage in memory: each pretend device has its own. */
class MemoryStorage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

interface Records {
  items: LibraryRecord[];
}
const isRecords = (value: unknown): value is Records =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as Records).items) &&
  (value as Records).items.every(isLibraryRecord);

/**
 * The records' store as Photos keeps it (apps/photos/src/lib/online.ts):
 * version 2 keeps one record per library; version 1 is the version before.
 */
function recordsStore(version: 1 | 2) {
  const key = 'shkriuss:library';
  const read = (from: number, data: unknown): Records | undefined => {
    if (!isRecords(data) || from > version) return undefined;
    return from === version ? data : { items: [...tidyRecords(data.items)] };
  };
  const saved = () =>
    JSON.parse(localStorage.getItem(key) ?? 'null') as { v: number; data: unknown } | null;
  return {
    key,
    version,
    empty: (): Records => ({ items: [] }),
    read,
    load(): Records {
      const raw = saved();
      return (raw && read(raw.v, raw.data)) ?? { items: [] };
    },
    status(): 'empty' | 'ok' | 'newer' | 'unreadable' {
      const raw = saved();
      if (raw === null) return 'empty';
      if (raw.v > version) return 'newer';
      return read(raw.v, raw.data) ? 'ok' : 'unreadable';
    },
    raw: () => saved(),
    save(value: Records): boolean {
      localStorage.setItem(key, JSON.stringify({ v: version, data: value }));
      return true;
    },
    clear(): void {
      localStorage.removeItem(key);
    },
  };
}

/** A device with Photos' sync: the libraries' records in its copy, and the libraries linked to it. */
class Device {
  readonly storage = new MemoryStorage();
  readonly store: ReturnType<typeof recordsStore>;
  readonly sync: SyncClient;

  constructor(secret: Uint8Array<ArrayBuffer>, version: 1 | 2 = 2) {
    this.store = recordsStore(version);
    this.use();
    this.storage.setItem(
      'shkriuss-device:sync',
      JSON.stringify({ secret: toBase64Url(secret), code: 'K7Q2-M9XD' }),
    );
    this.sync = createSync({
      app: 'photos',
      stores: [
        syncedStore({
          store: this.store,
          items: (value) => value.items,
          withItems: (value, items) => ({ ...value, items }),
        }),
      ],
      onChange: () => undefined,
      linked: linkedLibrary(
        () => this.records,
        (saved) => {
          this.records = [...saved];
          return true;
        },
      ),
    });
  }

  use(): this {
    vi.stubGlobal('localStorage', this.storage);
    return this;
  }

  get records(): LibraryRecord[] {
    return this.use().store.load().items;
  }

  set records(items: LibraryRecord[]) {
    this.use().store.save({ items });
  }

  /** Comes back from "Turn on sync" on the hub with this app key. */
  connect(secret: Uint8Array<ArrayBuffer>, replaces: Uint8Array<ArrayBuffer>[] = []): void {
    this.use();
    expect(saveConnection({ secret, code: 'N3W5-K3Y8', replaces })).toBe(true);
  }

  async syncNow() {
    await this.use().sync.syncNow();
    return this.sync.status();
  }

  /** What Photos does after each sync: the library to use, started if there's none. */
  async library(): Promise<LibraryRecord | undefined> {
    const secret = this.use().sync.secret();
    if (!secret) return undefined;
    const chosen = await useLibrary(secret, this.records, true);
    this.records = [...chosen.records];
    return chosen.record;
  }
}

describe('with sync, as Photos uses it', () => {
  beforeEach(() => {
    const { env } = memorySync();
    const libraryFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
      input.startsWith('/api/sync')
        ? syncWorker.fetch(new Request(new URL(input, ORIGIN), init), env)
        : libraryFetch(input, init),
    );
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
  });

  it('a device with only the new account key can’t replace the real library', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    // The tablet's library, with a photo in it.
    const tablet = new Device(oldKey);
    await tablet.syncNow();
    const real = (await tablet.library()) as LibraryRecord;
    await tablet.syncNow();
    const before = libraryApi(await libraryAccess(oldKey, real));
    await before.unlock(CODE);
    await before.upload('photo-0001', photo, parts());

    // A phone is lost and the key replaced. A new phone, with only the new key,
    // turns on sync before the tablet opens Photos again: it starts a library.
    const newPhone = new Device(newKey);
    await newPhone.syncNow();
    expect((await newPhone.library())?.library).not.toBe(real.library);
    await newPhone.syncNow();

    // The tablet connects with the new key (and the old one): it brings its old
    // copy along, and moves its library to the new key. It keeps using it.
    tablet.connect(newKey, [oldKey]);
    expect((await tablet.syncNow()).problem).toBeNull();
    expect(tablet.records).toHaveLength(2);
    expect((await tablet.library())?.library).toBe(real.library);
    await tablet.syncNow();
    expect((await failure(before.changes(0))).problem).toBe('moved');

    // So does the new phone, once it syncs: it sees the photo.
    await newPhone.syncNow();
    const used = (await newPhone.library()) as LibraryRecord;
    expect(used.library).toBe(real.library);
    const changes = await libraryApi(await libraryAccess(newKey, used)).changes(0);
    expect(changes.changes.map((change) => change.id)).toEqual(['photo-0001']);
  });

  it('a lost device that takes the library first: the person’s device finds out, and starts a new one', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const tablet = new Device(oldKey);
    await tablet.syncNow();
    const real = (await tablet.library()) as LibraryRecord;
    await tablet.syncNow();
    const lost = new Device(oldKey);
    await lost.syncNow();

    // The key is replaced on the tablet. Before it opens Photos again, the
    // lost device makes an account of its own and turns on sync with it: that
    // moves the old copy, and the library, to its own new key.
    lost.connect(randomBytes(32), [oldKey]);
    expect((await lost.syncNow()).problem).toBeNull();

    // The tablet connects with the new key: there's no old copy left to bring,
    // but it still moves the library, and learns that it was taken.
    tablet.connect(newKey, [oldKey]);
    expect((await tablet.syncNow()).problem).toBeNull();
    expect(tablet.records).toEqual([{ ...real, taken: true }]);
    const next = (await tablet.library()) as LibraryRecord;
    expect(next.library).not.toBe(real.library);
    expect(tablet.records).toEqual([{ ...real, taken: true }, next]);
  });

  it('keeps using the library in the record saved by the version before', async () => {
    const secret = randomBytes(32);
    const record = await libraryRecord(secret, undefined);
    // The version before kept one record, "library", in version 1 of the store.
    const older = new Device(secret, 1);
    older.records = [{ ...record, id: 'library' }];
    await older.syncNow();

    // A device with this version: its own record, saved by the version before…
    const here = new Device(secret);
    const saved = { v: 1, data: { items: [{ ...record, id: 'library' }] } };
    here.storage.setItem('shkriuss:library', JSON.stringify(saved));
    expect(here.records).toEqual([record]);
    // …and the older device's, from the copy.
    const fresh = new Device(secret);
    await fresh.syncNow();
    expect((await fresh.library())?.library).toBe(record.library);
    expect(fresh.records).toEqual([record]);
    await fresh.syncNow();
    expect(await here.syncNow()).toMatchObject({ problem: null });
    expect(here.records).toEqual([record]);
  });
});
