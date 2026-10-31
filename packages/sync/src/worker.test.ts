/**
 * The sync server's limits (docs/adr/0017-storage-limits.md): anyone can make
 * up a token, so all of an app's copies together have a limit, nothing is
 * kept for a token that only asks, and copies nobody uses are deleted.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import { OBJECT_BYTES } from '@shkriuss/server/meter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memorySync } from './testing.ts';
import { MAX_FILE_BYTES, MAX_REQUEST_BYTES, MAX_SEALED_CHARS } from './validate.ts';
import { STORAGE_LIMITS, UNUSED_MS } from './worker.ts';

const SITE = 'https://notes.shkriuss.app';
/** Small limits for all copies together, so tests fill them quickly (the real ones: STORAGE_LIMITS). */
const COPIES_LIMIT = 20_000_000;
const FILES_LIMIT = 80_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const madeUpToken = () => toBase64Url(randomBytes(32));
const chunk = toBase64Url(randomBytes(48_000));
const sealed = (length: number) => chunk.repeat(Math.ceil(length / chunk.length)).slice(0, length);

function request(origin: string, path: string, token: string, init: RequestInit = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  return new Request(`${origin}/api/sync/${path}`, { ...init, headers });
}
const put = (origin: string, token: string, base: number | null, data: string) =>
  request(origin, 'copy', token, { method: 'PUT', body: JSON.stringify({ base, data }) });

/** Adds made-up copies of this size until the app's limit stops them; how many fit. */
async function fillUp(server: ReturnType<typeof memorySync>, size: number): Promise<string[]> {
  const tokens: string[] = [];
  for (let tries = 0; tries < 5000; tries += 1) {
    const token = madeUpToken();
    const response = await server.fetch(put(SITE, token, null, sealed(size)));
    if (response.status === 507) return tokens;
    expect(response.status).toBe(200);
    tokens.push(token);
  }
  throw new Error('The limit never stopped them.');
}

