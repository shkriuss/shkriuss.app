/**
 * The library server (worker.ts): the real Worker code and Durable Object,
 * with storage and R2 in memory (testing.ts).
 */
import { randomBytes, sha256, toBase64Url } from '@shkriuss/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLibrary } from './testing.ts';
import { LIMITS, type Changes } from './validate.ts';

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

/** A device's way into one library. */
function client(library: string, bearer: string) {
  const headers = (more: Record<string, string> = {}) => ({
    Authorization: `Bearer ${bearer}`,
    'X-Library': library,
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

  it('allows 10 wrong tries an hour', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22, 12) });
    const device = client(libraryId(), token());
    for (let attempt = 0; attempt < LIMITS.unlockTries; attempt += 1) {
      expect((await device.unlock('guess')).status).toBe(403);
    }
    const tooMany = await device.unlock();
    expect(tooMany.status).toBe(429);
    expect(await tooMany.json()).toMatchObject({ tooMany: true });
    vi.setSystemTime(Date.UTC(2026, 9, 22, 13, 1));
    expect((await device.unlock()).status).toBe(204);
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
