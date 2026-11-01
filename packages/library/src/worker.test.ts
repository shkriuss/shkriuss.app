/**
 * The library server (worker.ts): the real Worker code and Durable Object,
 * with storage and R2 in memory (testing.ts).
 */
import { randomBytes, sha256, toBase64Url } from '@shkriuss/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLibrary } from './testing.ts';
import { itemListBytes, LIMITS, NOTE_BYTES, type Changes } from './validate.ts';
import { LOCKED_UNUSED_MS, STORAGE_LIMITS, SWEEP_MS, WIPED_UNUSED_MS } from './worker.ts';

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
    // Not even as a hash of the address and the code, which someone with the
    // code could find by trying every IPv4 address (audit 3 D-8): mixed with
    // a random salt the gate keeps only for the hour.
    const unsalted = toBase64Url(
      await sha256(new TextEncoder().encode(`shkriuss library caller v1 ${CODE} 198.51.100.4`)),
    );
    expect(kept[0]).not.toContain(unsalted.slice(0, 16));
    expect(
      [...server.gateStorage.map.keys()].filter((key) => key.startsWith('salt:')),
    ).toHaveLength(1);
    expect(server.gateStorage.alarm).toBe(Date.UTC(2026, 9, 22, 13));

    vi.setSystemTime(Date.UTC(2026, 9, 22, 13));
    // As Cloudflare runs it: the alarm is cleared first. Nothing's left, so it isn't set again.
    server.gateStorage.alarm = null;
    await server.gate.alarm();
    expect([...server.gateStorage.map.keys()].filter((key) => /^(try|salt):/.test(key))).toEqual(
      [],
    );
    expect(server.gateStorage.alarm).toBeNull();
  });

  it('a right code makes no salt; a new hour has a new one, so tries can’t be linked across hours', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 22, 12, 30) });
    expect((await client(libraryId(), token(), '198.51.100.4').unlock()).status).toBe(204);
    expect([...server.gateStorage.map.keys()]).toEqual([]);

    const tried = async () => {
      expect((await client(libraryId(), token(), '198.51.100.4').unlock('guess')).status).toBe(403);
      return [...server.gateStorage.map.keys()].filter((key) => key.startsWith('try:')).at(-1);
    };
    const first = await tried();
    vi.setSystemTime(Date.UTC(2026, 9, 22, 13, 30));
    await server.gate.alarm();
    const second = await tried();
    expect(first?.split(':')[2]).not.toBe(second?.split(':')[2]);
    // The same caller in the same hour is still one caller.
    await tried();
    expect([...server.gateStorage.map.keys()].filter((key) => key.startsWith('try:'))).toEqual([
      second,
    ]);
    expect(await server.gateStorage.get(second ?? '')).toBe(2);
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

  // One request asking for the same photo 40 times read it 40 times from R2,
  // and each read is billed (audit 6): one that names a photo twice is refused.
  it('reads each first part at most once a request, and only of photos the library has', async () => {
    const { device } = await unlocked();
    await device.put(ITEM, [1000, 50]);
    const get = vi.spyOn(server.bucket, 'get');
    const again = await device.post('/first-parts', {
      items: Array.from({ length: LIMITS.firstParts }, () => [ITEM, 1000]),
    });
    expect(again.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
    const ids = Array.from(
      { length: LIMITS.firstParts - 1 },
      (_, index) => `photo-${2000 + index}`,
    );
    const once = await device.post('/first-parts', {
      items: [ITEM, ...ids].map((id) => [id, 1000]),
    });
    expect(once.status).toBe(200);
    expect(get).toHaveBeenCalledOnce();
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
    // Its (empty) list, the room it was given, and when it was last used, so
    // it's deleted if nobody uses it (docs/adr/0017).
    expect([...(storage?.map.keys() ?? [])].sort()).toEqual(['active', 'meta', 'meter:granted']);

    expect((await stranger.call('', { method: 'DELETE' })).status).toBe(202);
    // Only that clean-up is planned: no files to look for in R2, as it never had any.
    expect(storage?.alarm).toBeGreaterThan(Date.now() + LOCKED_UNUSED_MS - 60_000);
    expect(list).not.toHaveBeenCalled();
  });

  // A library's list (each item's row, with its sealed details, and each
  // deletion note) was counted by no meter: someone with the storage code
  // could fill the storage every app shares with tiny items carrying long
  // details, or with notes for ids that were never there (audit 6).
  describe('the room every library’s list takes', () => {
    const lists = async () =>
      (await server.gateStorage.get<{ lists?: number }>('gate'))?.lists ?? 0;
    /** What a library's list keeps: its rows' keys and values. */
    const kept = (storage: { map: Map<string, unknown> } | undefined) =>
      [...(storage?.map ?? [])]
        .filter(([key]) => key.startsWith('seq:') || key.startsWith('item:'))
        .reduce((sum, [key, value]) => sum + key.length + JSON.stringify(value).length, 0);
    /** Uploads an item of one 28-byte part with `chars` characters of details. */
    const tiny = (
      device: ReturnType<typeof client>,
      id: string,
      chars: number = LIMITS.detailsChars,
    ) =>
      device.call(`/items/${id}`, {
        method: 'PUT',
        body: new Uint8Array(28),
        headers: {
          'Content-Length': '28',
          'X-Library-Parts': '28',
          'X-Library-Key': 'k1',
          'X-Library-Details': 'D'.repeat(chars),
        },
      });

    it('counts at least what each list keeps, long details and deletion notes included', async () => {
      const device = client(libraryId(), token());
      await device.unlock();
      const storage = [...server.objects.values()][0]?.storage;
      for (let index = 0; index < 20; index += 1) {
        expect((await tiny(device, `photo-${1000 + index}`)).status).toBe(200);
      }
      expect(await lists()).toBeGreaterThanOrEqual(kept(storage));
      // Notes for ids it never had (they may be on their way up), and for some it has.
      const never = Array.from({ length: LIMITS.remove }, (_, index) => `never-${1000 + index}`);
      expect((await device.remove(never)).status).toBe(204);
      expect((await device.remove(['photo-1000', 'photo-1001'])).status).toBe(204);
      expect(await lists()).toBeGreaterThanOrEqual(kept(storage));
      // Kept as the library's own count too, which a deletion gives back.
      const meta = await storage?.get<{ list: number }>('meta');
      expect(meta?.list).toBe(await lists());
    });

    it('stops uploads, and notes for ids a list never had, once the room is full', async () => {
      const device = client(libraryId(), token());
      await device.unlock();
      expect((await device.put(ITEM, [100])).status).toBe(200);
      const before = await lists();
      // Nearly full, from every library together.
      const gate = await server.gateStorage.get<Record<string, unknown>>('gate');
      await server.gateStorage.put('gate', { ...gate, lists: LIMITS.listBytes - 100 });
      const full = await device.put('photo-0002', [100]);
      expect(full.status).toBe(507);
      expect(await full.json()).toMatchObject({ full: true });
      expect(server.bucket.files.size).toBe(1);
      // A note for an id it doesn't have isn't kept: nothing can be added anyway.
      const storage = [...server.objects.values()][0]?.storage;
      const rows = storage?.map.size;
      expect((await device.remove(['photo-never'])).status).toBe(204);
      expect(storage?.map.size).toBe(rows);
      // Deleting a photo it has is never refused: its note takes its room.
      expect((await device.remove([ITEM])).status).toBe(204);
      expect(server.bucket.files.size).toBe(0);
      expect((await device.changes()).rows).toEqual([
        { id: ITEM, seq: 2, deleted: true, at: expect.any(Number) },
      ]);
      expect(await lists()).toBe(LIMITS.listBytes - 100 - (before - NOTE_BYTES));
    });

    it('gives a list’s room back when its library is deleted', async () => {
      const first = client(libraryId(), token());
      const second = client(libraryId(), token());
      await first.unlock();
      await second.unlock();
      await tiny(first, 'photo-1000');
      await first.remove(['never-1000']);
      await tiny(second, 'photo-2000', 40);
      const theirs = itemListBytes({
        id: 'photo-2000',
        key: 'k1',
        details: 'D'.repeat(40),
        parts: [28],
      });
      expect(await lists()).toBeGreaterThan(theirs);
      expect((await first.call('', { method: 'DELETE' })).status).toBe(202);
      expect(await lists()).toBe(theirs);
      // Asking again while it's being deleted doesn't give it back twice.
      expect((await first.call('', { method: 'DELETE' })).status).toBe(202);
      expect(await lists()).toBe(theirs);
      // Once deleted, the list starts again from nothing.
      vi.useFakeTimers({ now: Date.now(), toFake: ['Date'] });
      const storage = [...server.objects.values()][0]?.storage;
      if (storage) storage.alarm = null;
      await [...server.objects.values()][0]?.library.alarm();
      expect((await storage?.get<{ list: number }>('meta'))?.list).toBe(0);
    });
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
    // Each batch's alarm is due at once; what's left has its own, months away (audit 3 D-2).
    while (storage?.alarm !== null && storage?.alarm !== undefined && storage.alarm <= Date.now()) {
      storage.alarm = null;
      await object?.alarm();
    }
    // Only this library's files are gone.
    expect([...server.bucket.files.keys()]).toEqual([other]);
    const after = await device.changes();
    // Locked until the storage code is given again (audit 4 D-1).
    expect(after).toMatchObject({ wiping: false, rows: [], unlocked: false });
    expect(after.usage).toMatchObject({ items: 0, bytes: 0 });
    expect(after.epoch).not.toBe(epoch);
    expect((await device.unlock()).status).toBe(204);
    expect((await device.put(ITEM, [100])).status).toBe(200);
  });

  it('a device still putting photos online can’t fill it again (audit 4 D-1)', async () => {
    // The tablet uploads; the phone deletes the online copy. Until the tablet's
    // own sync hears of it, its upload rounds would start the library again.
    const library = libraryId();
    const access = token();
    const phone = client(library, access);
    const tablet = client(library, access);
    await phone.unlock();
    expect((await tablet.put(ITEM, [100])).status).toBe(200);
    expect((await phone.call('', { method: 'DELETE' })).status).toBe(202);
    const { library: object, storage } = [...server.objects.values()][0] ?? {};
    while (storage?.alarm !== null && storage?.alarm !== undefined && storage.alarm <= Date.now()) {
      storage.alarm = null;
      await object?.alarm();
    }
    const refused = await tablet.put('photo-0002', [100]);
    expect(refused.status).toBe(423);
    expect(await refused.json()).toMatchObject({ locked: true });
    expect(server.bucket.files.size).toBe(0);
    expect((await tablet.changes()).rows).toEqual([]);
  });

  it('one deleted before deleted libraries were locked is locked too (audit 4 D-1)', async () => {
    const library = libraryId();
    const access = token();
    const phone = client(library, access);
    await phone.unlock();
    const { library: object, storage } = [...server.objects.values()][0] ?? {};
    const meta = () => storage?.map.get('meta') as Record<string, unknown>;
    const code = meta()['unlockedWith'];
    expect((await phone.call('', { method: 'DELETE' })).status).toBe(202);
    while (storage?.alarm !== null && storage?.alarm !== undefined && storage.alarm <= Date.now()) {
      storage.alarm = null;
      await object?.alarm();
    }
    // What a deletion left before then: still unlocked with the code.
    const { wipeLocked: _, ...before } = meta();
    storage?.map.set('meta', { ...before, unlockedWith: code });
    expect((await phone.changes()).unlocked).toBe(false);
    expect((await phone.put(ITEM, [100])).status).toBe(423);
    // Given again, the code works, and stays working.
    expect((await phone.unlock()).status).toBe(204);
    expect((await phone.put(ITEM, [100])).status).toBe(200);
    expect((await phone.put('photo-0002', [100])).status).toBe(200);
  });
});