/** Bytes kept by every object but the meter: strings by length, byte arrays by size. */
function keptBytes(server: ReturnType<typeof memorySync>): number {
  let total = 0;
  for (const [name, { storage }] of server.copies.objects) {
    if (name === 'meter') continue;
    for (const value of storage.map.values()) {
      total += value instanceof Uint8Array ? value.length : JSON.stringify(value).length;
    }
  }
  return total;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('all of an app’s copies together', () => {
  it('stop at the app’s limit, however many tokens are made up', async () => {
    const server = memorySync({ limit: COPIES_LIMIT });
    const biggest = sealed(MAX_SEALED_CHARS);
    const statuses: number[] = [];
    for (let index = 0; index < 15; index += 1) {
      statuses.push((await server.fetch(put(SITE, madeUpToken(), null, biggest))).status);
    }
    const kept = statuses.filter((status) => status === 200).length;
    expect(kept).toBeGreaterThan(3);
    expect(statuses.slice(kept).every((status) => status === 507)).toBe(true);
    expect(keptBytes(server)).toBeLessThan(COPIES_LIMIT);
    // A refused copy keeps nothing at all.
    expect(server.copies.stored()).toHaveLength(kept + 1);
  });

  it('each count for at least 16 KB, so tiny ones run out too', async () => {
    const kept = await fillUp(memorySync({ limit: COPIES_LIMIT }), 40);
    expect(kept).toHaveLength(Math.floor(COPIES_LIMIT / (OBJECT_BYTES + 40 + 8192)));
  });

  it('leave copies already online syncing when the limit is reached', async () => {
    const server = memorySync({ limit: COPIES_LIMIT });
    const mine = madeUpToken();
    const first = await server.fetch(put(SITE, mine, null, sealed(100_000)));
    expect(first.status).toBe(200);
    await fillUp(server, MAX_SEALED_CHARS);

    // Changes of about the same size fit in the room the copy already has.
    let version = ((await first.json()) as { version: number }).version;
    for (const size of [100_000, 110_000, 95_000]) {
      const response = await server.fetch(put(SITE, mine, version, sealed(size)));
      expect(response.status).toBe(200);
      version = ((await response.json()) as { version: number }).version;
    }
    // A much bigger one needs room nobody has.
    const bigger = await server.fetch(put(SITE, mine, version, sealed(MAX_SEALED_CHARS)));
    expect(bigger.status).toBe(507);
    expect(await bigger.json()).toEqual({
      error: 'There’s no room left online for this app just now.',
    });
  });

  it('get room back when one is deleted', async () => {
    const server = memorySync({ limit: COPIES_LIMIT });
    const tokens = await fillUp(server, MAX_SEALED_CHARS);
    const deleted = await server.fetch(
      request(SITE, 'copy', tokens[0] ?? '', { method: 'DELETE' }),
    );
    expect(deleted.status).toBe(204);
    expect((await server.fetch(put(SITE, madeUpToken(), null, sealed(MAX_SEALED_CHARS)))).ok).toBe(
      true,
    );
  });

  it('have the app’s own limit: for copies only, or with their files', async () => {
    const server = memorySync();
    const biggest = sealed(MAX_SEALED_CHARS);
    for (let index = 0; index < 15; index += 1) {
      expect((await server.fetch(put(SITE, madeUpToken(), null, biggest))).status).toBe(200);
    }
    const file = await server.fetchWithFiles(
      request(SITE, 'files/photo-0', madeUpToken(), { method: 'PUT', body: new Uint8Array(1000) }),
    );
    expect(file.status).toBe(204);
    expect(new Set(server.copies.limits())).toEqual(
      new Set([String(STORAGE_LIMITS.copies), String(STORAGE_LIMITS.files)]),
    );
  });

  it('with files, count the files too', async () => {
    const server = memorySync({ limit: FILES_LIMIT });
    const token = madeUpToken();
    const file = new Uint8Array(1_500_000);
    const statuses: number[] = [];
    for (let index = 0; index < 70; index += 1) {
      const response = await server.fetchWithFiles(
        request(SITE, `files/photo-${index}`, token, { method: 'PUT', body: file }),
      );
      statuses.push(response.status);
    }
    expect(statuses).toContain(204);
    expect(statuses.at(-1)).toBe(507);
    expect(keptBytes(server)).toBeLessThan(FILES_LIMIT);
  });

  it('with the smallest files, count the rows that list them too (audit 5 B-3)', async () => {
    // Besides a file's bytes, the copy keeps a row for the file and an entry
    // in the index of files, each with the file's id. For the smallest files
    // the checks allow, with the longest ids, those took six times the room
    // the meter saw.
    const server = memorySync();
    const token = madeUpToken();
    const file = new Uint8Array(29);
    for (let index = 0; index < 300; index += 1) {
      const id = `f${String(index).padStart(79, 'x')}`;
      const response = await server.fetchWithFiles(
        request(SITE, `files/${id}`, token, { method: 'PUT', body: file }),
      );
      expect(response.status).toBe(204);
    }
    const counted = (await server.copies.objects.get('meter')?.storage.get<number>('total')) ?? 0;
    // What the files really take: their rows, keys and values, and the index.
    const [, copy] = [...server.copies.objects].find(([name]) => name !== 'meter') ?? [];
    let kept = 0;
    for (const [key, value] of copy?.storage.map ?? []) {
      if (key !== 'files' && !key.startsWith('file:')) continue;
      kept +=
        key.length + (value instanceof Uint8Array ? value.length : JSON.stringify(value).length);
    }
    expect(kept).toBeGreaterThan(300 * 29 * 6);
    expect(counted).toBeGreaterThanOrEqual(OBJECT_BYTES + kept);
  });
});

describe('a copy sent to the Worker', () => {
  // Checking a full-size copy takes most of the free plan's 10 ms of CPU time
  // for the Worker, so only the copy's object (with 30 seconds) does it.
  it('reaches its object as it was sent, with only its size checked first', async () => {
    const server = memorySync();
    const { namespace } = server.copies;
    const received: string[] = [];
    server.env.SYNC_COPIES = {
      idFromName: (name) => namespace.idFromName(name),
      get: (id) => ({
        fetch: async (input, init) => {
          if (input === 'https://copy/') received.push(await new Request(input, init).text());
          return namespace.get(id).fetch(input, init);
        },
      }),
    };
    const body = `{ "data": "${sealed(MAX_SEALED_CHARS)}",\n  "base": null }`;
    const sent = request(SITE, 'copy', madeUpToken(), { method: 'PUT', body });
    expect((await server.fetch(sent)).status).toBe(200);
    expect(received.map((text) => text === body)).toEqual([true]);
  });

  it('is checked by its object, which keeps nothing when it’s wrong', async () => {
    const server = memorySync();
    const token = madeUpToken();
    const send = async (body: string) => {
      const response = await server.fetch(request(SITE, 'copy', token, { method: 'PUT', body }));
      return [response.status, ((await response.json()) as { error: string }).error];
    };
    expect(await send('{"base": null, "data": ')).toEqual([400, 'Body must be JSON.']);
    expect(await send(JSON.stringify({ base: null, data: 'not sealed! '.repeat(9) }))).toEqual([
      400,
      '"data" must be a sealed copy.',
    ]);
    expect(await send(JSON.stringify({ base: 0, data: sealed(100) }))).toEqual([
      400,
      '"base" must be a version number or null.',
    ]);
    expect(await send(JSON.stringify({ base: null, data: sealed(100), more: 1 }))).toEqual([
      400,
      'Unknown fields.',
    ]);
    expect(await send(sealed(MAX_REQUEST_BYTES + 1))).toEqual([413, 'Request too big.']);
    expect(server.copies.stored()).toEqual([]);
  });

  it('with files, has each file checked by its object too', async () => {
    const server = memorySync();
    const token = madeUpToken();
    const send = async (body: Uint8Array<ArrayBuffer>) => {
      const sent = request(SITE, 'files/photo-1', token, { method: 'PUT', body });
      const response = await server.fetchWithFiles(sent);
      return [response.status, ((await response.json()) as { error: string }).error];
    };
    expect(await send(new Uint8Array(28))).toEqual([400, 'Not a sealed file.']);
    expect(await send(new Uint8Array(MAX_FILE_BYTES + 1))).toEqual([413, 'Request too big.']);
    expect(server.copies.stored()).toEqual([]);
  });
});

describe('two devices writing the same copy (audit 3 J-1)', () => {
  // ADR 0010: an upload names the version it was based on; if another device
  // wrote first, the server says so (409) and nothing is overwritten unseen.
  const get = (token: string) => request(SITE, 'copy', token);

  it('refuses an upload based on a version that isn’t the latest', async () => {
    const server = memorySync();
    const token = madeUpToken();
    const first = await server.fetch(put(SITE, token, null, sealed(100)));
    const { version } = (await first.json()) as { version: number };
    const tablet = sealed(200);
    expect((await server.fetch(put(SITE, token, version, tablet))).status).toBe(200);
    // The phone, still on the first version, uploads its own change.
    const stale = await server.fetch(put(SITE, token, version, sealed(300)));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: version + 1 });
    expect(((await (await server.fetch(get(token))).json()) as { data: string }).data).toBe(tablet);
  });

  it('refuses a first copy when there is one already', async () => {
    const server = memorySync();
    const token = madeUpToken();
    const phone = sealed(100);
    expect((await server.fetch(put(SITE, token, null, phone))).status).toBe(200);
    // Two devices' first syncs at once: the second must merge, not replace.
    const second = await server.fetch(put(SITE, token, null, sealed(200)));
    expect(second.status).toBe(409);
    expect(((await (await server.fetch(get(token))).json()) as { data: string }).data).toBe(phone);
  });
});

