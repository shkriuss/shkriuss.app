import type { StorageLike } from '@shkriuss/storage';
import { describe, expect, it } from 'vitest';
import { changeCount } from './changes.ts';

/** One device's localStorage, which every tab sees. */
class SharedStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe('whether another tab changed the library', () => {
  it('is told by each tab’s changes, and not by its own', () => {
    const storage = new SharedStorage();
    const first = changeCount(storage);
    const second = changeCount(storage);
    expect(first.changedElsewhere()).toBe(false);

    second.changed();
    expect(first.changedElsewhere()).toBe(true);
    expect(second.changedElsewhere()).toBe(false);

    // Once the first tab loads again, it's up to date.
    first.loading();
    expect(first.changedElsewhere()).toBe(false);
    first.changed();
    first.changed();
    expect(first.changedElsewhere()).toBe(false);
    expect(second.changedElsewhere()).toBe(true);
  });

  it('is still told when this tab changes the library after another tab did (audit 6 F3-1)', () => {
    const storage = new SharedStorage();
    const first = changeCount(storage);
    const second = changeCount(storage);
    first.loading();
    second.changed();
    // The first tab saves something of its own (a look at the online library) before loading again.
    first.changed();
    expect(first.changedElsewhere()).toBe(true);
    expect(second.changedElsewhere()).toBe(true);
    first.loading();
    expect(first.changedElsewhere()).toBe(false);
  });

  it('is told after “Delete all data” too', () => {
    const storage = new SharedStorage();
    const tab = changeCount(storage);
    tab.changed();
    storage.map.clear();
    expect(tab.changedElsewhere()).toBe(true);
  });

  it('loads again every time when the count can’t be kept', () => {
    const storage = new SharedStorage();
    storage.failWrites = true;
    const tab = changeCount(storage);
    tab.changed();
    expect(tab.changedElsewhere()).toBe(true);
  });
});
