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
  noteSyncOn,
  replacedSecrets,
  saveAccount,
  syncedApps,
} from './device.ts';
import { sha256Text } from '@shkriuss/server';
import { successorTag } from './secret.ts';
import { HUB, testPasskey } from './testing.ts';
import { isReplaced, replaceAccountKey, replacedNote, signOutIfReplaced } from './status.ts';
import worker, {
  AccountPasskey,
  AccountStatus,
  STORAGE_LIMITS,
  UNUSED_MS,
  type AccountEnv,
} from './worker.ts';

/** The account service in memory; with `limit`, a small one for each namespace instead of the real ones. */
function memoryEnv(limit?: number) {
  const options = limit === undefined ? {} : { limit };
  const env: AccountEnv = {
    ASSETS: { fetch: async () => new Response('page') },
    ACCOUNT_LINKS: {
      idFromName: (name) => ({ toString: () => name }),
      get: () => ({ fetch: async () => new Response(null, { status: 500 }) }),
    },
    ACCOUNT_PASSKEYS: null as unknown as DurableObjectNamespace,
    ACCOUNT_STATUS: null as unknown as DurableObjectNamespace,
  };
  const passkeys = memoryNamespace((state) => new AccountPasskey(state, env), options);
  const status = memoryNamespace((state) => new AccountStatus(state, env), options);
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

/** A small limit, so the tests fill it quickly. */
const SMALL_LIMIT = 4_000_000;
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
/** A request to the passkey routes, from `origin`, with `body`. */
const passkeyRequest = (
  origin: string,
  path: string,
  lookup: string,
  method: string,
  body: unknown,
) =>
  worker.fetch(
    new Request(`${origin}/api/account/passkey${path}`, {
      method,
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${lookup}`, 'Content-Type': 'application/json' },
    }),
    server.env,
  );

/** A new passkey lock, as the Account page at `origin` sends it, signed by `passkey`. */
async function newLock(passkey: Awaited<ReturnType<typeof testPasskey>>, origin = HUB.origin) {
  const assertion = await passkey.sign({ origin, rpId: new URL(origin).hostname, purpose: 'add' });
  return { wrap: toBase64Url(randomBytes(60)), ...passkey.key, assertion };
}

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

describe('a device whose key was replaced elsewhere (audit 3 D-8)', () => {
  const NOTES = 'https://notes.shkriuss.app';

  /** The phone, still on `old`, with Notes syncing; the tablet replaced `old` with `next`. */
  async function phoneAfterReplacing(old: Uint8Array<ArrayBuffer>, next: Uint8Array<ArrayBuffer>) {
    await saveAccount(old);
    await replaceAccountKey(old, next);
    vi.stubGlobal('localStorage', new MemoryStorage());
    await saveAccount(old);
    const phone = await currentAccount();
    if (!phone) throw new Error('Not signed in');
    noteSyncOn('notes', phone.code, NOTES);
    noteSyncOn('tasks', 'SOME-ONE8', 'https://tasks.shkriuss.app');
    return phone;
  }

  it('signs out forgetting the key and its apps, as signing out does', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    const phone = await phoneAfterReplacing(old, next);
    // Notes synced here with that key: it still may (it has its own key).
    expect(await signOutIfReplaced(phone)).toEqual(['notes']);
    expect(await currentAccount()).toBeNull();
    expect(replacedSecrets()).toEqual([]);
    expect(localStorage.getItem('shkriuss-device:account')).toBeNull();
    expect(localStorage.getItem('shkriuss-device:synced-apps')).toBeNull();
    // Signed in with the new key, nothing of the old one is back.
    await saveAccount(next);
    expect(replacedSecrets()).toEqual([]);
    expect(syncedApps(phone.code)).toEqual(new Map());
  });

  it('changes nothing if the key wasn’t replaced, or that can’t be checked now', async () => {
    const key = randomBytes(32);
    await saveAccount(key);
    const account = await currentAccount();
    if (!account) throw new Error('Not signed in');
    noteSyncOn('notes', account.code, NOTES);
    expect(await signOutIfReplaced(account)).toBeNull();

    // Replaced, but the account service can't be reached: checked again next time.
    await replaceAccountKey(key, randomBytes(32));
    await saveAccount(key);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    expect(await signOutIfReplaced(account)).toBeNull();
    expect((await currentAccount())?.secret).toEqual(key);
    expect([...syncedApps(account.code).keys()]).toEqual(['notes']);
  });

  it('keeps another key signed in meanwhile (in another tab)', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    const phone = await phoneAfterReplacing(old, next);
    await saveAccount(next);
    expect(await signOutIfReplaced(phone)).toBeNull();
    expect((await currentAccount())?.secret).toEqual(next);
  });
});

describe('replaced keys this device keeps (audit 5 A-1)', () => {
  // The account service forgets a replaced key 13 months after a device last
  // asked about it, and so does the "moved" note on the app's old online
  // copy. The hub kept the old key for ever, and handed it to every app at
  // each "Turn on sync": a copy the old key started after the clean-up was
  // brought into the person's data.
  it('are forgotten 13 months after they were noted', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 27, 12));
    const [old, next] = [randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    await replaceAccountKey(old, next);
    expect(replacedSecrets()).toEqual([old]);
    vi.setSystemTime(Date.now() + UNUSED_MS - 1);
    expect(replacedSecrets()).toEqual([old]);
    vi.setSystemTime(Date.now() + 1);
    expect(replacedSecrets()).toEqual([]);
    // Signing in again leaves nothing of it in the browser's storage.
    await saveAccount(next);
    expect(localStorage.getItem('shkriuss-device:account')).not.toContain(toBase64Url(old));
  });

  it('noted before the time was kept, count from the next sign-in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 27, 12));
    const [old, next] = [randomBytes(32), randomBytes(32)];
    localStorage.setItem(
      'shkriuss-device:account',
      JSON.stringify({
        secret: toBase64Url(next),
        since: new Date().toISOString(),
        replaced: [toBase64Url(old)],
        successors: { [toBase64Url(old)]: await successorTag(old, next) },
      }),
    );
    expect(replacedSecrets()).toEqual([old]);
    vi.setSystemTime(Date.now() + 2 * UNUSED_MS);
    expect(replacedSecrets()).toEqual([old]);
    await saveAccount(next);
    expect(replacedSecrets()).toEqual([old]);
    vi.setSystemTime(Date.now() + UNUSED_MS);
    expect(replacedSecrets()).toEqual([]);
  });
});

describe('replaced keys and other accounts (audit A-3)', () => {
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

describe('passkey locks (audit C-1)', () => {
  const signed = async (
    passkey: Awaited<ReturnType<typeof testPasskey>>,
    purpose: 'open' | 'remove',
    origin = HUB.origin,
  ) => ({ assertion: await passkey.sign({ origin, rpId: new URL(origin).hostname, purpose }) });

  it('are given out only for the passkey’s signature made on the Account page', async () => {
    const passkey = await testPasskey(-7);
    const lookup = madeUpToken();
    const lock = await newLock(passkey);
    expect((await passkeyRequest(HUB.origin, '', lookup, 'PUT', lock)).status).toBe(204);

    // A script on an app's page can use the same passkey, but its signature says where it was made.
    const fromApp = await signed(passkey, 'open', 'https://tally.shkriuss.app');
    expect((await passkeyRequest(HUB.origin, '/open', lookup, 'POST', fromApp)).status).toBe(403);
    // Nor does a signature for removing it open it.
    const forRemoving = await signed(passkey, 'remove');
    expect((await passkeyRequest(HUB.origin, '/open', lookup, 'POST', forRemoving)).status).toBe(
      403,
    );

    const opened = await passkeyRequest(
      HUB.origin,
      '/open',
      lookup,
      'POST',
      await signed(passkey, 'open'),
    );
    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ wrap: lock.wrap });
  });

  it('can’t be replaced, and only its own passkey removes it', async () => {
    const passkey = await testPasskey(-257);
    const lookup = madeUpToken();
    expect(
      (await passkeyRequest(HUB.origin, '', lookup, 'PUT', await newLock(passkey))).status,
    ).toBe(204);
    // Someone with the passkey's PRF value (and so the lookup token) can't put their own lock there.
    const theirs = await newLock(await testPasskey(-7));
    expect((await passkeyRequest(HUB.origin, '', lookup, 'PUT', theirs)).status).toBe(409);
    const notMine = await signed(await testPasskey(-7), 'remove');
    expect((await passkeyRequest(HUB.origin, '/remove', lookup, 'POST', notMine)).status).toBe(403);

    const mine = await signed(passkey, 'remove');
    expect((await passkeyRequest(HUB.origin, '/remove', lookup, 'POST', mine)).status).toBe(204);
    const gone = await passkeyRequest(
      HUB.origin,
      '/open',
      lookup,
      'POST',
      await signed(passkey, 'open'),
    );
    expect(gone.status).toBe(404);
    // Only then may the browser forget the passkey (audit A-4).
    expect(await gone.json()).toMatchObject({ unknown: true });
  });

  it('refuses a new lock signed elsewhere, or by another passkey', async () => {
    const passkey = await testPasskey(-7);
    const fromApp = await newLock(passkey, 'https://tally.shkriuss.app');
    expect((await passkeyRequest(HUB.origin, '', madeUpToken(), 'PUT', fromApp)).status).toBe(403);
    const otherKey = { ...(await newLock(passkey)), ...(await testPasskey(-7)).key };
    expect((await passkeyRequest(HUB.origin, '', madeUpToken(), 'PUT', otherKey)).status).toBe(403);
  });

  it('a lock from before signatures were checked no longer opens, and can be removed', async () => {
    const passkey = await testPasskey(-7);
    const lookup = madeUpToken();
    // Pages from before: GET and DELETE are refused.
    const get = await worker.fetch(
      new Request(`${HUB.origin}/api/account/passkey`, {
        headers: { Authorization: `Bearer ${lookup}` },
      }),
      server.env,
    );
    expect(get.status).toBe(405);
    // A lock saved by them: only its sealed secret, no public key.
    await passkeyRequest(HUB.origin, '/open', lookup, 'POST', await signed(passkey, 'open'));
    const object = server.passkeys.objects.get(await sha256Text(lookup));
    object?.storage.map.set('wrap', toBase64Url(randomBytes(60)));

    const opened = await passkeyRequest(
      HUB.origin,
      '/open',
      lookup,
      'POST',
      await signed(passkey, 'open'),
    );
    expect(opened.status).toBe(410);
    expect(await opened.json()).toMatchObject({ old: true });
    const removed = await passkeyRequest(
      HUB.origin,
      '/remove',
      lookup,
      'POST',
      await signed(passkey, 'remove'),
    );
    expect(removed.status).toBe(204);
  });
});

describe('the account service’s room', () => {
  it('stops made-up tokens from noting replaced keys past its limit', async () => {
    server = memoryEnv(SMALL_LIMIT);
    let kept = 0;
    for (; kept < 1000; kept += 1) {
      const response = await stranger(HUB.origin, 'status', { method: 'PUT' });
      if (response.status === 507) break;
      expect(response.status).toBe(204);
    }
    expect(kept).toBe(Math.floor(SMALL_LIMIT / (16 * 1024)));
    // Asking about a made-up token keeps nothing.
    const before = server.status.stored().length;
    expect((await stranger(HUB.origin, 'status')).status).toBe(200);
    expect(server.status.stored()).toHaveLength(before);
    // The Worker tells each note the real limit.
    expect(new Set(server.status.limits())).toEqual(new Set([String(STORAGE_LIMITS.replaced)]));
  });

  it('still replaces the key when there’s no room to note the old one', async () => {
    const meter = server.env.ACCOUNT_STATUS.get(server.env.ACCOUNT_STATUS.idFromName('meter'));
    const limit = STORAGE_LIMITS.replaced;
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

  it('keeps a replaced-key note 13 months after a device last asked, as the docs say (audit 3 J-4)', () => {
    // The privacy page ("deleted once no device has asked about it for 13
    // months") and ADR 0017 ("13 months after a device last asked about
    // it"): 396 days. Change them with it.
    expect(UNUSED_MS).toBe(396 * 24 * 60 * 60 * 1000);
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
    server = memoryEnv(SMALL_LIMIT);
    // A stranger can make passkeys of their own, and sign whatever they like with them.
    const made: { lookup: string; passkey: Awaited<ReturnType<typeof testPasskey>> }[] = [];
    for (let tries = 0; tries < 1000; tries += 1) {
      const lookup = madeUpToken();
      const passkey = await testPasskey(-7);
      const response = await passkeyRequest(HUB.origin, '', lookup, 'PUT', await newLock(passkey));
      if (response.status === 507) break;
      expect(response.status).toBe(204);
      made.push({ lookup, passkey });
    }
    expect(made).toHaveLength(Math.floor(SMALL_LIMIT / (16 * 1024)));
    const [first] = made;
    if (!first) throw new Error('No lock');
    const assertion = await first.passkey.sign({
      origin: HUB.origin,
      rpId: new URL(HUB.origin).hostname,
      purpose: 'remove',
    });
    const remove = await passkeyRequest(HUB.origin, '/remove', first.lookup, 'POST', {
      assertion,
    });
    expect(remove.status).toBe(204);
    const another = await newLock(await testPasskey(-7));
    expect((await passkeyRequest(HUB.origin, '', madeUpToken(), 'PUT', another)).status).toBe(204);
    // The Worker tells each lock the real limit.
    expect(new Set(server.passkeys.limits())).toEqual(new Set([String(STORAGE_LIMITS.passkeys)]));
  });
});
