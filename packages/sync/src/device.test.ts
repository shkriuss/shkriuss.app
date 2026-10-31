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
    retired: [],
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

describe('replaced keys this device is done with (audit 5 A-1)', () => {
  it('never come back into the keys to move, however often the hub sends them', () => {
    const mine = randomBytes(32);
    const done = randomBytes(32);
    const still = randomBytes(32);
    const state = syncingWith(mine, still);
    expect(saveState({ ...state, retired: [encoded(done)] })).toBe(true);
    // Turned on again with the same key, and with another key.
    expect(saveConnection({ secret: mine, code: 'AAAA-AAAA', replaces: [done, still] })).toBe(true);
    expect(loadState()).toMatchObject({ previous: [encoded(still)], retired: [encoded(done)] });
    const next = randomBytes(32);
    expect(saveConnection({ secret: next, code: 'BBBB-BBBB', replaces: [done, mine] })).toBe(true);
    expect(loadState()).toMatchObject({ previous: [encoded(mine)], retired: [encoded(done)] });
    // Kept when sync is turned off.
    const off = loadState();
    if (!off) throw new Error('No state');
    expect(saveState(offState(off))).toBe(true);
    expect(loadState()?.retired).toEqual([encoded(done)]);
  });

  it('are none in state saved before they were kept', () => {
    localStorage.setItem(
      'shkriuss-device:sync',
      JSON.stringify({ secret: encoded(randomBytes(32)), code: 'AAAA-AAAA', retired: 'junk' }),
    );
    expect(loadState()?.retired).toEqual([]);
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

  it('is the latest time, with the same key too, and the time given (the server’s)', () => {
    const mine = randomBytes(32);
    const state = syncingWith(mine, randomBytes(32));
    // Turned on again from the hub, with sync still on here: what it knew stays.
    expect(saveConnection({ secret: mine, code: 'AAAA-AAAA', replaces: [] }, T0 + 60_000)).toBe(
      true,
    );
    expect(loadState()).toEqual({ ...state, connected: T0 + 60_000 });
  });

  it('is unknown in state saved before it was kept', () => {
    localStorage.setItem(
      'shkriuss-device:sync',
      JSON.stringify({ secret: encoded(randomBytes(32)), code: 'AAAA-AAAA' }),
    );
    expect(loadState()?.connected).toBeNull();
  });
});
