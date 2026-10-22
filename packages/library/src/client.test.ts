/**
 * The library's browser side (client.ts) against the real server code in
 * memory (testing.ts): keys, sealing, changes, downloads, moving to a new
 * account key, and deleting.
 */
import { randomBytes, utf8 } from '@shkriuss/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  libraryAccess,
  libraryApi,
  LibraryError,
  libraryRecord,
  linkedLibrary,
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

describe('a replaced account key', () => {
  it('moves the library: old items still open, new ones use the new key, the old token stops', async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const phone = await device(oldKey);
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());

    const record = await libraryRecord(newKey, phone.record);
    await linkedLibrary(() => record).move(oldKey, newKey);
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
});

describe('deleting with the online copy', () => {
  it('deletes everything in the library', async () => {
    const secret = randomBytes(32);
    const phone = await device(secret);
    await phone.api.unlock(CODE);
    await phone.api.upload('photo-0001', photo, parts());
    await linkedLibrary(() => phone.record).delete(secret);
    expect(await phone.api.changes(0)).toMatchObject({ wiping: true, changes: [] });
  });

  it('does nothing without a library, or for one that isn’t this key’s', async () => {
    const secret = randomBytes(32);
    await linkedLibrary(() => undefined).delete(secret);
    const phone = await device(randomBytes(32));
    await phone.api.changes(0);
    await linkedLibrary(() => phone.record).delete(secret);
    expect((await phone.api.changes(0)).wiping).toBe(false);
  });
});
