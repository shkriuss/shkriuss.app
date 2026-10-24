/**
 * The library server (worker.ts): the real Worker code and Durable Object,
 * with storage and R2 in memory (testing.ts).
 */
import { randomBytes, sha256, toBase64Url } from '@shkriuss/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLibrary } from './testing.ts';
import { LIMITS, type Changes } from './validate.ts';
import { STORAGE_LIMITS, SWEEP_MS } from './worker.ts';

const ORIGIN = 'https://photos.example';
const CODE = 'correct horse battery staple';

let server: ReturnType<typeof memoryLibrary>;
beforeEach(() => {
  server = memoryLibrary(CODE);
});
afterEach(() => {
  vi.useRealTimers();
});

const token = () => toBase64Url(randomBytes(32));
const libraryId = () => toBase64Url(randomBytes(32));
const details = 'D'.repeat(60);

/** A device's way into one library, from an internet address. */
function client(library: string, bearer: string, address = '203.0.113.7') {
  const headers = (more: Record<string, string> = {}) => ({
    Authorization: `Bearer ${bearer}`,
    'X-Library': library,
    'CF-Connecting-IP': address,
    ...more,
  });
  const call = (path: string, init: RequestInit = {}) =>
    server.fetch(
      new Request(`${ORIGIN}/api/library${path}`, {
        ...init,
        headers: headers((init.headers as Record<string, string> | undefined) ?? {}),
      }),
    );
  const post = (path: string, body: unknown) =>
    call(path, { method: 'POST', body: JSON.stringify(body) });
  return {
    call,
    post,
    changes: async (since = 0) => (await (await call(`/changes?since=${since}`)).json()) as Changes,
    unlock: (code = CODE) => post('/unlock', { code }),
    /** Uploads an item made of parts of the given sizes (each byte is its part's number). */
    put: (id: string, sizes: number[], init: { parts?: string; key?: string } = {}) => {
      const body = new Uint8Array(sizes.reduce((sum, size) => sum + size, 0));
      let at = 0;
      for (const [index, size] of sizes.entries()) {
        body.fill(index + 1, at, at + size);
        at += size;
      }
      return call(`/items/${id}`, {
        method: 'PUT',
        body,
        headers: {
          'Content-Length': String(body.length),
          'X-Library-Parts': init.parts ?? sizes.join(','),
          'X-Library-Key': init.key ?? 'k1',
          'X-Library-Details': details,
        },
      });
    },
    remove: (ids: string[]) => post('/remove', { ids }),
  };
}

const ITEM = 'photo-0001';
const fileKey = async (library: string, id: string) =>
  `${toBase64Url(await sha256(new TextEncoder().encode(library)))}/${id}`;

describe('who can use a library', () => {
  it('needs a token and a library id', async () => {
    const library = libraryId();
    const noToken = await server.fetch(
      new Request(`${ORIGIN}/api/library/changes`, { headers: { 'X-Library': library } }),
    );
    expect(noToken.status).toBe(401);
    const noLibrary = await server.fetch(
      new Request(`${ORIGIN}/api/library/changes`, {
        headers: { Authorization: `Bearer ${token()}`, 'X-Library': 'short' },
      }),
    );
    expect(noLibrary.status).toBe(400);
  });

  it('belongs to the first token that uses it; others are refused', async () => {
    const library = libraryId();
    const mine = client(library, token());
    expect((await mine.call('/changes')).status).toBe(200);
    const theirs = client(library, token());
    expect((await theirs.call('/changes')).status).toBe(403);
    expect((await theirs.unlock()).status).toBe(403);
    expect((await theirs.put(ITEM, [100])).status).toBe(403);
    // The object never sees the token or the library's id, only hashes.
    const stored = JSON.stringify([...server.objects.values()].map((o) => [...o.storage.map]));
    expect(stored).not.toContain(library);
  });

  it('moves to a new token, proven with the old one, which is refused from then on', async () => {
    const library = libraryId();
    const oldToken = token();
    const newToken = token();
    const old = client(library, oldToken);
    await old.unlock();
    expect((await old.put(ITEM, [100])).status).toBe(200);

    const stranger = client(library, token());
    expect((await stranger.post('/move', { from: token() })).status).toBe(403);

    const moved = client(library, newToken);
    expect((await moved.post('/move', { from: oldToken })).status).toBe(204);
    // Asking again is fine (another device may have moved it first).
    expect((await moved.post('/move', { from: oldToken })).status).toBe(204);
    const changes = await moved.changes();
    expect(changes.unlocked).toBe(true);
    expect(changes.rows.map((row) => row.id)).toEqual([ITEM]);

    const refused = await old.call('/changes');
    expect(refused.status).toBe(410);
    expect(await refused.json()).toMatchObject({ moved: true });
  });
});

