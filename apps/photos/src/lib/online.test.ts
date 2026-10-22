import { randomBytes } from '@shkriuss/crypto';
import { libraryRecord, type LibraryChange } from '@shkriuss/library';
import { createStore, type StorageLike } from '@shkriuss/storage';
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  freeable,
  onlineMessage,
  onlyOnline,
  RECORDS,
  waitingToGoUp,
  type OnlineState,
} from './online.ts';
import { detailsOf, type Photo } from './photos.ts';

const photo = (id: string, overrides: Partial<Photo> = {}): Photo => ({
  id,
  taken: '2026-10-21T14:03:22',
  added: 1,
  name: `${id}.jpg`,
  type: 'image/jpeg',
  size: 1_000_000,
  width: 4032,
  height: 3024,
  hash: `hash-${id}`,
  online: null,
  here: true,
  ...overrides,
});
const place = { key: 'k1', parts: [100, 2000, 1_000_028] };
const item = (from: Photo, seq = 1): LibraryChange => ({
  id: from.id,
  seq,
  at: 0,
  key: place.key,
  details: detailsOf(from),
  parts: place.parts,
});
const deleted = (id: string, seq = 1): LibraryChange => ({ id, seq, deleted: true });
const library = (...photos: Photo[]) => new Map(photos.map((one) => [one.id, one]));

describe('changes from the online library', () => {
  it('add photos from other devices, as only online', () => {
    const applied = applyChanges(library(), [item(photo('b'))]);
    expect(applied.save).toEqual([photo('b', { online: place, here: false })]);
    expect(applied).toMatchObject({ remove: [], moves: [], duplicates: [], skipped: 0 });
  });

  it('note that photos here are online now, once', () => {
    const here = photo('a');
    expect(applyChanges(library(here), [item(here)]).save).toEqual([photo('a', { online: place })]);
    expect(applyChanges(library(photo('a', { online: place })), [item(here)]).save).toEqual([]);
  });

  it('delete photos deleted on another device', () => {
    const applied = applyChanges(library(photo('a', { online: place })), [
      deleted('a'),
      deleted('never-here'),
    ]);
    expect(applied.remove).toEqual(['a']);
    expect(applied.save).toEqual([]);
  });

  it('keep the same photo once: one only here takes the online one’s id', () => {
    const mine = photo('a', { hash: 'same' });
    const theirs = photo('b', { hash: 'same', name: 'from the tablet.jpg' });
    const applied = applyChanges(library(mine), [item(theirs)]);
    expect(applied.moves).toEqual([{ from: 'a', to: 'b' }]);
    expect(applied.remove).toEqual(['a']);
    expect(applied.save).toEqual([{ ...theirs, online: place, here: true }]);
    expect(applied.duplicates).toEqual([]);
  });

  it('keep the smaller id of a photo added online twice, everywhere', () => {
    const smaller = photo('a', { hash: 'same', online: place });
    const larger = photo('b', { hash: 'same' });
    // Seen from the device that has the smaller one: the larger goes.
    expect(applyChanges(library(smaller), [item(larger)])).toMatchObject({
      save: [],
      remove: [],
      duplicates: ['b'],
    });
    // Seen from the device that has the larger one: it gives way.
    const applied = applyChanges(library({ ...larger, online: place }), [item(smaller)]);
    expect(applied.duplicates).toEqual(['b']);
    expect(applied.moves).toEqual([{ from: 'b', to: 'a' }]);
    expect(applied.save).toEqual([{ ...smaller, online: place, here: true }]);
  });

  it('skip what isn’t a photo, or doesn’t match its id', () => {
    const odd: LibraryChange = {
      id: 'x',
      seq: 1,
      at: 0,
      key: 'k1',
      details: { id: 'x' },
      parts: [],
    };
    const mismatch = { ...item(photo('y')), id: 'z' } as LibraryChange;
    expect(applyChanges(library(), [odd, mismatch]).skipped).toBe(2);
  });

  it('end where the last change says, in order', () => {
    const b = photo('b');
    const applied = applyChanges(library(), [item(b, 1), deleted('b', 2), item(photo('c'), 3)]);
    expect(applied.save.map((one) => one.id)).toEqual(['c']);
    expect(applied.remove).toEqual(['b']);
  });
});

