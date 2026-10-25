/**
 * Replacing the account key: the account service's record of replaced keys
 * (worker.ts, kept in memory here) and what the device remembers (device.ts).
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import type { DurableObjectNamespace } from '@shkriuss/server';
import { memoryNamespace } from '@shkriuss/server/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentAccount,
  forgetAccount,
  noteReplaced,
  replacedSecrets,
  saveAccount,
} from './device.ts';
import { successorTag } from './secret.ts';
import { isReplaced, replaceAccountKey, replacedNote } from './status.ts';
import worker, {
  AccountPasskey,
  AccountStatus,
  STORAGE_LIMITS,
  UNUSED_MS,
  type AccountEnv,
} from './worker.ts';

function memoryEnv() {
  const env: AccountEnv = {
    ASSETS: { fetch: async () => new Response('page') },
    ACCOUNT_LINKS: {
      idFromName: (name) => ({ toString: () => name }),
      get: () => ({ fetch: async () => new Response(null, { status: 500 }) }),
    },
    ACCOUNT_PASSKEYS: null as unknown as DurableObjectNamespace,
    ACCOUNT_STATUS: null as unknown as DurableObjectNamespace,
  };
  const passkeys = memoryNamespace((state) => new AccountPasskey(state, env));
  const status = memoryNamespace((state) => new AccountStatus(state, env));
  env.ACCOUNT_PASSKEYS = passkeys.namespace;
  env.ACCOUNT_STATUS = status.namespace;
  return { env, passkeys, status };
}

class MemoryStorage {
  #map = new Map<string, string>();
  getItem = (key: string) => this.#map.get(key) ?? null;
  setItem = (key: string, value: string) => void this.#map.set(key, value);
  removeItem = (key: string) => void this.#map.delete(key);
}

let server: ReturnType<typeof memoryEnv>;

beforeEach(() => {
  server = memoryEnv();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
    worker.fetch(new Request(new URL(input, 'https://shkriuss.app'), init), server.env),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const PREVIEW = 'https://pr-4-hub.shkriuss.workers.dev';
const madeUpToken = () => toBase64Url(randomBytes(32));
/** A request from a stranger's script, straight to the Worker. */
const stranger = (origin: string, path: string, init: RequestInit = {}) =>
  worker.fetch(
    new Request(`${origin}/api/account/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${madeUpToken()}` },
    }),
    server.env,
  );
/** A sealed passkey lock, as the device sends it. */
const lock = () => JSON.stringify({ wrap: toBase64Url(randomBytes(60)) });

describe('replacing the account key', () => {
  it('marks the old key as replaced for good, and signs in with the new one', async () => {
    const old = randomBytes(32);
    const next = randomBytes(32);
    await saveAccount(old);
    expect(await isReplaced(old)).toBe(false);

    expect(await replaceAccountKey(old, next)).toEqual({ saved: true, noted: true });
    expect(await isReplaced(old)).toBe(true);
    expect(await isReplaced(next)).toBe(false);
    expect((await currentAccount())?.secret).toEqual(next);
    expect(replacedSecrets()).toEqual([old]);

    // Marking it again changes nothing.
    await replaceAccountKey(old, randomBytes(32));
    expect(await isReplaced(old)).toBe(true);
  });

  it('needs a well-formed token', async () => {
    const response = await fetch('/api/account/status', {
      headers: { Authorization: 'Bearer short' },
    });
    expect(response.status).toBe(401);
    expect((await fetch('/api/account/status', { method: 'DELETE' })).status).toBe(401);
  });

  it('remembers replaced keys on the device until it signs out', async () => {
    const [a, b, c] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    await saveAccount(a);
    noteReplaced(a, await successorTag(a, b));
    expect(await currentAccount()).toBeNull();
    expect(replacedSecrets()).toEqual([a]);

    await saveAccount(b);
    noteReplaced(c, null);
    expect((await currentAccount())?.secret).toEqual(b);
    expect(replacedSecrets()).toEqual([c, a]);

    for (let index = 0; index < 10; index += 1) noteReplaced(randomBytes(32), null);
    expect(replacedSecrets()).toHaveLength(5);

    forgetAccount();
    expect(await currentAccount()).toBeNull();
    expect(replacedSecrets()).toEqual([]);
  });
});

