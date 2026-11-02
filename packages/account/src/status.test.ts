/**
 * Replacing the account key: the account service's record of replaced keys
 * (worker.ts, kept in memory here) and what the device remembers (device.ts).
 */
import { hkdf, randomBytes, toBase64Url } from '@shkriuss/crypto';
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
import { checkReplaced, isReplaced, replaceAccountKey, replacedNote } from './status.ts';
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

/** What checkReplaced says when nothing changed. */
const UNCHANGED = { outcome: 'unchanged' };
/** What replacing the key here says when it worked. */
const REPLACED = { outcome: 'replaced', saved: true, noted: true };

/** Replaces `old` with `next`: the account service notes it, but its answer is lost. */
async function replaceWithLostAnswer(old: Uint8Array<ArrayBuffer>, next: Uint8Array<ArrayBuffer>) {
  const service = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    await service(input, init);
    throw new TypeError('The connection was lost');
  });
  await expect(replaceAccountKey(old, next)).rejects.toMatchObject({ code: 'server' });
  vi.stubGlobal('fetch', service);
}

/** Replaces `old` with `next` on another device (its own browser storage). */
async function replaceElsewhere(old: Uint8Array<ArrayBuffer>, next: Uint8Array<ArrayBuffer>) {
  const here = globalThis.localStorage;
  vi.stubGlobal('localStorage', new MemoryStorage());
  await saveAccount(old);
  await replaceAccountKey(old, next);
  vi.stubGlobal('localStorage', here);
}
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

    expect(await replaceAccountKey(old, next)).toEqual(REPLACED);
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
    expect(await checkReplaced(phone)).toEqual({ outcome: 'signed-out', apps: ['notes'] });
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
    expect(await checkReplaced(account)).toEqual(UNCHANGED);

    // Replaced, but the account service can't be reached: checked again next time.
    await replaceAccountKey(key, randomBytes(32));
    await saveAccount(key);
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    expect(await checkReplaced(account)).toEqual(UNCHANGED);
    expect((await currentAccount())?.secret).toEqual(key);
    expect([...syncedApps(account.code).keys()]).toEqual(['notes']);
  });

  it('keeps another key signed in meanwhile (in another tab)', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    const phone = await phoneAfterReplacing(old, next);
    await saveAccount(next);
    expect(await checkReplaced(phone)).toEqual(UNCHANGED);
    expect((await currentAccount())?.secret).toEqual(next);
  });
});

describe('a key replacement whose answer never came (audit 6 A-1)', () => {
  // The account service noted the old key as replaced, but its answer was
  // lost and the page closed. Next time, the device took itself for a lost
  // one: it signed out and forgot the old key, so no app could move its old
  // copy any more, and the lost device kept it.

  /** The page opens again: what it does first. */
  async function pageOpens() {
    const account = await currentAccount();
    if (!account) throw new Error('Not signed in');
    return checkReplaced(account);
  }

  it('is finished the next time the page opens, keeping the old key for the apps', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    await replaceWithLostAnswer(old, next);
    expect(await isReplaced(old)).toBe(true);
    expect((await currentAccount())?.secret).toEqual(old);

    expect(await pageOpens()).toEqual(REPLACED);
    const account = await currentAccount();
    expect(account?.secret).toEqual(next);
    expect(replacedSecrets()).toEqual([old]);
    // Signed in, the replacement under way is over.
    expect(JSON.parse(localStorage.getItem('shkriuss-device:account') ?? '{}')).not.toHaveProperty(
      'next',
    );
    expect(await pageOpens()).toEqual(UNCHANGED);
  });

  it('changes nothing when the one check fails, and is finished the next time (audit 7 A-1, run 27)', async () => {
    // The page asked twice as it opened: when only the first check failed,
    // the second took this device for a lost one. It signed out and forgot
    // the old key (and the new one), so no app could move its old copy.
    const [old, next] = [randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    const phone = await currentAccount();
    if (!phone) throw new Error('Not signed in');
    noteSyncOn('notes', phone.code, 'https://notes.shkriuss.app');
    await replaceWithLostAnswer(old, next);

    // The first request fails (a timeout, a dropped connection, a 503); any
    // later one would get through.
    const service = globalThis.fetch;
    let calls = 0;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      calls += 1;
      return calls === 1 ? new Response(null, { status: 503 }) : service(input, init);
    });
    expect(await pageOpens()).toEqual(UNCHANGED);
    expect(calls).toBe(1);
    expect((await currentAccount())?.secret).toEqual(old);
    expect([...syncedApps(phone.code).keys()]).toEqual(['notes']);

    // Next time, it's finished.
    expect(await pageOpens()).toEqual(REPLACED);
    expect((await currentAccount())?.secret).toEqual(next);
    expect(replacedSecrets()).toEqual([old]);
  });

  it('isn’t, and changes nothing, when the request never got there', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    const service = globalThis.fetch;
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Offline')));
    await expect(replaceAccountKey(old, next)).rejects.toMatchObject({ code: 'server' });
    vi.stubGlobal('fetch', service);

    // Can't be told: the new key is kept, in case the service noted it.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Offline')));
    expect(await pageOpens()).toEqual(UNCHANGED);
    const stored = () => JSON.parse(localStorage.getItem('shkriuss-device:account') ?? '{}');
    expect(stored()).toHaveProperty('next');
    vi.stubGlobal('fetch', service);
    // Not replaced: that replacement never got there, so the next one gets
    // a new key, not this one months later (audit 7 A-2, run 27).
    expect(await pageOpens()).toEqual(UNCHANGED);
    expect((await currentAccount())?.secret).toEqual(old);
    expect(stored()).not.toHaveProperty('next');
    expect(stored().secret).toBe(toBase64Url(old));
    // Trying again works as usual.
    expect(await replaceAccountKey(old, next)).toEqual(REPLACED);
    expect((await currentAccount())?.secret).toEqual(next);
    expect(replacedSecrets()).toEqual([old]);
  });

  it('isn’t when another device replaced the key: this one signs out, as before', async () => {
    const [old, next, theirs] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    const service = globalThis.fetch;
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Offline')));
    await expect(replaceAccountKey(old, next)).rejects.toMatchObject({ code: 'server' });
    vi.stubGlobal('fetch', service);
    // Meanwhile, the lost device replaced the key with one of its own.
    await replaceElsewhere(old, theirs);

    expect(await pageOpens()).toEqual({ outcome: 'signed-out', apps: [] });
    expect(await currentAccount()).toBeNull();
    expect(replacedSecrets()).toEqual([]);
  });
});