describe('an alarm while R2 fails (audit B-2)', () => {
  /**
   * Wakes the library whenever its alarm is due, as Cloudflare does: an alarm
   * that throws is tried 6 more times (2 seconds later, doubling), then never
   * again.
   */
  async function runAlarms() {
    const { library, storage } = [...server.objects.values()][0] ?? {};
    let retries = 0;
    while (library && storage?.alarm !== null && storage?.alarm !== undefined) {
      vi.setSystemTime(Math.max(Date.now(), storage.alarm));
      storage.alarm = null;
      try {
        await library.alarm();
        retries = 0;
      } catch {
        if (retries === 6) return;
        retries += 1;
        storage.alarm = Date.now() + 1000 * 2 ** retries;
      }
    }
  }

  it('still deletes every file of a deleted library once R2 is back', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 25), toFake: ['Date'] });
    const device = client(libraryId(), token());
    await device.unlock();
    await device.put(ITEM, [100]);
    // R2 fails for 10 minutes, far longer than Cloudflare's own retries.
    const list = server.bucket.list.bind(server.bucket);
    const outage = Date.now() + 10 * 60_000;
    vi.spyOn(server.bucket, 'list').mockImplementation(async (options) => {
      if (Date.now() < outage) throw new Error('R2 is unavailable');
      return list(options);
    });
    expect((await device.call('', { method: 'DELETE' })).status).toBe(202);
    await runAlarms();
    expect([...server.bucket.files.keys()]).toEqual([]);
    expect(await device.changes()).toMatchObject({ wiping: false, rows: [] });
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

