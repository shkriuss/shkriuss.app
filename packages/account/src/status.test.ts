/**
 * Replacing the account key: the account service's record of replaced keys
 * (worker.ts, kept in memory here) and what the device remembers (device.ts).
 */
import { randomBytes } from '@shkriuss/crypto';
import type { DurableObjectNamespace } from '@shkriuss/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentAccount,
  forgetAccount,
  noteReplaced,
  replacedSecrets,
  saveAccount,
} from './device.ts';
import { isReplaced, replaceAccountKey } from './status.ts';
import worker, { AccountStatus, type AccountEnv } from './worker.ts';

function memoryEnv(): AccountEnv {
  const objects = new Map<string, AccountStatus>();
  const status: DurableObjectNamespace = {
    idFromName: (name) => ({ toString: () => name }),
    get: (id) => {
      const name = id.toString();
      const map = new Map<string, unknown>();
      const object =
        objects.get(name) ??
        new AccountStatus({
          storage: {
            get: async <T>(key: string) => map.get(key) as T | undefined,
            put: async (key, value) => void map.set(key, value),
            deleteAll: async () => map.clear(),
            setAlarm: async () => undefined,
            deleteAlarm: async () => undefined,
          },
          blockConcurrencyWhile: (callback) => callback(),
        });
      objects.set(name, object);
      return { fetch: (input, init) => object.fetch(new Request(input, init)) };
    },
  };
  const unused: DurableObjectNamespace = {
    idFromName: status.idFromName,
    get: () => ({ fetch: async () => new Response(null, { status: 500 }) }),
  };
  return {
    ASSETS: { fetch: async () => new Response('page') },
    ACCOUNT_LINKS: unused,
    ACCOUNT_PASSKEYS: unused,
    ACCOUNT_STATUS: status,
  };
}

class MemoryStorage {
  #map = new Map<string, string>();
  getItem = (key: string) => this.#map.get(key) ?? null;
  setItem = (key: string, value: string) => void this.#map.set(key, value);
  removeItem = (key: string) => void this.#map.delete(key);
}

let env: AccountEnv;

beforeEach(() => {
  env = memoryEnv();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
    worker.fetch(new Request(new URL(input, 'https://shkriuss.app'), init), env),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('replacing the account key', () => {
  it('marks the old key as replaced for good, and signs in with the new one', async () => {
    const old = randomBytes(32);
    const next = randomBytes(32);
    saveAccount(old);
    expect(await isReplaced(old)).toBe(false);

    expect(await replaceAccountKey(old, next)).toBe(true);
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
    saveAccount(a);
    noteReplaced(a);
    expect(await currentAccount()).toBeNull();
    expect(replacedSecrets()).toEqual([a]);

    saveAccount(b);
    noteReplaced(c);
    expect((await currentAccount())?.secret).toEqual(b);
    expect(replacedSecrets()).toEqual([c, a]);

    for (let index = 0; index < 10; index += 1) noteReplaced(randomBytes(32));
    expect(replacedSecrets()).toHaveLength(5);

    forgetAccount();
    expect(await currentAccount()).toBeNull();
    expect(replacedSecrets()).toEqual([]);
  });
});
