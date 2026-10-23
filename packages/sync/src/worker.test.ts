/**
 * The sync server's limits (docs/adr/0017-storage-limits.md): anyone can make
 * up a token, so all of an app's copies together have a limit, nothing is
 * kept for a token that only asks, and copies nobody uses are deleted.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import { OBJECT_BYTES } from '@shkriuss/server/meter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memorySync } from './testing.ts';
import { MAX_SEALED_CHARS } from './validate.ts';
import { STORAGE_LIMITS, UNUSED_MS } from './worker.ts';

const SITE = 'https://notes.shkriuss.app';
const PREVIEW = 'https://pr-7-notes.shkriuss.workers.dev';
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
    const response = await server.fetch(put(PREVIEW, token, null, sealed(size)));
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
    const server = memorySync();
    const biggest = sealed(MAX_SEALED_CHARS);
    const statuses: number[] = [];
    for (let index = 0; index < 15; index += 1) {
      statuses.push((await server.fetch(put(PREVIEW, madeUpToken(), null, biggest))).status);
    }
    const kept = statuses.filter((status) => status === 200).length;
    expect(kept).toBeGreaterThan(3);
    expect(statuses.slice(kept).every((status) => status === 507)).toBe(true);
    expect(keptBytes(server)).toBeLessThan(STORAGE_LIMITS.copies.preview);
    // A refused copy keeps nothing at all.
    expect(server.copies.stored()).toHaveLength(kept + 1);
  });

  it('each count for at least 16 KB, so tiny ones run out too', async () => {
    const kept = await fillUp(memorySync(), 40);
    expect(kept).toHaveLength(
      Math.floor(STORAGE_LIMITS.copies.preview / (OBJECT_BYTES + 40 + 8192)),
    );
  });

  it('leave copies already online syncing when the limit is reached', async () => {
    const server = memorySync();
    const mine = madeUpToken();
    const first = await server.fetch(put(PREVIEW, mine, null, sealed(100_000)));
    expect(first.status).toBe(200);
    await fillUp(server, MAX_SEALED_CHARS);

    // Changes of about the same size fit in the room the copy already has.
    let version = ((await first.json()) as { version: number }).version;
    for (const size of [100_000, 110_000, 95_000]) {
      const response = await server.fetch(put(PREVIEW, mine, version, sealed(size)));
      expect(response.status).toBe(200);
      version = ((await response.json()) as { version: number }).version;
    }
    // A much bigger one needs room nobody has.
    const bigger = await server.fetch(put(PREVIEW, mine, version, sealed(MAX_SEALED_CHARS)));
    expect(bigger.status).toBe(507);
    expect(await bigger.json()).toEqual({
      error: 'There’s no room left online for this app just now.',
    });
  });

  it('get room back when one is deleted', async () => {
    const server = memorySync();
    const tokens = await fillUp(server, MAX_SEALED_CHARS);
    const deleted = await server.fetch(
      request(PREVIEW, 'copy', tokens[0] ?? '', { method: 'DELETE' }),
    );
    expect(deleted.status).toBe(204);
    expect(
      (await server.fetch(put(PREVIEW, madeUpToken(), null, sealed(MAX_SEALED_CHARS)))).ok,
    ).toBe(true);
  });

  it('have a much higher limit on the real site than on a preview', async () => {
    expect(STORAGE_LIMITS.copies.site).toBeGreaterThan(5 * STORAGE_LIMITS.copies.preview);
    const server = memorySync();
    const biggest = sealed(MAX_SEALED_CHARS);
    for (let index = 0; index < 15; index += 1) {
      expect((await server.fetch(put(SITE, madeUpToken(), null, biggest))).status).toBe(200);
    }
  });

  it('with files, count the files too', async () => {
    const server = memorySync();
    const token = madeUpToken();
    const file = new Uint8Array(1_500_000);
    const statuses: number[] = [];
    for (let index = 0; index < 70; index += 1) {
      const response = await server.fetchWithFiles(
        request(PREVIEW, `files/photo-${index}`, token, { method: 'PUT', body: file }),
      );
      statuses.push(response.status);
    }
    expect(statuses).toContain(204);
    expect(statuses.at(-1)).toBe(507);
    expect(keptBytes(server)).toBeLessThan(STORAGE_LIMITS.files.preview);
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
