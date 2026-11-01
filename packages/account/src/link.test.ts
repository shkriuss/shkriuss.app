/**
 * Device links (link.ts) against the account service (worker.ts), kept in
 * memory: making one, using it once, and cancelling it.
 */
import { randomBytes, toBase64Url } from '@shkriuss/crypto';
import type { DurableObjectNamespace } from '@shkriuss/server';
import { memoryNamespace } from '@shkriuss/server/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_MS } from './errors.ts';
import { cancelLink, claimLink, createLink, linkState, parseLinkFragment } from './link.ts';
import { LINK_LIFETIME_MS } from './validate.ts';
import worker, { AccountLink, LINKS, type AccountEnv } from './worker.ts';

const ORIGIN = 'https://shkriuss.app';

/** The links' objects in memory: one, named LINKS, holds every link. */
let links: ReturnType<typeof memoryNamespace<AccountLink>>;

beforeEach(() => {
  links = memoryNamespace((state) => new AccountLink(state));
  const env: AccountEnv = {
    ASSETS: { fetch: async () => new Response('page') },
    ACCOUNT_LINKS: links.namespace,
    ACCOUNT_PASSKEYS: null as unknown as DurableObjectNamespace,
    ACCOUNT_STATUS: null as unknown as DurableObjectNamespace,
  };
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
    worker.fetch(new Request(new URL(input, ORIGIN), init), env),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const fragmentOf = (url: string) => {
  const link = parseLinkFragment(new URL(url).hash);
  if (!link) throw new Error('Not a link');
  return link;
};

describe('a device link', () => {
  it('signs one other device in, once', async () => {
    const secret = randomBytes(32);
    const link = await createLink(secret, ORIGIN);
    expect(await linkState(link.id)).toBe('waiting');
    expect(await claimLink(fragmentOf(link.url))).toEqual(secret);
    expect(await linkState(link.id)).toBe('used');
    await expect(claimLink(fragmentOf(link.url))).rejects.toMatchObject({ code: 'link-taken' });
  });

  it('stops working once the device that showed it cancels it (audit A-2)', async () => {
    const link = await createLink(randomBytes(32), ORIGIN);
    expect(await cancelLink(link)).toBe('cancelled');
    expect(await linkState(link.id)).toBe('expired');
    // Someone who photographed the code gets nothing.
    await expect(claimLink(fragmentOf(link.url))).rejects.toMatchObject({ code: 'link-used' });
    // Cancelling again is fine.
    expect(await cancelLink(link)).toBe('cancelled');
  });

  it('says when it was used before it could be cancelled', async () => {
    const link = await createLink(randomBytes(32), ORIGIN);
    await claimLink(fragmentOf(link.url));
    expect(await cancelLink(link)).toBe('used');
    expect(await linkState(link.id)).toBe('used');
  });

  it('counts its 10 minutes by this device’s clock, not the server’s (audit 6 A-1)', async () => {
    // The page compared the server's time of expiry with its own clock: a
    // device 15 minutes ahead hid a code at once as "expired", and left it
    // working, with nobody watching.
    const T0 = Date.UTC(2026, 9, 31, 12);
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const service = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      vi.setSystemTime(T0 - 15 * 60_000);
      try {
        return await service(input, init);
      } finally {
        vi.setSystemTime(T0);
      }
    });
    const link = await createLink(randomBytes(32), ORIGIN);
    expect(link.expiresAt).toBe(T0 + LINK_LIFETIME_MS);
  });

  it('can only be cancelled with its own token', async () => {
    const link = await createLink(randomBytes(32), ORIGIN);
    const stranger = { ...link, cancel: link.cancel.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) };
    await expect(cancelLink(stranger)).rejects.toMatchObject({ code: 'server' });
    expect(await linkState(link.id)).toBe('waiting');
    const anonymous = await fetch(`/api/account/link/${link.id}`, { method: 'DELETE' });
    expect(anonymous.status).toBe(401);
  });
});