describe('where the hub is', () => {
  it('says so, with the time to the millisecond, for “Turn on sync” (audit 4 E-1)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.UTC(2026, 9, 26, 12, 0, 0, 345);
    vi.setSystemTime(now);
    const answer = await memorySync().fetch(new Request(`${SITE}/api/sync/hub`));
    expect(await answer.json()).toEqual({ origin: 'https://shkriuss.app', now });
  });
});

describe('a deleted copy (audit 4 E-1)', () => {
  const get = (token: string) => request(SITE, 'copy', token);
  const remove = (token: string) => request(SITE, 'copy', token, { method: 'DELETE' });

  const T0 = Date.UTC(2026, 9, 26, 12);
  const endedAt = async (server: ReturnType<typeof memorySync>, token: string) =>
    ((await (await server.fetch(get(token))).json()) as { endedAt?: number }).endedAt;

  it('says when it was deleted, by the server’s clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const server = memorySync();
    const token = madeUpToken();
    await server.fetch(put(SITE, token, null, sealed(100)));
    vi.setSystemTime(T0 + DAY_MS);
    await server.fetch(remove(token));
    vi.setSystemTime(T0 + 3 * DAY_MS);
    const answer = await server.fetch(get(token));
    expect(answer.status).toBe(410);
    expect(await answer.json()).toEqual({
      error: 'The online copy was deleted.',
      deletedAt: T0 + DAY_MS,
    });
  });

  it('started again, says when the one before was deleted, through every change', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const server = memorySync();
    const token = madeUpToken();
    expect((await server.fetch(put(SITE, token, null, sealed(100)))).status).toBe(200);
    // A first copy: no deletion before it.
    expect(await endedAt(server, token)).toBeUndefined();
    vi.setSystemTime(T0 + DAY_MS);
    await server.fetch(remove(token));
    vi.setSystemTime(T0 + 2 * DAY_MS);
    const second = await server.fetch(put(SITE, token, null, sealed(100)));
    const { version } = (await second.json()) as { version: number };
    expect(await endedAt(server, token)).toBe(T0 + DAY_MS);
    expect((await server.fetch(put(SITE, token, version, sealed(200)))).status).toBe(200);
    expect(await endedAt(server, token)).toBe(T0 + DAY_MS);
    // Deleted again, and started again: the latest deletion.
    vi.setSystemTime(T0 + 3 * DAY_MS);
    await server.fetch(remove(token));
    await server.fetch(remove(token));
    vi.setSystemTime(T0 + 4 * DAY_MS);
    expect((await server.fetch(put(SITE, token, null, sealed(100)))).status).toBe(200);
    expect(await endedAt(server, token)).toBe(T0 + 3 * DAY_MS);
  });

  it('can’t be started again once moved to a new account key', async () => {
    const server = memorySync();
    const token = madeUpToken();
    await server.fetch(put(SITE, token, null, sealed(100)));
    await server.fetch(request(SITE, 'copy?moved', token, { method: 'DELETE' }));
    const again = await server.fetch(put(SITE, token, null, sealed(100)));
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ moved: true });
  });
});

