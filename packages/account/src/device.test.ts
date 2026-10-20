/**
 * What the Account page remembers on this device about apps that sync
 * (device.ts), so it can offer "Turn off sync in …".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetAccount, noteSyncOff, noteSyncOn, syncedApps } from './device.ts';

class MemoryStorage {
  #map = new Map<string, string>();
  getItem = (key: string) => this.#map.get(key) ?? null;
  setItem = (key: string, value: string) => void this.#map.set(key, value);
  removeItem = (key: string) => void this.#map.delete(key);
}

const TASKS = 'https://tasks.shkriuss.app';
const NOTES = 'https://notes.shkriuss.app';

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apps that sync on this device', () => {
  it('remembers apps turned on, for the account they were turned on with', () => {
    expect(syncedApps('K7Q2-M9XD')).toEqual(new Map());
    noteSyncOn('tasks', 'K7Q2-M9XD', TASKS);
    noteSyncOn('notes', 'K7Q2-M9XD', NOTES);
    expect(syncedApps('K7Q2-M9XD')).toEqual(
      new Map([
        ['tasks', TASKS],
        ['notes', NOTES],
      ]),
    );
    // Another account (or a replaced key) doesn't count.
    expect(syncedApps('N3W5-K3Y8')).toEqual(new Map());

    // Turned on again with another account: only that one counts.
    noteSyncOn('tasks', 'N3W5-K3Y8', TASKS);
    expect(syncedApps('N3W5-K3Y8')).toEqual(new Map([['tasks', TASKS]]));
    expect(syncedApps('K7Q2-M9XD')).toEqual(new Map([['notes', NOTES]]));
  });

  it('forgets an app turned off, and every app on signing out', () => {
    noteSyncOn('tasks', 'K7Q2-M9XD', TASKS);
    noteSyncOn('notes', 'K7Q2-M9XD', NOTES);
    noteSyncOff('tasks');
    expect([...syncedApps('K7Q2-M9XD').keys()]).toEqual(['notes']);
    forgetAccount();
    expect(syncedApps('K7Q2-M9XD')).toEqual(new Map());
  });

  it('ignores what it can’t read', () => {
    localStorage.setItem('shkriuss-device:synced-apps', '{not json');
    expect(syncedApps('K7Q2-M9XD')).toEqual(new Map());
    localStorage.setItem(
      'shkriuss-device:synced-apps',
      JSON.stringify([{ app: 'tasks' }, null, { app: 'notes', code: 'K7Q2-M9XD', origin: NOTES }]),
    );
    expect(syncedApps('K7Q2-M9XD')).toEqual(new Map([['notes', NOTES]]));
  });
});