describe('libraries nobody unlocked (docs/adr/0017)', () => {
  const START = Date.UTC(2026, 9, 22, 12);
  const DAY = 24 * 60 * 60 * 1000;
  /** A library made up by a stranger, its storage, and the meter's. */
  async function madeUp() {
    vi.useFakeTimers({ now: START });
    const library = libraryId();
    const device = client(library, token());
    expect((await device.call('/changes?since=0')).status).toBe(200);
    const object = server.objects.get(library);
    const meter = server.objects.get('meter')?.storage;
    if (!object || !meter) throw new Error('No library');
    return { device, object, meter };
  }
  const wake = async (object: { library: { alarm(): Promise<void> } }) => object.library.alarm();

  it('are deleted when nobody used them for 30 days, giving their room back', async () => {
    const { object, meter } = await madeUp();
    expect(await meter.get('total')).toBeGreaterThan(0);
    expect(object.storage.alarm).toBe(START + LOCKED_UNUSED_MS);

    vi.setSystemTime(START + LOCKED_UNUSED_MS);
    await wake(object);
    expect(object.storage.map.size).toBe(0);
    expect(await meter.get('total')).toBe(0);
  });

  it('stay while they’re used: the 30 days start again (at most once a day)', async () => {
    const { device, object } = await madeUp();
    vi.setSystemTime(START + 12 * 60 * 60 * 1000);
    await device.changes();
    expect(object.storage.alarm).toBe(START + LOCKED_UNUSED_MS);

    vi.setSystemTime(START + 20 * DAY);
    await device.changes();
    expect(object.storage.alarm).toBe(START + 20 * DAY + LOCKED_UNUSED_MS);
    // An alarm from before (or one that ran early) waits for the new time.
    vi.setSystemTime(START + LOCKED_UNUSED_MS);
    await wake(object);
    expect(object.storage.map.has('meta')).toBe(true);
    expect(object.storage.alarm).toBe(START + 20 * DAY + LOCKED_UNUSED_MS);
  });

  it('the device that used one just makes it again', async () => {
    const { device, object } = await madeUp();
    vi.setSystemTime(START + LOCKED_UNUSED_MS);
    await wake(object);
    expect(object.storage.map.size).toBe(0);
    expect((await device.call('/changes?since=0')).status).toBe(200);
    expect((await device.unlock()).status).toBe(204);
  });

  it('once unlocked, a library stays, used or not', async () => {
    const { device, object } = await madeUp();
    await device.unlock();
    expect(object.storage.alarm).toBeNull();
    expect(object.storage.map.has('active')).toBe(false);

    vi.setSystemTime(START + 2 * LOCKED_UNUSED_MS);
    await wake(object);
    expect(object.storage.map.has('meta')).toBe(true);
  });

  it('deleting one keeps its room counted, and its clean-up', async () => {
    const { device, object, meter } = await madeUp();
    const total = await meter.get('total');
    vi.setSystemTime(START + DAY);
    expect((await device.call('', { method: 'DELETE' })).status).toBe(202);
    expect(object.storage.map.has('meter:granted')).toBe(true);
    expect(object.storage.alarm).toBe(START + DAY + LOCKED_UNUSED_MS);

    vi.setSystemTime(START + DAY + LOCKED_UNUSED_MS);
    await wake(object);
    expect(object.storage.map.size).toBe(0);
    expect(await meter.get('total')).toBe((total as number) - 16 * 1024);
  });

  it('someone else’s token doesn’t keep one', async () => {
    const { object } = await madeUp();
    const library = [...server.objects.entries()].find(([, found]) => found === object)?.[0] ?? '';
    vi.setSystemTime(START + 20 * DAY);
    expect((await client(library, token()).call('/changes?since=0')).status).toBe(403);
    expect(object.storage.alarm).toBe(START + LOCKED_UNUSED_MS);
    // Nor does a move that isn't allowed (the old token isn't the library's).
    expect((await client(library, token()).post('/move', { from: token() })).status).toBe(403);
    expect(object.storage.alarm).toBe(START + LOCKED_UNUSED_MS);
  });

  it('one made up through a move is deleted when unused too (audit 5 B-1)', async () => {
    // A move was the one first request that didn't plan the clean-up, so a
    // stranger could fill the libraries' room for good with them.
    vi.useFakeTimers({ now: START });
    const library = libraryId();
    const device = client(library, token());
    expect((await device.post('/move', { from: token() })).status).toBe(204);
    const object = server.objects.get(library);
    const meter = server.objects.get('meter')?.storage;
    if (!object || !meter) throw new Error('No library');
    expect(await meter.get('total')).toBe(16 * 1024);
    expect(object.storage.map.has('active')).toBe(true);
    expect(object.storage.alarm).toBe(START + LOCKED_UNUSED_MS);

    vi.setSystemTime(START + LOCKED_UNUSED_MS);
    await wake(object);
    expect(object.storage.map.size).toBe(0);
    expect(await meter.get('total')).toBe(0);
  });

  it('made up through moves, they give their room back for real ones after 30 days (audit 5 B-1)', async () => {
    vi.useFakeTimers({ now: START });
    // Room for two libraries, both taken by a stranger's moves.
    server = memoryLibrary(CODE, { limit: 2 * 16 * 1024 });
    for (let index = 0; index < 2; index += 1) {
      expect((await client(libraryId(), token()).post('/move', { from: token() })).status).toBe(
        204,
      );
    }
    const theirs = client(libraryId(), token());
    expect((await theirs.call('/changes?since=0')).status).toBe(507);
    // Once nobody has used the junk for 30 days, it goes, and a real device's library fits.
    vi.setSystemTime(START + LOCKED_UNUSED_MS);
    for (const object of server.objects.values()) {
      if (object.storage.alarm !== null && object.storage.alarm <= Date.now()) await wake(object);
    }
    expect((await theirs.call('/changes?since=0')).status).toBe(200);
  });

  it('an unlocked library moved to a new key keeps no clean-up, like any unlocked one', async () => {
    vi.useFakeTimers({ now: START });
    const library = libraryId();
    const oldToken = token();
    const device = client(library, oldToken);
    await device.unlock();
    expect((await client(library, token()).post('/move', { from: oldToken })).status).toBe(204);
    const object = server.objects.get(library);
    expect(object?.storage.alarm).toBeNull();
    expect(object?.storage.map.has('active')).toBe(false);
  });
});

