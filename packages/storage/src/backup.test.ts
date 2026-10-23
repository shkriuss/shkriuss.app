import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackupError,
  decryptBackup,
  encryptBackup,
  passphraseProblem,
  PBKDF2_ITERATIONS,
  readBackup,
  restoreAll,
  type EncryptedBackup,
} from './backup.ts';
import { createStore, exportAll, type ExportFile, type StorageLike } from './index.ts';

/** In-memory stand-in for localStorage; can be given a maximum number of items, like a full disk. */
class MemoryStorage implements StorageLike {
  #map = new Map<string, string>();
  maxItems = Infinity;
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
    if (!this.#map.has(key) && this.#map.size >= this.maxItems) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  entries(): [string, string][] {
    return [...this.#map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }
}

const PASSPHRASE = 'correct horse battery staple';
// The fewest rounds a file may use; keeps the tests fast.
const FAST = { iterations: 100_000 };

let storage: MemoryStorage;
let file: ExportFile;
beforeEach(() => {
  storage = new MemoryStorage();
  storage.setItem('shkriuss:calendar', '{"v":2,"data":{"events":[{"title":"Dentist"}]}}');
  storage.setItem('shkriuss:theme', 'dark');
  storage.setItem('someone-else', 'not ours');
  file = exportAll('calendar', storage, new Date('2026-10-17T10:00:00Z'));
});

/** Expects a promise to fail with a BackupError of this code. */
async function failsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(BackupError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('encryptBackup and decryptBackup', () => {
  it('locks data so only the passphrase opens it', async () => {
    const backup = await encryptBackup(file, PASSPHRASE, FAST);
    const text = JSON.stringify(backup);
    expect(text).not.toContain('Dentist');
    expect(backup).toMatchObject({
      format: 'shkriuss-backup',
      version: 1,
      app: 'calendar',
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000 },
      cipher: { name: 'AES-GCM' },
    });
    expect(await decryptBackup(backup, PASSPHRASE)).toEqual(file);
  });

  it('uses 600,000 rounds by default', async () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
    const backup = await encryptBackup(file, PASSPHRASE);
    expect(backup.kdf.iterations).toBe(600_000);
  });

  it('uses a new salt and nonce every time', async () => {
    const a = await encryptBackup(file, PASSPHRASE, FAST);
    const b = await encryptBackup(file, PASSPHRASE, FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('turns down a wrong passphrase', async () => {
    const backup = await encryptBackup(file, PASSPHRASE, FAST);
    await failsWith(decryptBackup(backup, 'correct horse battery stapler'), 'wrong-passphrase');
  });

  it('accepts the same passphrase however its letters were typed', async () => {
    // "é" as one character, and as "e" plus an accent.
    const backup = await encryptBackup(file, 'café au lait please', FAST);
    expect(await decryptBackup(backup, 'café au lait please')).toEqual(file);
  });

  it('notices any change to the file', async () => {
    const backup = await encryptBackup(file, PASSPHRASE, FAST);
    const changed: EncryptedBackup[] = [
      { ...backup, app: 'tally' },
      { ...backup, createdAt: '2020-01-01T00:00:00.000Z' },
      {
        ...backup,
        data:
          `A${backup.data.slice(1)}` === backup.data
            ? `B${backup.data.slice(1)}`
            : `A${backup.data.slice(1)}`,
      },
    ];
    for (const copy of changed)
      await failsWith(decryptBackup(copy, PASSPHRASE), 'wrong-passphrase');
  });

  it('refuses short passphrases', async () => {
    expect(passphraseProblem('short')).toBe('Use at least 12 characters.');
    expect(passphraseProblem('twelve chars')).toBeUndefined();
    await failsWith(encryptBackup(file, 'too short', FAST), 'weak-passphrase');
  });
});

describe('readBackup', () => {
  it('reads locked and plain backups', async () => {
    const backup = await encryptBackup(file, PASSPHRASE, FAST);
    expect(readBackup(JSON.stringify(backup), 'calendar')).toEqual({ kind: 'encrypted', backup });
    expect(readBackup(JSON.stringify(file), 'calendar')).toEqual({ kind: 'plain', file });
  });

  it('refuses other files, other apps and unsafe settings', async () => {
    const backup = await encryptBackup(file, PASSPHRASE, FAST);
    const code = (text: string, app = 'calendar') => {
      try {
        readBackup(text, app);
        return 'ok';
      } catch (error) {
        return (error as BackupError).code;
      }
    };
    expect(code('not json')).toBe('not-a-backup');
    expect(code('{"hello":"world"}')).toBe('not-a-backup');
    expect(code(JSON.stringify(backup), 'tally')).toBe('wrong-app');
    expect(code(JSON.stringify(file), 'tally')).toBe('wrong-app');
    const kdf = (iterations: number) =>
      JSON.stringify({ ...backup, kdf: { ...backup.kdf, iterations } });
    expect(code(kdf(1000))).toBe('not-a-backup'); // too weak
    expect(code(kdf(50_000_000))).toBe('not-a-backup'); // would freeze the page
    expect(code(JSON.stringify({ ...backup, data: 'not base64!' }))).toBe('not-a-backup');
  });
});

describe('restoreAll', () => {
  it('replaces the app’s data with the backup’s, keeping text values as text', () => {
    const before = file;
    storage.setItem('shkriuss:calendar', '{"v":2,"data":{"events":[]}}');
    storage.setItem('shkriuss:extra', '"left over"');
    expect(restoreAll(before, storage)).toBe(2);
    expect(storage.entries()).toEqual([
      ['shkriuss:calendar', '{"v":2,"data":{"events":[{"title":"Dentist"}]}}'],
      ['shkriuss:theme', 'dark'],
      ['someone-else', 'not ours'],
    ]);
  });

  it('ignores keys that aren’t the app’s', () => {
    restoreAll({ ...file, data: { 'other:key': 1, 'shkriuss:ok': { v: 1, data: 2 } } }, storage);
    expect(storage.getItem('other:key')).toBeNull();
    expect(storage.getItem('shkriuss:ok')).toBe('{"v":1,"data":2}');
  });

  it('puts the old data back if storage fills up part-way', () => {
    const before = storage.entries();
    // Room for 3 items: the old data fits, a backup with 3 of the app's items doesn't.
    storage.maxItems = 3;
    const big = { ...file, data: { 'shkriuss:a': 1, 'shkriuss:b': 2, 'shkriuss:c': 3 } };
    expect(() => restoreAll(big, storage)).toThrow(/There isn’t enough room/);
    expect(storage.entries()).toEqual(before);
  });

  it('explains when the browser blocks storage', () => {
    expect(() => restoreAll(file, undefined)).toThrow(/isn’t letting the app save data/);
  });

  it('first checks the backup with the app’s stores, and changes nothing if they can’t read it', () => {
    // The app's store on this page: version 2.
    const store = createStore<{ repairs: string[] }>({
      key: 'repairs',
      version: 2,
      fallback: () => ({ repairs: [] }),
      validate: (value): value is { repairs: string[] } =>
        Array.isArray((value as { repairs?: unknown } | null)?.repairs),
      storage,
    });
    store.save({ repairs: ['brakes'] });
    const before = storage.entries();
    const code = (saved: unknown) => {
      try {
        restoreAll({ ...file, data: { 'shkriuss:repairs': saved } }, storage);
        return 'ok';
      } catch (error) {
        return (error as BackupError).code;
      }
    };
    // Made by a newer version of the app, on another device.
    expect(code({ v: 3, data: { repairs: ['tyres'] } })).toBe('newer-version');
    expect(code({ v: 2, data: { repairs: 'tyres' } })).toBe('not-a-backup');
    expect(code('not an envelope')).toBe('not-a-backup');
    expect(storage.entries()).toEqual(before);
    expect(code({ v: 2, data: { repairs: ['tyres'] } })).toBe('ok');
    expect(store.load()).toEqual({ repairs: ['tyres'] });
  });
});
