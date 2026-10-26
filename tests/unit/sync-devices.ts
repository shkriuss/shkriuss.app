/**
 * For tests of an app's rules across devices: pretend devices, each with its
 * own storage, running the real sync client (packages/sync/src/client.ts)
 * against the real sync server, kept in memory, as
 * packages/sync/src/client.test.ts does. Devices take turns, like phones
 * that sync one after another.
 *
 * Call pretendBrowser() before making devices (in beforeEach), and
 * vi.unstubAllGlobals() after (in afterEach).
 */
import { expect, vi } from 'vitest';
import { createStore, type StorageLike, type Store } from '../../packages/storage/src/index.ts';
import { createSync, syncedStore, type SyncClient } from '../../packages/sync/src/client.ts';
import type { Identified } from '../../packages/sync/src/merge.ts';
import { memorySync, withFiles } from '../../packages/sync/src/testing.ts';

class MemoryStorage implements StorageLike {
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

/** Stubs what the sync client needs from a browser at `origin`; its requests go to a new server in memory. */
export function pretendBrowser(origin: string): void {
  const server = memorySync().env;
  const nothing = () => 0;
  vi.stubGlobal('window', {
    setTimeout: nothing,
    clearTimeout: nothing,
    setInterval: nothing,
    addEventListener: nothing,
  });
  vi.stubGlobal('document', { addEventListener: nothing, visibilityState: 'visible' });
  vi.stubGlobal('location', { hash: '', pathname: '/', search: '', origin });
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
    withFiles.fetch(new Request(new URL(input, origin), init), server),
  );
}

/** One synced store, as the app sets it up (createStore and syncedStore). */
export interface SyncedStoreSetup<T, I extends Identified> {
  key: string;
  version: number;
  fallback: () => T;
  validate: (value: unknown) => value is T;
  migrate?: (old: unknown, version: number) => T | undefined;
  items: (value: T) => readonly I[];
  withItems: (value: T, items: I[]) => T;
  /** Keeping both versions of an item changed on two devices, as the app does (SyncedStore). */
  conflictCopy?: (mine: I, theirs: I) => I;
  keepSame?: boolean;
}

/** An app's key from the account, the same on every device of one person. */
export const appSecret = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(32));

/** A device with sync on (the app's key `secret`) for one store of `app`. */
export class Device<T, I extends Identified> {
  readonly storage = new MemoryStorage();
  readonly store: Store<T>;
  readonly sync: SyncClient;

  constructor(app: string, secret: Uint8Array<ArrayBuffer>, setup: SyncedStoreSetup<T, I>) {
    this.use();
    this.store = createStore<T>({
      key: setup.key,
      version: setup.version,
      fallback: setup.fallback,
      validate: setup.validate,
      ...(setup.migrate ? { migrate: setup.migrate } : {}),
    });
    // Signed in, with sync turned on (packages/sync/src/device.ts keeps it so).
    const base64url = btoa(String.fromCharCode(...secret))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    this.storage.setItem(
      'shkriuss-device:sync',
      JSON.stringify({ secret: base64url, code: 'K7Q2-M9XD' }),
    );
    this.sync = createSync({
      app,
      stores: [
        syncedStore({
          store: this.store,
          items: setup.items,
          withItems: setup.withItems,
          ...(setup.conflictCopy ? { conflictCopy: setup.conflictCopy } : {}),
          ...(setup.keepSame === undefined ? {} : { keepSame: setup.keepSame }),
        }),
      ],
      onChange: () => undefined,
    });
  }

  /** This device's storage is the browser's now. */
  use(): this {
    vi.stubGlobal('localStorage', this.storage);
    return this;
  }

  /** What the app shows. */
  get value(): T {
    this.use();
    return this.store.load();
  }

  /** The person changes something: the app saves it, then tells sync. */
  save(value: T): void {
    this.use();
    expect(this.store.save(value)).toBe(true);
    this.sync.changed();
  }

  async syncNow(): Promise<void> {
    this.use();
    await this.sync.syncNow();
    expect(this.sync.status().problem).toBeNull();
  }
}
