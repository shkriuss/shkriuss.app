import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKED_KEY, forgetReminderChecks, loadChecked, saveChecked } from './reminder-checks.ts';

/** A stand-in for localStorage that can refuse, as a blocked one does. */
class MemoryStorage {
  map = new Map<string, string>();
  blocked = false;
  getItem(key: string): string | null {
    if (this.blocked) throw new DOMException('The operation is insecure.', 'SecurityError');
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.blocked) throw new DOMException('The operation is insecure.', 'SecurityError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    if (this.blocked) throw new DOMException('The operation is insecure.', 'SecurityError');
    this.map.delete(key);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal('localStorage', storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the last reminder check shared by an app’s tabs', () => {
  it('is saved on this device, under a key backups leave out', () => {
    const check = { stamp: '2026-10-27T09:41', at: 1_793_093_000_000 };
    saveChecked(check);
    expect(CHECKED_KEY.startsWith('shkriuss-device:')).toBe(true);
    expect(storage.map.get(CHECKED_KEY)).toBe(JSON.stringify(check));
    expect(loadChecked()).toEqual(check);
  });

  it('is ignored when it isn’t a check', () => {
    expect(loadChecked()).toBeNull();
    for (const junk of [
      'not json',
      '{}',
      '{"stamp":"soon","at":1}',
      '{"stamp":"2026-10-27T09:41"}',
    ]) {
      storage.map.set(CHECKED_KEY, junk);
      expect(loadChecked(), junk).toBeNull();
    }
  });

  it('is forgotten by “Delete all data” (audit 5 D-1)', () => {
    saveChecked({ stamp: '2026-10-27T09:41', at: 1_793_093_000_000 });
    forgetReminderChecks();
    expect(storage.map.has(CHECKED_KEY)).toBe(false);
    expect(loadChecked()).toBeNull();
  });

  it('never throws when the browser blocks storage', () => {
    storage.blocked = true;
    expect(() => saveChecked({ stamp: '2026-10-27T09:41', at: 1 })).not.toThrow();
    expect(loadChecked()).toBeNull();
    expect(() => forgetReminderChecks()).not.toThrow();
  });
});