describe('the storage code', () => {
  it('is needed before anything is added', async () => {
    const device = client(libraryId(), token());
    const locked = await device.put(ITEM, [100]);
    expect(locked.status).toBe(423);
    expect(server.bucket.files.size).toBe(0);
    expect((await device.changes()).unlocked).toBe(false);

    const wrong = await device.unlock('wrong horse');
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ wrong: true });
    expect((await device.unlock()).status).toBe(204);
    expect((await device.changes()).unlocked).toBe(true);
    expect((await device.put(ITEM, [100])).status).toBe(200);
  });

  it('allows 20 wrong tries an hour from one address, counting every library together', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22, 12) });
    // Anyone can make up libraries, so a new one doesn't mean more tries.
    for (let attempt = 0; attempt < LIMITS.unlockTries; attempt += 1) {
      expect((await client(libraryId(), token()).unlock('guess')).status).toBe(403);
    }
    const device = client(libraryId(), token());
    const tooMany = await device.unlock();
    expect(tooMany.status).toBe(429);
    expect(await tooMany.json()).toMatchObject({
      tooMany: true,
      retryAt: Date.UTC(2026, 9, 22, 13),
    });
    vi.setSystemTime(Date.UTC(2026, 9, 22, 13, 1));
    expect((await device.unlock()).status).toBe(204);
  });

  it('a stranger’s wrong tries can’t stop the right code from anywhere else', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22, 12) });
    // One IPv6 connection has a whole network: changing the last 64 bits doesn't help.
    for (let attempt = 0; attempt < LIMITS.unlockTries; attempt += 1) {
      const stranger = client(libraryId(), token(), `2001:db8:1:2::${attempt.toString(16)}`);
      expect((await stranger.unlock('guess')).status).toBe(403);
    }
    const sameNetwork = client(libraryId(), token(), '2001:db8:1:2:ffff::1');
    expect((await sameNetwork.unlock()).status).toBe(429);
    expect((await client(libraryId(), token(), '2001:db8:1:3::1').unlock()).status).toBe(204);
    expect((await client(libraryId(), token(), '198.51.100.4').unlock()).status).toBe(204);
  });

  it('forgets wrong tries when their hour is over, and keeps no addresses', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22, 12, 30) });
    expect((await client(libraryId(), token(), '198.51.100.4').unlock('guess')).status).toBe(403);
    const kept = [...server.gateStorage.map.keys()].filter((key) => key.startsWith('try:'));
    expect(kept).toHaveLength(1);
    expect(JSON.stringify([...server.gateStorage.map])).not.toContain('198.51.100');
    expect(server.gateStorage.alarm).toBe(Date.UTC(2026, 9, 22, 13));

    vi.setSystemTime(Date.UTC(2026, 9, 22, 13));
    await server.gate.alarm();
    expect([...server.gateStorage.map.keys()].filter((key) => key.startsWith('try:'))).toEqual([]);
  });

  it('unlocks only while it’s still the code: changing it locks every library', async () => {
    const device = client(libraryId(), token());
    await device.unlock();
    expect((await device.put(ITEM, [100])).status).toBe(200);

    server.env.LIBRARY_STORAGE_CODE = 'a new passphrase';
    expect((await device.changes()).unlocked).toBe(false);
    expect((await device.put('photo-0002', [100])).status).toBe(423);
    expect((await device.unlock()).status).toBe(403);
    expect((await device.unlock('a new passphrase')).status).toBe(204);
    expect((await device.put('photo-0002', [100])).status).toBe(200);
  });

  it('can’t be given if the server has none', async () => {
    server = memoryLibrary(null);
    const response = await client(libraryId(), token()).unlock();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ notSetUp: true });
  });
});

