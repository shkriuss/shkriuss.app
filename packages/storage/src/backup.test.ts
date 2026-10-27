import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackupError,
  base64ByteLength,
  decryptBackup,
  encryptBackup,
  passphraseProblem,
  PBKDF2_ITERATIONS,
  readBackup,
  restoreAll,
  type EncryptedBackup,
} from './backup.ts';
import { createStore, exportAll, type ExportFile, type StorageLike } from './index.ts';

/**
 * In-memory stand-in for localStorage; can be given a maximum number of
 * items, or of characters in its values (like a browser's quota), or made to
 * refuse every write after some number, like a full disk.
 */
class MemoryStorage implements StorageLike {
  #map = new Map<string, string>();
  maxItems = Infinity;
  maxChars = Infinity;
  failAfterWrites = Infinity;
  writes = 0;
  /** Runs just before a write (what another tab might do meanwhile). */
  beforeWrite: (() => void) | null = null;
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
    this.beforeWrite?.();
    const others = [...this.#map].reduce(
      (sum, [name, text]) => sum + (name === key ? 0 : text.length),
      0,
    );
    if (
      (!this.#map.has(key) && this.#map.size >= this.maxItems) ||
      others + value.length > this.maxChars ||
      this.writes >= this.failAfterWrites
    ) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.writes += 1;
    this.#map.set(key, value);
  }
  /** What another tab wrote: no checks. */
  wroteElsewhere(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
  entries(): [string, string][] {
    return [...this.#map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }
}

/** `bytes` zero bytes in base64 (what a locked file's fields look like). */
const zeros = (bytes: number) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

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

  it('turns down a damaged locked file by its own words, not “Something went wrong” (audit 5 E-6, A-4)', async () => {
    const backup = await encryptBackup(file, PASSPHRASE, FAST);
    const code = (changed: Partial<EncryptedBackup>) => {
      try {
        readBackup(JSON.stringify({ ...backup, ...changed }), 'calendar');
        return 'ok';
      } catch (error) {
        return (error as BackupError).code;
      }
    };
    const withSalt = (salt: string) => ({ kdf: { ...backup.kdf, salt } });
    // Text that looks like base64 but can't be decoded ("AAAAA" is no whole
    // number of bytes): atob() threw from decryptBackup, outside its checks.
    expect(code(withSalt('AAAAA'))).toBe('not-a-backup');
    expect(code(withSalt('A'))).toBe('not-a-backup');
    expect(code(withSalt(''))).toBe('not-a-backup');
    // The wrong sizes: a salt of 8 bytes, a nonce of 16, data shorter than its check value.
    expect(code(withSalt(zeros(8)))).toBe('not-a-backup');
    expect(code({ cipher: { ...backup.cipher, iv: zeros(16) } })).toBe('not-a-backup');
    expect(code({ data: zeros(15) })).toBe('not-a-backup');
    expect(code({ data: '' })).toBe('not-a-backup');
    expect(code({})).toBe('ok');
    expect(code(withSalt(zeros(16)))).toBe('ok');
  });

  it('counts the bytes in base64 text the way atob() does', () => {
    // Every text up to 6 characters long from a letter and the padding sign.
    const texts = [''];
    for (let length = 1; length <= 6; length += 1) {
      for (const text of texts.filter((shorter) => shorter.length === length - 1)) {
        texts.push(`${text}A`, `${text}=`);
      }
    }
    for (const text of [...texts, 'ab+/', 'abc', 'a+/=', '+/==', 'AB+/ab==', 'AB+/abc=']) {
      let expected: number | null;
      try {
        expected = atob(text).length;
      } catch {
        expected = null;
      }
      expect(base64ByteLength(text), JSON.stringify(text)).toBe(expected);
    }
    expect(base64ByteLength('not base64!')).toBeNull();
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

  it('replaces each key in its place, and puts the old data back in an order that fits (audit 5 E-7)', () => {
    // Room for 10 characters, all in use. The backup makes one key smaller
    // and one bigger, and adds one that doesn't fit.
    const full = new MemoryStorage();
    full.setItem('shkriuss:a', 'xxxxx');
    full.setItem('shkriuss:b', 'yyyyy');
    full.maxChars = 10;
    const before = full.entries();
    const data = { 'shkriuss:a': '1', 'shkriuss:b': '999999999', 'shkriuss:c': '1' };
    expect(() => restoreAll({ ...file, data }, full, new Map())).toThrow(/Nothing was changed/);
    // Put back the smaller one (b) first: a first would have asked for 14.
    expect(full.entries()).toEqual(before);
    // With room, the keys are replaced where they are, and the backup's new one added.
    full.maxChars = 11;
    expect(restoreAll({ ...file, data }, full, new Map())).toBe(3);
    expect(full.entries()).toEqual([
      ['shkriuss:a', '1'],
      ['shkriuss:b', '999999999'],
      ['shkriuss:c', '1'],
    ]);
  });

  it('says so when the old data can’t all go back, so the backup is restored again (audit 5 E-7)', () => {
    // The browser refuses every write after the first: the rollback's too.
    const refusing = new MemoryStorage();
    refusing.setItem('shkriuss:a', '{"v":1,"data":"old a"}');
    refusing.setItem('shkriuss:b', '{"v":1,"data":"old b"}');
    refusing.writes = 0;
    refusing.failAfterWrites = 1;
    const data = { 'shkriuss:a': { v: 1, data: 'new a' }, 'shkriuss:b': { v: 1, data: 'new b' } };
    let caught: unknown;
    try {
      restoreAll({ ...file, data }, refusing, new Map());
    } catch (error) {
      caught = error;
    }
    // The backup's own words, not a bare DOMException ("Something went wrong").
    expect(caught).toBeInstanceOf(BackupError);
    expect((caught as BackupError).message).toMatch(
      /some of your old data couldn’t be put back either.*restore the backup again/,
    );
    // Nothing is simply gone: each key holds the old or the backup's value.
    expect(refusing.getItem('shkriuss:a')).toBe('{"v":1,"data":"new a"}');
    expect(refusing.getItem('shkriuss:b')).toBe('{"v":1,"data":"old b"}');

    // Another tab of the app took the room the moment the restore started.
    const shared = new MemoryStorage();
    shared.setItem('shkriuss:a', 'xxxxx');
    shared.setItem('shkriuss:b', 'yyyyy');
    shared.maxChars = 10;
    shared.beforeWrite = () => {
      shared.beforeWrite = null;
      shared.wroteElsewhere('shkriuss:other', 'zzzz');
    };
    const bigger = { 'shkriuss:a': '1', 'shkriuss:b': '999999999' };
    expect(() => restoreAll({ ...file, data: bigger }, shared, new Map())).toThrow(
      /couldn’t be put back either/,
    );
    expect(shared.getItem('shkriuss:a')).toBe('1');
    expect(shared.getItem('shkriuss:b')).toBe('yyyyy');
    expect(shared.getItem('shkriuss:other')).toBe('zzzz');
    // Restored again once there's room: done, and what the backup doesn't have goes.
    shared.maxChars = Infinity;
    expect(restoreAll({ ...file, data: bigger }, shared, new Map())).toBe(2);
    expect(shared.entries()).toEqual([
      ['shkriuss:a', '1'],
      ['shkriuss:b', '999999999'],
    ]);
  });

  it('writes back every saved text exactly, quotes and all (audit 5 E-8)', () => {
    const saved = new MemoryStorage();
    saved.setItem('shkriuss:quoted', '"dark"');
    saved.setItem('shkriuss:number', '42');
    saved.setItem('shkriuss:flag', 'true');
    saved.setItem('shkriuss:nothing', 'null');
    saved.setItem('shkriuss:theme', 'dark');
    saved.setItem('shkriuss:store', '{"v":1,"data":[1]}');
    const before = saved.entries();
    const copy = exportAll('x', saved);
    expect(copy.data).toEqual({
      'shkriuss:quoted': '"dark"',
      'shkriuss:number': '42',
      'shkriuss:flag': 'true',
      'shkriuss:nothing': 'null',
      'shkriuss:theme': 'dark',
      'shkriuss:store': { v: 1, data: [1] },
    });
    const target = new MemoryStorage();
    expect(restoreAll(copy, target, new Map())).toBe(6);
    expect(target.entries()).toEqual(before);
    // A copy made before this change had the number 42 and null as values: the same text comes back.
    const older = { ...copy, data: { 'shkriuss:number': 42, 'shkriuss:nothing': null } };
    expect(restoreAll(older, target, new Map())).toBe(2);
    expect(target.entries()).toEqual([
      ['shkriuss:nothing', 'null'],
      ['shkriuss:number', '42'],
    ]);
  });

  it('explains when the browser blocks storage', () => {
    expect(() => restoreAll(file, undefined)).toThrow(/isn’t letting the app save data/);
  });

  it('refuses data nested deeper than any app’s, and changes nothing (audit 3 C-1)', () => {
    const before = storage.entries();
    // One item with an extra field nested 5,000 deep: under 10 KB, it passes
    // the apps' own checks (they ignore fields they don't know), and would
    // stop sync on this device for good.
    const deep = JSON.parse('['.repeat(5000) + ']'.repeat(5000)) as unknown;
    const item = { id: 'a', name: 'Olive oil', x: deep };
    const crafted = { ...file, data: { 'shkriuss:shelf': { v: 1, data: { items: [item] } } } };
    expect(() => restoreAll(crafted, storage)).toThrow(/can’t be read, so it wasn’t restored/);
    expect(storage.entries()).toEqual(before);
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
