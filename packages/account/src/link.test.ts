/**
 * Device links (link.ts) against the account service (worker.ts), kept in
 * memory: making one, using it once, and cancelling it.
 */
import { randomBytes } from '@shkriuss/crypto';
import type { DurableObjectNamespace } from '@shkriuss/server';
import { memoryNamespace } from '@shkriuss/server/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUEST_MS } from './errors.ts';
import { cancelLink, claimLink, createLink, linkState, parseLinkFragment } from './link.ts';
import worker, { AccountLink, type AccountEnv } from './worker.ts';

const ORIGIN = 'https://shkriuss.app';

beforeEach(() => {
  const env: AccountEnv = {
    ASSETS: { fetch: async () => new Response('page') },
    ACCOUNT_LINKS: memoryNamespace((state) => new AccountLink(state)).namespace,
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

  it('can only be cancelled with its own token', async () => {
    const link = await createLink(randomBytes(32), ORIGIN);
    const stranger = { ...link, cancel: link.cancel.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) };
    await expect(cancelLink(stranger)).rejects.toMatchObject({ code: 'server' });
    expect(await linkState(link.id)).toBe('waiting');
    const anonymous = await fetch(`/api/account/link/${link.id}`, { method: 'DELETE' });
    expect(anonymous.status).toBe(401);
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