describe('items', () => {
  async function unlocked() {
    const library = libraryId();
    const device = client(library, token());
    await device.unlock();
    return { library, device };
  }

  it('are added sealed, listed with their parts, and read in parts', async () => {
    const { library, device } = await unlocked();
    const put = await device.put(ITEM, [40, 0, 300]);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ seq: 1 });
    expect(server.bucket.files.get(await fileKey(library, ITEM))?.length).toBe(340);

    const changes = await device.changes();
    expect(changes).toMatchObject({ seq: 1, more: false, usage: { items: 1, bytes: 340 } });
    expect(changes.rows).toEqual([
      { id: ITEM, seq: 1, key: 'k1', details, parts: [40, 0, 300], at: expect.any(Number) },
    ]);
    expect((await device.changes(1)).rows).toEqual([]);

    const part = await device.call(`/items/${ITEM}?offset=40&length=300`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array(300).fill(3));
    expect((await device.call(`/items/photo-0002?offset=0&length=40`)).status).toBe(404);
  });

  it('sends several first parts in one go, saying which are missing', async () => {
    const { device } = await unlocked();
    await device.put('photo-aaaa', [30, 50]);
    await device.put('photo-bbbb', [35, 50]);
    const response = await device.post('/first-parts', {
      items: [
        ['photo-bbbb', 35],
        ['photo-none', 40],
        ['photo-aaaa', 30],
      ],
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0)).toBe(35);
    expect(view.getUint32(4 + 35)).toBe(0);
    expect(view.getUint32(8 + 35)).toBe(30);
    expect(bytes.length).toBe(12 + 35 + 30);
    expect(bytes.slice(4, 4 + 35)).toEqual(new Uint8Array(35).fill(1));
  });

  it('refuses ones that make no sense', async () => {
    const { device } = await unlocked();
    expect((await device.put('x', [100])).status).toBe(400);
    expect((await device.put(ITEM, [100], { parts: '60,50' })).status).toBe(400);
    expect((await device.put(ITEM, [10, 100])).status).toBe(400);
    expect((await device.put(ITEM, [100], { key: 'not a key!' })).status).toBe(400);
    expect((await device.post('/first-parts', { items: [] })).status).toBe(400);
    expect((await device.post('/remove', { ids: ['../other'] })).status).toBe(400);
    expect(server.bucket.files.size).toBe(0);
  });

  it('are added once; a deleted one can’t come back, and its file goes', async () => {
    const { library, device } = await unlocked();
    await device.put(ITEM, [100]);
    const again = await device.put(ITEM, [100]);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ exists: true });
    expect(server.bucket.files.has(await fileKey(library, ITEM))).toBe(true);

    expect((await device.remove([ITEM, 'photo-never'])).status).toBe(204);
    expect(server.bucket.files.size).toBe(0);
    const changes = await device.changes();
    expect(changes.rows).toEqual([
      { id: ITEM, seq: 2, deleted: true, at: expect.any(Number) },
      { id: 'photo-never', seq: 3, deleted: true, at: expect.any(Number) },
    ]);
    expect(changes.usage).toMatchObject({ items: 0, bytes: 0 });

    // An upload that was on its way when the item was deleted.
    const late = await device.put(ITEM, [100]);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ deleted: true });
    expect(server.bucket.files.size).toBe(0);
    // Removing again changes nothing.
    await device.remove([ITEM]);
    expect((await device.changes()).seq).toBe(3);
  });

  it('come a page at a time', async () => {
    const { device } = await unlocked();
    const ids = Array.from({ length: LIMITS.page + 20 }, (_, index) => `photo-${index + 1000}`);
    for (let start = 0; start < ids.length; start += LIMITS.remove) {
      await device.remove(ids.slice(start, start + LIMITS.remove));
    }
    const first = await device.changes();
    expect(first.rows.length).toBe(LIMITS.page);
    expect(first.more).toBe(true);
    const last = first.rows.at(-1)?.seq ?? 0;
    const second = await device.changes(last);
    expect(second.rows.map((row) => row.id)).toEqual(ids.slice(LIMITS.page));
    expect(second.more).toBe(false);
  });

  it('stop when the library is full, and after the day’s uploads', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22, 12) });
    const { device } = await unlocked();
    const storage = [...server.objects.values()][0]?.storage;
    const meta = (await storage?.get<Record<string, unknown>>('meta')) ?? {};

    await storage?.put('meta', { ...meta, bytes: LIMITS.bytes - 50 });
    const full = await device.put(ITEM, [100]);
    expect(full.status).toBe(507);
    expect(server.bucket.files.size).toBe(0);

    await storage?.put('meta', { ...meta, day: '2026-10-22', uploads: LIMITS.uploadsPerDay });
    const today = await device.put(ITEM, [100]);
    expect(today.status).toBe(429);
    expect(await today.json()).toMatchObject({ retryAt: Date.UTC(2026, 9, 23) });
    vi.setSystemTime(Date.UTC(2026, 9, 23, 0, 1));
    expect((await device.put(ITEM, [100])).status).toBe(200);
    expect((await device.changes()).usage.uploadsToday).toBe(1);
  });
});