describe('replaced keys and other accounts (audit A-3)', () => {
  it('a device signed out elsewhere keeps its old key for the account that replaced it', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    // The tablet replaces the key; the phone, still on the old one, learns of it.
    await saveAccount(old);
    await replaceAccountKey(old, next);
    vi.stubGlobal('localStorage', new MemoryStorage());
    await saveAccount(old);
    const note = await replacedNote(old);
    expect(note).toEqual({ replaced: true, successor: await successorTag(old, next) });
    noteReplaced(old, note.successor);

    // Signed in with the new key, its apps can still move their old copies.
    await saveAccount(next);
    expect(replacedSecrets()).toEqual([old]);
  });

  it('forgets them when signing in to another account, so that account doesn’t get their data', async () => {
    const [old, next, someoneElse] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    await replaceAccountKey(old, next);
    expect(replacedSecrets()).toEqual([old]);

    // A link from someone else's device signs this one in to their account.
    await saveAccount(someoneElse);
    expect(replacedSecrets()).toEqual([]);
  });

  it('keeps a key replaced twice for the account at the end', async () => {
    const [first, second, third] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    await saveAccount(first);
    await replaceAccountKey(first, second);
    await replaceAccountKey(second, third);
    expect(replacedSecrets()).toEqual([second, first]);
  });

  it('the server keeps only the first note’s tag, and refuses a malformed one', async () => {
    const old = randomBytes(32);
    await saveAccount(old);
    const next = randomBytes(32);
    await replaceAccountKey(old, next);
    // A device with the old key (a lost one) can't change which key replaced it.
    await replaceAccountKey(old, randomBytes(32));
    expect((await replacedNote(old)).successor).toBe(await successorTag(old, next));

    const malformed = await worker.fetch(
      new Request('https://shkriuss.app/api/account/status', {
        method: 'PUT',
        body: JSON.stringify({ successor: 'short' }),
        headers: { Authorization: `Bearer ${madeUpToken()}`, 'Content-Type': 'application/json' },
      }),
      server.env,
    );
    expect(malformed.status).toBe(400);
  });
});

describe('the account service’s room', () => {
  it('stops made-up tokens from noting replaced keys past its limit', async () => {
    let kept = 0;
    for (; kept < 1000; kept += 1) {
      const response = await stranger(PREVIEW, 'status', { method: 'PUT' });
      if (response.status === 507) break;
      expect(response.status).toBe(204);
    }
    expect(kept).toBe(Math.floor(STORAGE_LIMITS.replaced.preview / (16 * 1024)));
    // Asking about a made-up token keeps nothing.
    const before = server.status.stored().length;
    expect((await stranger(PREVIEW, 'status')).status).toBe(200);
    expect(server.status.stored()).toHaveLength(before);
  });

  it('still replaces the key when there’s no room to note the old one', async () => {
    const meter = server.env.ACCOUNT_STATUS.get(server.env.ACCOUNT_STATUS.idFromName('meter'));
    const limit = STORAGE_LIMITS.replaced.site;
    await meter.fetch('https://meter/', {
      method: 'POST',
      body: JSON.stringify({ id: 'strangers', bytes: limit, limit }),
    });
    const old = randomBytes(32);
    const next = randomBytes(32);
    await saveAccount(old);
    expect(await replaceAccountKey(old, next)).toEqual({ saved: true, noted: false });
    expect((await currentAccount())?.secret).toEqual(next);
    expect(replacedSecrets()).toEqual([old]);
    expect(await isReplaced(old)).toBe(false);
  });

  it('deletes a note nobody has asked about for 13 months, and keeps one that’s asked about', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const [asked, forgotten] = [randomBytes(32), randomBytes(32)];
    await saveAccount(asked);
    await replaceAccountKey(asked, randomBytes(32));
    await saveAccount(forgotten);
    await replaceAccountKey(forgotten, randomBytes(32));
    for (let month = 0; month < 14; month += 1) {
      vi.setSystemTime(Date.now() + UNUSED_MS / 12);
      await server.status.runAlarms();
      expect(await isReplaced(asked)).toBe(true);
    }
    expect(await isReplaced(forgotten)).toBe(false);
  });

  it('stops made-up passkey locks past its limit, and gets room back when one is removed', async () => {
    const lookups: string[] = [];
    for (let tries = 0; tries < 1000; tries += 1) {
      const lookup = madeUpToken();
      const response = await worker.fetch(
        new Request(`${PREVIEW}/api/account/passkey`, {
          method: 'PUT',
          body: lock(),
          headers: { Authorization: `Bearer ${lookup}` },
        }),
        server.env,
      );
      if (response.status === 507) break;
      expect(response.status).toBe(204);
      lookups.push(lookup);
    }
    expect(lookups).toHaveLength(Math.floor(STORAGE_LIMITS.passkeys.preview / (16 * 1024)));
    const remove = await worker.fetch(
      new Request(`${PREVIEW}/api/account/passkey`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${lookups[0] ?? ''}` },
      }),
      server.env,
    );
    expect(remove.status).toBe(204);
    expect((await stranger(PREVIEW, 'passkey', { method: 'PUT', body: lock() })).status).toBe(204);
  });
});