describe('the numbers the docs promise (audit 3 J-4)', () => {
  it('delete a copy nobody uses after 396 days', () => {
    // "13 months": the privacy page, docs/adr/0017-storage-limits.md.
    expect(UNUSED_MS).toBe(396 * DAY_MS);
  });

  it('allow 120 changes to a copy in 10 minutes, and no more', async () => {
    // docs/adr/0010-account-and-sync.md: "120 changes per 10 minutes per account".
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = memorySync();
    const token = madeUpToken();
    let version: number | null = null;
    for (let change = 0; change < 120; change += 1) {
      const response = await server.fetch(put(SITE, token, version, sealed(100)));
      expect(response.status).toBe(200);
      version = ((await response.json()) as { version: number }).version;
    }
    expect((await server.fetch(put(SITE, token, version, sealed(100)))).status).toBe(429);
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    expect((await server.fetch(put(SITE, token, version, sealed(100)))).status).toBe(200);
  });

  it('allow 300 changes to a copy’s files in 10 minutes, and no more', async () => {
    // docs/adr/0014-syncing-photos.md: "at most 300 changes in 10 minutes".
    const server = memorySync();
    const token = madeUpToken();
    expect((await server.fetchWithFiles(put(SITE, token, null, sealed(100)))).status).toBe(200);
    const file = (id: number) =>
      request(SITE, `files/f${id}`, token, { method: 'PUT', body: randomBytes(64) });
    for (let change = 0; change < 300; change += 1) {
      expect((await server.fetchWithFiles(file(change))).status).toBe(204);
    }
    expect((await server.fetchWithFiles(file(300))).status).toBe(429);
  });
});