describe('what’s left after “Delete the online copy” (audit 3 D-2)', () => {
  const START = Date.UTC(2026, 9, 25, 12);
  const DAY = 24 * 60 * 60 * 1000;

  /** An unlocked library with a photo, deleted at START: its files are gone a moment later. */
  async function deleted() {
    vi.useFakeTimers({ now: START, toFake: ['Date'] });
    const library = libraryId();
    const device = client(library, token());
    await device.unlock();
    expect((await device.put(ITEM, [100])).status).toBe(200);
    const object = server.objects.get(library);
    const meter = server.objects.get('meter')?.storage;
    if (!object || !meter) throw new Error('No library');
    const total = (await meter.get<number>('total')) ?? 0;
    expect((await device.call('', { method: 'DELETE' })).status).toBe(202);
    await until(object, START + 60_000);
    expect(server.bucket.files.size).toBe(0);
    return { library, device, object, meter, total };
  }

  /** Lets time pass until `end`, waking the library whenever its alarm is due, as Cloudflare does. */
  async function until(
    object: { library: { alarm(): Promise<void> }; storage: { alarm: number | null } },
    end: number,
  ) {
    while (object.storage.alarm !== null && object.storage.alarm <= end) {
      vi.setSystemTime(Math.max(Date.now(), object.storage.alarm));
      object.storage.alarm = null;
      await object.library.alarm();
    }
    vi.setSystemTime(end);
  }

  it('goes 13 months after it was last used, and gives its room back', async () => {
    const { object, meter, total } = await deleted();
    // Who it belongs to and how many changes it had, for now; the room it takes stays counted.
    expect([...object.storage.map.keys()].sort()).toEqual(['active', 'meta', 'meter:granted']);
    expect(object.storage.alarm).toBe(START + WIPED_UNUSED_MS);

    await until(object, START + WIPED_UNUSED_MS - DAY);
    expect(object.storage.map.has('meta')).toBe(true);
    await until(object, START + WIPED_UNUSED_MS);
    expect(object.storage.map.size).toBe(0);
    expect(object.storage.alarm).toBeNull();
    expect(await meter.get('total')).toBe(total - 16 * 1024);
  });

  it('stays while a device still uses it: the 13 months start again (at most once a day)', async () => {
    const { device, object } = await deleted();
    await until(object, START + 200 * DAY);
    expect((await device.changes()).rows).toEqual([]);
    expect(object.storage.alarm).toBe(START + 200 * DAY + WIPED_UNUSED_MS);
    await until(object, START + WIPED_UNUSED_MS + DAY);
    expect(object.storage.map.has('meta')).toBe(true);
    await until(object, START + 200 * DAY + WIPED_UNUSED_MS);
    expect(object.storage.map.size).toBe(0);
    // A device that comes back later just makes it again, locked.
    expect((await device.changes()).unlocked).toBe(false);
  });

  it('with photos again, it’s kept like any unlocked library, with its weekly clean-up', async () => {
    const { device, object } = await deleted();
    await until(object, START + DAY);
    // Only once the storage code is given again (audit 4 D-1).
    expect((await device.put('photo-0002', [100])).status).toBe(423);
    expect((await device.unlock()).status).toBe(204);
    expect(object.storage.alarm).toBe(START + DAY + WIPED_UNUSED_MS);
    expect((await device.put('photo-0002', [100])).status).toBe(200);
    expect(object.storage.map.has('active')).toBe(false);
    expect(object.storage.alarm).toBe(START + DAY + SWEEP_MS);
    await until(object, START + 3 * WIPED_UNUSED_MS);
    expect((await device.changes()).rows.map((row) => row.id)).toEqual(['photo-0002']);
    expect(server.bucket.files.size).toBe(1);
  });

  it('deletes a file an upload left in R2 after the deletion, before it goes', async () => {
    const { library, object } = await deleted();
    // An upload begun after the deletion, whose commit failed: its file is outside the list.
    server.bucket.files.set(await fileKey(library, 'photo-0003'), new Uint8Array(1));
    await until(object, START + WIPED_UNUSED_MS);
    expect(server.bucket.files.size).toBe(0);
    expect(object.storage.map.size).toBe(0);
  });

  it('giving the storage code again (a new one) doesn’t keep it for good', async () => {
    const { device, object } = await deleted();
    server.env.LIBRARY_STORAGE_CODE = 'a new passphrase';
    await until(object, START + DAY);
    expect((await device.unlock('a new passphrase')).status).toBe(204);
    expect(object.storage.alarm).toBe(START + DAY + WIPED_UNUSED_MS);
    await until(object, START + DAY + WIPED_UNUSED_MS);
    expect(object.storage.map.size).toBe(0);
  });

  it('deleted again, it starts its 13 months again once its files are gone', async () => {
    const { device, object } = await deleted();
    await until(object, START + 100 * DAY);
    expect((await device.call('', { method: 'DELETE' })).status).toBe(202);
    await until(object, START + 100 * DAY + 60_000);
    expect(object.storage.alarm).toBe(START + 100 * DAY + WIPED_UNUSED_MS);
  });
});