// A link was an object of its own, deleted only by its own alarm. When
// Cloudflare drops that alarm (it gives up after a few tries once the day's
// free writes are used up, which a script making links uses up itself), the
// link stayed for good: 12 KB that no meter counted.
describe('links, kept as rows in one object (audit 5 B-2)', () => {
  const T0 = Date.UTC(2026, 9, 27, 12);
  const MINUTE = 60_000;
  /** The one object's storage, and its rows for links. */
  const storage = () => links.objects.get(LINKS)?.storage;
  const rows = () => [...(storage()?.map.keys() ?? [])].sort();

  it('are rows in one object, with the alarm at the earliest expiry', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const first = await createLink(randomBytes(32), ORIGIN);
    vi.setSystemTime(T0 + MINUTE);
    const second = await createLink(randomBytes(32), ORIGIN);
    expect([...links.objects.keys()]).toEqual([LINKS]);
    expect(rows()).toEqual(
      [
        `link:${first.id}`,
        `link:${second.id}`,
        `due:${String(T0 + LINK_LIFETIME_MS).padStart(16, '0')}:${first.id}`,
        `due:${String(T0 + MINUTE + LINK_LIFETIME_MS).padStart(16, '0')}:${second.id}`,
      ].sort(),
    );
    expect(storage()?.alarm).toBe(T0 + LINK_LIFETIME_MS);
    expect(JSON.stringify(storage()?.map.get(`link:${first.id}`)).length).toBeLessThan(300);
  });

  it('go when they expire: the alarm deletes them and moves on to the next', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const first = await createLink(randomBytes(32), ORIGIN);
    vi.setSystemTime(T0 + MINUTE);
    const second = await createLink(randomBytes(32), ORIGIN);
    vi.setSystemTime(T0 + LINK_LIFETIME_MS);
    expect(await links.runAlarms()).toBe(1);
    expect(rows().filter((key) => key.startsWith('link:'))).toEqual([`link:${second.id}`]);
    expect(storage()?.alarm).toBe(T0 + MINUTE + LINK_LIFETIME_MS);
    expect(await linkState(first.id)).toBe('expired');
    expect(await linkState(second.id)).toBe('waiting');
    vi.setSystemTime(T0 + MINUTE + LINK_LIFETIME_MS);
    await links.runAlarms();
    expect(rows()).toEqual([]);
  });

  it('go at the next request when the alarm was lost, which also sets it again', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const link = await createLink(randomBytes(32), ORIGIN);
    // Cloudflare couldn't run the alarm (the day's limit was reached) and gave up.
    const store = storage();
    if (store) store.alarm = null;
    vi.setSystemTime(T0 + 400 * 24 * 60 * MINUTE);
    expect(await linkState(link.id)).toBe('expired');
    expect(rows()).toEqual([]);
    await expect(claimLink(fragmentOf(link.url))).rejects.toMatchObject({ code: 'link-used' });
    // A new link plans its own end again.
    const fresh = await createLink(randomBytes(32), ORIGIN);
    expect(rows().filter((key) => key.startsWith('link:'))).toEqual([`link:${fresh.id}`]);
    expect(storage()?.alarm).toBe(Date.now() + LINK_LIFETIME_MS);
  });

  it('say "used" until the link expires, then nothing is left of it', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const link = await createLink(randomBytes(32), ORIGIN);
    await claimLink(fragmentOf(link.url));
    expect(await linkState(link.id)).toBe('used');
    expect(storage()?.map.get(`link:${link.id}`)).toMatchObject({ data: null });
    vi.setSystemTime(T0 + LINK_LIFETIME_MS);
    expect(await linkState(link.id)).toBe('expired');
    expect(rows()).toEqual([]);
  });

  it('one made before this change, in an object of its own, still goes with its alarm', async () => {
    vi.useFakeTimers({ now: T0, toFake: ['Date'] });
    const id = toBase64Url(randomBytes(16));
    const old = links.namespace.get(links.namespace.idFromName(id));
    await old.fetch(`https://link/${id}/state`);
    const store = links.objects.get(id)?.storage;
    if (!store) throw new Error('No object');
    store.map.set('link', { data: 'A'.repeat(80), expiresAt: T0 + LINK_LIFETIME_MS, cancel: null });
    store.alarm = T0 + LINK_LIFETIME_MS;
    vi.setSystemTime(T0 + LINK_LIFETIME_MS);
    await links.runAlarms();
    expect(store.map.size).toBe(0);
    expect(store.alarm).toBeNull();
  });
});

describe('an account service that never answers (audit G-11)', () => {
  it('is given up on, so the page can say so instead of waiting for ever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      (_input: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    const checking = linkState('A'.repeat(22));
    const result = expect(checking).rejects.toMatchObject({ code: 'server' });
    await vi.advanceTimersByTimeAsync(REQUEST_MS);
    await result;
  });
});