describe('this device’s photos', () => {
  it('go up when they’re here and not online yet', () => {
    const photos = [
      photo('a'),
      photo('b', { online: place }),
      photo('c', { here: false, online: place }),
    ];
    expect(waitingToGoUp(photos, new Set()).map((one) => one.id)).toEqual(['a']);
    expect(waitingToGoUp(photos, new Set(['a']))).toEqual([]);
    expect(onlyOnline(photos).map((one) => one.id)).toEqual(['c']);
  });

  it('free up the space of originals that are online', () => {
    const photos = [
      photo('a', { size: 3_000_000 }),
      photo('b', { online: place, size: 2_000_000 }),
      photo('c', { online: place, size: 5_000_000 }),
      photo('d', { here: false, online: place }),
    ];
    const { photos: freed, bytes } = freeable(photos);
    expect(freed.map((one) => one.id)).toEqual(['b', 'c']);
    expect(bytes).toBe(7_000_000);
  });
});

describe('the libraries’ records', () => {
  it('saved by the version before (one record, "library") become their library’s', async () => {
    const record = await libraryRecord(randomBytes(32), undefined);
    const older = { ...record, id: 'library' };
    const saved = new Map([
      ['shkriuss:library', JSON.stringify({ v: 1, data: { items: [older] } })],
    ]);
    const storage: StorageLike = {
      get length() {
        return saved.size;
      },
      key: (index) => [...saved.keys()][index] ?? null,
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => void saved.set(key, value),
      removeItem: (key) => void saved.delete(key),
    };
    const store = createStore({ ...RECORDS, storage });
    expect(store.load()).toEqual({ items: [record] });
    // From another device that hasn't updated yet: the same.
    expect(store.read(1, { items: [older] })).toEqual({ items: [record] });
    // One already in this version's data (merged from such a device) is still read, to be tidied.
    expect(store.read(2, { items: [older] })).toEqual({ items: [older] });
  });
});

describe('the status line', () => {
  const state = (overrides: Partial<OnlineState> = {}): OnlineState => ({
    checked: true,
    unlocked: true,
    usage: { items: 1234, bytes: 12_300_000_000 },
    waiting: 0,
    tooBig: 0,
    problem: null,
    retryAt: null,
    ...overrides,
  });

  it('says what’s online, and what’s still going up', () => {
    expect(onlineMessage(state())).toBe('Online: 1,234 photos · 12 GB.');
    expect(onlineMessage(state({ waiting: 5 }))).toBe(
      'Putting photos online: 5 photos to go. Keep Photos open until it’s done.',
    );
    expect(onlineMessage(state({ tooBig: 1 }))).toBe(
      'Online: 1,234 photos · 12 GB. 1 photo is too big to keep online (over 95 MB), so it stays on this device.',
    );
    expect(onlineMessage(state({ checked: false }))).toBe('Checking the online library…');
  });

  it('says what stops photos going online', () => {
    expect(onlineMessage(state({ unlocked: false }))).toBe(
      'To keep photos online, enter the storage code.',
    );
    expect(onlineMessage(state({ problem: 'full', waiting: 3 }))).toBe(
      'The online library is full, so 3 photos stay on this device.',
    );
    expect(onlineMessage(state({ problem: 'daily-limit', waiting: 2 }))).toMatch(
      /^That’s all the uploads for today\. The other 2 photos go online after /,
    );
    expect(onlineMessage(state({ problem: 'offline' }))).toBe(
      'Couldn’t reach the online library: no connection. It will try again.',
    );
    expect(onlineMessage(state({ problem: 'not-set-up' }))).toMatch(/^Online storage isn’t set up/);
  });
});