// The other tests read these from the code, so they check how each works,
// never its value. These pin the values that the docs promise: changing
// one fails here, and means changing those lines too (audit 3 J-4).
describe('how long things are kept, as the docs promise', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('a library never unlocked: 30 days after it was last used', () => {
    // ADR 0017: "An online library that was never unlocked (with the storage
    // code) is deleted 30 days after it was last used."
    expect(LOCKED_UNUSED_MS).toBe(30 * DAY);
  });

  it('files left outside the list: looked for once a week', () => {
    // ADR 0016: "So once a week, a library with files deletes those in R2 that
    // its list doesn't have".
    expect(SWEEP_MS).toBe(7 * DAY);
  });

  it('what’s left after “Delete the online copy”: 13 months after it was last used', () => {
    // ADR 0016: "once nobody has used it for 13 months"; the same 13 months as
    // sync's note that a copy was deleted (UNUSED_MS in packages/sync).
    expect(WIPED_UNUSED_MS).toBe(396 * DAY);
  });
});

describe('how many libraries there can be (docs/adr/0017)', () => {
  it('stops made-up libraries at the limit, and keeps nothing for one turned down', async () => {
    // A small limit, so they fill it quickly.
    const limit = 4_000_000;
    server = memoryLibrary(CODE, { limit });
    const ask = (library: string) =>
      server.fetch(
        new Request(`${ORIGIN}/api/library/changes?since=0`, {
          headers: { Authorization: `Bearer ${token()}`, 'X-Library': library },
        }),
      );
    let kept = 0;
    for (; kept < 1000; kept += 1) {
      const response = await ask(libraryId());
      if (response.status === 507) break;
      expect(response.status).toBe(200);
    }
    expect(kept).toBe(Math.floor(limit / (16 * 1024)));
    const stored = [...server.objects.values()].filter(({ storage }) => storage.map.size > 0);
    // The libraries, and the meter that counts them.
    expect(stored).toHaveLength(kept + 1);
    // The Worker tells each library the real limit.
    expect(new Set(server.limits())).toEqual(new Set([String(STORAGE_LIMITS)]));
  });
});