describe('protecting the bill', () => {
  const total = async () =>
    (await server.gateStorage.get<{ bytes: number; uploads: number }>('gate')) ?? {
      bytes: 0,
      uploads: 0,
    };

  it('keeps one total of bytes and uploads across every library', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22, 12) });
    const first = client(libraryId(), token());
    const second = client(libraryId(), token());
    await first.unlock();
    await second.unlock();
    expect((await first.put(ITEM, [100, 50])).status).toBe(200);
    expect(await total()).toMatchObject({ bytes: 150, uploads: 1 });

    // Nearly full in all, though the second library holds nothing yet.
    await server.gateStorage.put('gate', { ...(await total()), bytes: LIMITS.bytes - 50 });
    expect((await second.put(ITEM, [100])).status).toBe(507);
    await server.gateStorage.put('gate', { ...(await total()), bytes: 150 });

    await server.gateStorage.put('gate', {
      ...(await total()),
      day: '2026-10-22',
      uploads: LIMITS.uploadsPerDay,
    });
    const today = await second.put(ITEM, [100]);
    expect(today.status).toBe(429);
    expect(await today.json()).toMatchObject({ retryAt: Date.UTC(2026, 9, 23) });
    expect(server.bucket.files.size).toBe(1);

    // Deleting gives the room back.
    expect((await first.remove([ITEM])).status).toBe(204);
    expect((await total()).bytes).toBe(0);
  });

  it('gives the room back when a library is deleted', async () => {
    const device = client(libraryId(), token());
    await device.unlock();
    await device.put(ITEM, [100]);
    await device.put('photo-0002', [200]);
    expect((await total()).bytes).toBe(300);
    expect((await device.call('', { method: 'DELETE' })).status).toBe(202);
    expect((await total()).bytes).toBe(0);
    // Asking again while it's being deleted doesn't give it back twice.
    await server.gateStorage.put('gate', { ...(await total()), bytes: 1000 });
    expect((await device.call('', { method: 'DELETE' })).status).toBe(202);
    expect((await total()).bytes).toBe(1000);
  });

  it('a stranger’s made-up library costs no R2 reads, lists or rows', async () => {
    const stranger = client(libraryId(), token());
    const get = vi.spyOn(server.bucket, 'get');
    const list = vi.spyOn(server.bucket, 'list');
    const ids = Array.from({ length: LIMITS.firstParts }, (_, index) => `photo-${1000 + index}`);

    const parts = await stranger.post('/first-parts', { items: ids.map((id) => [id, 100]) });
    expect(parts.status).toBe(200);
    expect(new Uint8Array(await parts.arrayBuffer())).toEqual(new Uint8Array(4 * ids.length));
    expect((await stranger.call(`/items/${ITEM}?offset=0&length=10`)).status).toBe(404);
    expect(get).not.toHaveBeenCalled();

    expect((await stranger.remove(ids)).status).toBe(204);
    const storage = [...server.objects.values()][0]?.storage;
    // Its (empty) list, and the room it was given (docs/adr/0017).
    expect([...(storage?.map.keys() ?? [])].sort()).toEqual(['meta', 'meter:granted']);

    expect((await stranger.call('', { method: 'DELETE' })).status).toBe(202);
    expect(storage?.alarm).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it('starts a deletion again if its alarm stopped', async () => {
    const device = client(libraryId(), token());
    await device.unlock();
    await device.put(ITEM, [100]);
    await device.call('', { method: 'DELETE' });
    const storage = [...server.objects.values()][0]?.storage;
    if (storage) storage.alarm = null;
    expect((await device.changes()).wiping).toBe(true);
    expect(storage?.alarm).not.toBeNull();
  });
});