describe('replacing a key that was already replaced (audit 7 A-2, run 27)', () => {
  // The account service answered every replacement alike, so the page took
  // it for done: when another device (perhaps the lost one) had replaced the
  // key first, this one signed in with a key the note didn't name, and kept
  // the old key for the apps. Nothing ever signed it out, and its apps moved
  // the old copies to an account no other device had.

  it('signs this device out when another device replaced it first, as its next visit would', async () => {
    const [old, mine, theirs] = [randomBytes(32), randomBytes(32), randomBytes(32)];
    await replaceElsewhere(old, theirs);
    await saveAccount(old);
    const phone = await currentAccount();
    if (!phone) throw new Error('Not signed in');
    noteSyncOn('notes', phone.code, 'https://notes.shkriuss.app');

    expect(await replaceAccountKey(old, mine)).toEqual({ outcome: 'signed-out', apps: ['notes'] });
    expect(await currentAccount()).toBeNull();
    expect(replacedSecrets()).toEqual([]);
    expect(localStorage.getItem('shkriuss-device:account')).toBeNull();
    // The note still names the first replacement.
    expect((await replacedNote(old)).successor).toBe(await successorTag(old, theirs));
  });

  it('is finished by trying again with the same new key, after an answer that never came', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    await replaceWithLostAnswer(old, next);
    expect(await replaceAccountKey(old, next)).toEqual(REPLACED);
    expect((await currentAccount())?.secret).toEqual(next);
    expect(replacedSecrets()).toEqual([old]);
  });

  it('the service answers with the note it keeps', async () => {
    const [old, first] = [randomBytes(32), randomBytes(32)];
    const put = async (successor: string) =>
      (
        await worker.fetch(
          new Request('https://shkriuss.app/api/account/status', {
            method: 'PUT',
            body: JSON.stringify({ successor }),
            headers: {
              Authorization: `Bearer ${toBase64Url(await hkdf(old, 'shkriuss account status v1'))}`,
              'Content-Type': 'application/json',
            },
          }),
          server.env,
        )
      ).json();
    const tag = await successorTag(old, first);
    expect(await put(tag)).toEqual({ replaced: true, successor: tag });
    expect(await put(await successorTag(old, randomBytes(32)))).toEqual({
      replaced: true,
      successor: tag,
    });
  });

  it('isn’t taken for done when the answer doesn’t say the key is replaced', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    vi.stubGlobal('fetch', async () => Response.json({ replaced: false }));
    await expect(replaceAccountKey(old, next)).rejects.toMatchObject({ code: 'server' });
    expect((await currentAccount())?.secret).toEqual(old);
  });

  it('works as before with an account service from before, which answered with nothing', async () => {
    const [old, next] = [randomBytes(32), randomBytes(32)];
    await saveAccount(old);
    const service = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const response = await service(input, init);
      return init?.method === 'PUT' ? new Response(null, { status: 204 }) : response;
    });
    expect(await replaceAccountKey(old, next)).toEqual(REPLACED);
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

  it('noted before the time was kept, count from the next time the page opens (audit 6 A-4)', async () => {
    // Only signing in or another replacement noted the time: on a device
    // that stayed signed in, they were handed to the apps for ever.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 31, 12));
    const [old, next] = [randomBytes(32), randomBytes(32)];
    localStorage.setItem(
      'shkriuss-device:account',
      JSON.stringify({
        secret: toBase64Url(next),
        since: '2026-10-20T10:00:00.000Z',
        replaced: [toBase64Url(old)],
        successors: { [toBase64Url(old)]: await successorTag(old, next) },
      }),
    );
    expect((await currentAccount())?.secret).toEqual(next);
    vi.setSystemTime(Date.now() + UNUSED_MS - 1);
    // Opening the page again doesn't start them again.
    await currentAccount();
    expect(replacedSecrets()).toEqual([old]);
    vi.setSystemTime(Date.now() + 1);
    expect(replacedSecrets()).toEqual([]);
    expect((await currentAccount())?.secret).toEqual(next);
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
      expect(response.status).toBe(200);
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
    expect(await replaceAccountKey(old, next)).toEqual({ ...REPLACED, noted: false });
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
