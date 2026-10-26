/** This device's sync state (./device.ts), on its own. */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadState, offState, saveConnection, saveState, type DeviceState } from './device.ts';

class MemoryStorage {
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

const T0 = Date.UTC(2026, 9, 26, 12);
const encoded = (bytes: Uint8Array<ArrayBuffer>) => toBase64Url(bytes);

/** Synced with `secret`; `old`'s copy still waits to move (it needs a newer version of the app). */
function syncingWith(secret: Uint8Array<ArrayBuffer>, old: Uint8Array<ArrayBuffer>): DeviceState {
  const state: DeviceState = {
    secret: encoded(secret),
    code: 'AAAA-AAAA',
    remote: { version: 3, epoch: 'e1' },
    known: {},
    dirty: false,
    base: null,
    last: T0,
    serverTime: T0,
    connected: T0,
    previous: [encoded(old)],
    waiting: { [encoded(old)]: '1 1' },
  };
  expect(saveState(state)).toBe(true);
  return state;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('connecting to another account (audit 4 A-1)', () => {
  it('forgets the old account’s replaced keys, so their copies never move there', () => {
    const mine = randomBytes(32);
    const myOld = randomBytes(32);
    syncingWith(mine, myOld);
    const someoneElses = randomBytes(32);
    expect(saveConnection({ secret: someoneElses, code: 'BBBB-BBBB', replaces: [] })).toBe(true);
    const state = loadState();
    expect(state?.secret).toBe(encoded(someoneElses));
    expect(state?.previous).toEqual([]);
    expect(state?.waiting).toEqual({});
  });

  it('keeps the keys the new one replaced, and what waits for them', () => {
    const before = randomBytes(32);
    const older = randomBytes(32);
    syncingWith(before, older);
    // The same account's key was replaced again: the hub sends every replaced key.
    const now = randomBytes(32);
    expect(saveConnection({ secret: now, code: 'CCCC-CCCC', replaces: [before, older] })).toBe(
      true,
    );
    const state = loadState();
    expect(state?.previous).toEqual([encoded(before), encoded(older)]);
    expect(state?.waiting).toEqual({ [encoded(older)]: '1 1' });
  });

  it('with the same key, keeps what it had and adds what it replaced', () => {
    const mine = randomBytes(32);
    const myOld = randomBytes(32);
    syncingWith(mine, myOld);
    const another = randomBytes(32);
    expect(saveConnection({ secret: mine, code: 'AAAA-AAAA', replaces: [another] })).toBe(true);
    expect(loadState()?.previous).toEqual([encoded(myOld), encoded(another)]);
  });
});

describe('when sync was turned on (audit 4 E-1)', () => {
  it('is kept with a new key, and forgotten when sync is turned off', () => {
    const mine = randomBytes(32);
    const state = syncingWith(mine, randomBytes(32));
    expect(saveState(offState(state))).toBe(true);
    expect(loadState()?.connected).toBeNull();

    vi.setSystemTime(T0 + 60_000);
    expect(saveConnection({ secret: mine, code: 'AAAA-AAAA', replaces: [] })).toBe(true);
    expect(loadState()?.connected).toBe(T0 + 60_000);
  });

  it('stays the same when the same key comes again', () => {
    const mine = randomBytes(32);
    syncingWith(mine, randomBytes(32));
    vi.setSystemTime(T0 + 60_000);
    expect(saveConnection({ secret: mine, code: 'AAAA-AAAA', replaces: [] })).toBe(true);
    expect(loadState()?.connected).toBe(T0);
  });

  it('is unknown in state saved before it was kept', () => {
    localStorage.setItem(
      'shkriuss-device:sync',
      JSON.stringify({ secret: encoded(randomBytes(32)), code: 'AAAA-AAAA' }),
    );
    expect(loadState()?.connected).toBeNull();
  });
});