describe('a token that only asks', () => {
  it('leaves nothing behind', async () => {
    const server = memorySync();
    const token = madeUpToken();
    const asks = [
      request(SITE, 'copy', token),
      request(SITE, 'copy?since=3', token),
      request(SITE, 'copy', token, { method: 'DELETE' }),
      put(SITE, token, 4, sealed(100)),
    ];
    for (const ask of asks) expect((await server.fetch(ask)).status).toBeLessThan(500);
    const fileAsks = [
      request(SITE, 'files', token),
      request(SITE, 'files/photo-1', token),
      request(SITE, 'files/photo-1?base=2', token, { method: 'DELETE' }),
    ];
    for (const ask of fileAsks) expect((await server.fetchWithFiles(ask)).status).toBeLessThan(500);
    expect(server.copies.stored()).toEqual([]);
  });
});

describe('a copy nobody uses', () => {
  it('is deleted after about 13 months, and its room given back', async () => {
    vi.useFakeTimers();
    const server = memorySync();
    const token = madeUpToken();
    expect((await server.fetch(put(SITE, token, null, sealed(5000)))).status).toBe(200);
    expect(server.copies.stored().map(([name]) => name)).toContain('meter');

    vi.setSystemTime(Date.now() + UNUSED_MS - DAY_MS);
    expect(await server.copies.runAlarms()).toBe(0);
    vi.setSystemTime(Date.now() + DAY_MS);
    expect(await server.copies.runAlarms()).toBe(1);

    // Nothing is left of it, and the meter no longer counts it.
    const meter = server.copies.objects.get('meter')?.storage.map;
    expect(server.copies.stored().map(([name]) => name)).toEqual(['meter']);
    expect(meter?.get('total')).toBe(0);
    expect([...(meter?.keys() ?? [])]).toEqual(['total']);
  });

  it('stays while a device still syncs, or even just checks', async () => {
    vi.useFakeTimers();
    const server = memorySync();
    const token = madeUpToken();
    const created = await server.fetch(put(SITE, token, null, sealed(5000)));
    const { version } = (await created.json()) as { version: number };
    for (let month = 0; month < 30; month += 1) {
      vi.setSystemTime(Date.now() + 30 * DAY_MS);
      await server.copies.runAlarms();
      expect((await server.fetch(request(SITE, `copy?since=${version}`, token))).status).toBe(204);
    }
  });

  it('starts again from a device’s own data when one comes back later', async () => {
    vi.useFakeTimers();
    const server = memorySync();
    const token = madeUpToken();
    const first = await server.fetch(put(SITE, token, null, sealed(5000)));
    const old = ((await first.json()) as { version: number }).version;
    vi.setSystemTime(Date.now() + UNUSED_MS + DAY_MS);
    await server.copies.runAlarms();

    // As for a first sync: nothing online yet, so the device sends what it has.
    expect(await (await server.fetch(request(SITE, `copy?since=${old}`, token))).json()).toEqual({
      version: 0,
    });
    const again = await server.fetch(put(SITE, token, null, sealed(6000)));
    // Never a version a device saw before, which it would take for the old copy.
    const version = ((await again.json()) as { version: number }).version;
    expect(version).toBeGreaterThan(old);
    expect((await server.fetch(request(SITE, `copy?since=${old}`, token))).status).toBe(200);
  });

  it('includes the note left when it was deleted', async () => {
    vi.useFakeTimers();
    const server = memorySync();
    const token = madeUpToken();
    await server.fetch(put(SITE, token, null, sealed(5000)));
    await server.fetch(request(SITE, 'copy', token, { method: 'DELETE' }));
    expect((await server.fetch(request(SITE, 'copy', token))).status).toBe(410);

    vi.setSystemTime(Date.now() + UNUSED_MS);
    await server.copies.runAlarms();
    expect(server.copies.stored().map(([name]) => name)).toEqual(['meter']);
  });
});