describe('deleting a library', () => {
  it('empties the list at once, deletes the files in batches, then starts again', async () => {
    const library = libraryId();
    const device = client(library, token());
    await device.unlock();
    await device.put(ITEM, [100]);
    const { epoch } = await device.changes();
    // Plenty more files than one batch.
    const prefix = (await fileKey(library, '')).slice(0, -1);
    for (let index = 0; index < 1500; index += 1) {
      server.bucket.files.set(`${prefix}/extra-${index}`, new Uint8Array(1));
    }
    const other = await fileKey(libraryId(), ITEM);
    server.bucket.files.set(other, new Uint8Array(1));

    expect((await device.call('', { method: 'DELETE' })).status).toBe(202);
    const wiping = await device.changes();
    expect(wiping).toMatchObject({ wiping: true, rows: [] });
    expect((await device.put('photo-0002', [100])).status).toBe(503);

    const { library: object, storage } = [...server.objects.values()][0] ?? {};
    while (storage?.alarm !== null && storage?.alarm !== undefined) {
      storage.alarm = null;
      await object?.alarm();
    }
    // Only this library's files are gone.
    expect([...server.bucket.files.keys()]).toEqual([other]);
    const after = await device.changes();
    expect(after).toMatchObject({ wiping: false, rows: [], unlocked: true });
    expect(after.usage).toMatchObject({ items: 0, bytes: 0 });
    expect(after.epoch).not.toBe(epoch);
    expect((await device.put(ITEM, [100])).status).toBe(200);
  });
});

describe('files left in R2 outside the list (audit finding B-7)', () => {
  /** Wakes each library whose alarm is due by now, until none is. */
  async function wake() {
    for (const { library, storage } of server.objects.values()) {
      while (storage.alarm !== null && storage.alarm <= Date.now()) {
        storage.alarm = null;
        await library.alarm();
      }
    }
  }
  const HOUR_MS = 60 * 60 * 1000;

  it('are deleted by the weekly clean-up once they’re a day old', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 24, 9), toFake: ['Date'] });
    const library = libraryId();
    const device = client(library, token());
    await device.unlock();
    expect((await device.put(ITEM, [100])).status).toBe(200);
    const { storage } = server.objects.get(library) ?? {};
    if (!storage) throw new Error('No library');

    // The list can't be written (say the day's free writes are used up), after the upload.
    const put = storage.put.bind(storage);
    storage.put = async (key, value) => {
      if (key.startsWith('seq:')) throw new Error('storage write failed');
      return put(key, value);
    };
    expect((await device.put('photo-0002', [100])).status).toBe(500);
    storage.put = put;
    const stray = await fileKey(library, 'photo-0002');
    expect(server.bucket.files.has(stray)).toBe(true);
    expect((await device.changes()).usage.items).toBe(1);

    // A week later: the stray goes; the photo in the list, and one still on its way in, stay.
    vi.setSystemTime(Date.now() + SWEEP_MS);
    const young = await fileKey(library, 'photo-0003');
    server.bucket.files.set(young, new Uint8Array(1));
    server.bucket.uploaded.set(young, Date.now() - HOUR_MS);
    await wake();
    expect(server.bucket.files.has(stray)).toBe(false);
    expect(server.bucket.files.has(await fileKey(library, ITEM))).toBe(true);
    expect(server.bucket.files.has(young)).toBe(true);
    // And again in a week, while the library has files.
    expect(storage.alarm).toBe(Date.now() + SWEEP_MS);
  });

  it('are looked for a batch at a time, and only in that library', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 24, 9), toFake: ['Date'] });
    const library = libraryId();
    const device = client(library, token());
    await device.unlock();
    await device.put(ITEM, [100]);
    const prefix = (await fileKey(library, '')).slice(0, -1);
    for (let index = 0; index < 2500; index += 1) {
      server.bucket.files.set(`${prefix}/stray-${index}`, new Uint8Array(1));
    }
    const other = await fileKey(libraryId(), 'photo-0009');
    server.bucket.files.set(other, new Uint8Array(1));
    const list = vi.spyOn(server.bucket, 'list');

    vi.setSystemTime(Date.now() + SWEEP_MS);
    await wake();
    expect([...server.bucket.files.keys()].sort()).toEqual(
      [other, await fileKey(library, ITEM)].sort(),
    );
    expect(list).toHaveBeenCalledTimes(3);
    expect([...(server.objects.get(library)?.storage.map.keys() ?? [])]).not.toContain('sweep');
  });

  it('aren’t looked for in a library nobody uploaded to', async () => {
    const device = client(libraryId(), token());
    await device.unlock();
    await device.changes();
    expect([...server.objects.values()].map(({ storage }) => storage.alarm)).toEqual([null, null]);
  });

  it('a photo on its way up while the library is deleted doesn’t come back in the new one', async () => {
    const library = libraryId();
    const device = client(library, token());
    await device.unlock();
    await device.put(ITEM, [100]);
    // Its upload has begun, but reaches R2 only after the deletion has finished.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let uploadingToR2 = false;
    const realPut = server.bucket.put.bind(server.bucket);
    server.bucket.put = async (key, value) => {
      uploadingToR2 = true;
      await held;
      return realPut(key, value);
    };
    const uploading = device.put('photo-0002', [100]);
    await vi.waitFor(() => expect(uploadingToR2).toBe(true));

    expect((await device.call('', { method: 'DELETE' })).status).toBe(202);
    await wake();
    expect((await device.changes()).wiping).toBe(false);
    release();

    const response = await uploading;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ wiping: true });
    expect((await device.changes()).rows).toEqual([]);
    expect([...server.bucket.files.keys()]).toEqual([]);
  });
});

describe('how many libraries there can be (docs/adr/0017)', () => {
  it('stops made-up libraries at the limit, and keeps nothing for one turned down', async () => {
    const preview = (library: string) =>
      server.fetch(
        new Request('https://pr-9-photos.shkriuss.workers.dev/api/library/changes?since=0', {
          headers: { Authorization: `Bearer ${token()}`, 'X-Library': library },
        }),
      );
    let kept = 0;
    for (; kept < 1000; kept += 1) {
      const response = await preview(libraryId());
      if (response.status === 507) break;
      expect(response.status).toBe(200);
    }
    expect(kept).toBe(Math.floor(STORAGE_LIMITS.preview / (16 * 1024)));
    const stored = [...server.objects.values()].filter(({ storage }) => storage.map.size > 0);
    // The libraries, and the meter that counts them.
    expect(stored).toHaveLength(kept + 1);
  });
});
