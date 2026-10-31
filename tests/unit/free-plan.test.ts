/**
 * What every app's servers together can use of Cloudflare's free plan,
 * worked out from the code and apps.json. Each app with sync, notifications
 * or an online library adds its own limits, so a new app can't quietly use
 * up what all of them share (audit J-2, B-1).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { randomBytes, toBase64Url } from '../../packages/crypto/src/index.ts';
import accountWorker, {
  AccountLink,
  STORAGE_LIMITS as ACCOUNT,
  type AccountEnv,
} from '../../packages/account/src/worker.ts';
import { LIMITS as LIBRARY_LIMITS } from '../../packages/library/src/validate.ts';
import { STORAGE_LIMITS as LIBRARY } from '../../packages/library/src/worker.ts';
import { DAILY_SENDS, STORAGE_LIMITS as PUSH } from '../../packages/push/src/worker.ts';
import { apps } from '../../packages/registry/src/index.ts';
import type { DurableObjectNamespace } from '../../packages/server/src/index.ts';
import { memoryNamespace, MemoryStorage } from '../../packages/server/src/testing.ts';
import { memorySync } from '../../packages/sync/src/testing.ts';
import { STORAGE_LIMITS as SYNC } from '../../packages/sync/src/worker.ts';
import { parseJsonc } from '../../scripts/lib/jsonc.ts';

const repoRoot = join(import.meta.dirname, '../..');

/** Durable Object storage on the free plan, for every app together. */
const FREE_STORAGE = 5_000_000_000;
/** What the limits may add up to; the rest is a margin. */
const STORAGE_BUDGET = 4_500_000_000;
/** The owner's online library list, outside the meters (docs/adr/0016: about 400 bytes a photo). */
const LIBRARY_LIST = LIBRARY_LIMITS.items * 400;

/** Durable Object time on the free plan, a day: 13,000 GB-s, an object counting as 128 MB. */
const FREE_SECONDS = 13_000 / 0.128;

/** Durable Object namespaces on the free plan, for the whole account: one per storage class. */
const FREE_NAMESPACES = 100;

/** An app whose sync keeps files too, like Repairs' photos: `syncHandler({ files: true })`. */
const syncsFiles = (slug: string): boolean =>
  /syncHandler\(\{\s*files:\s*true\s*\}\)/.test(
    readFileSync(join(repoRoot, 'apps', slug, 'src/worker.ts'), 'utf8'),
  );

/** Every site's Durable Object namespaces. */
function namespaces(): number {
  const sites = readdirSync(join(repoRoot, 'apps')).filter((slug) =>
    existsSync(join(repoRoot, 'apps', slug, 'wrangler.jsonc')),
  );
  let total = 0;
  for (const slug of sites) {
    const config = parseJsonc(
      readFileSync(join(repoRoot, 'apps', slug, 'wrangler.jsonc'), 'utf8'),
    ) as { durable_objects?: { bindings: unknown[] } };
    total += config.durable_objects?.bindings.length ?? 0;
  }
  return total;
}

/** Every namespace's limit together. */
function storageLimits(): number {
  let total = ACCOUNT.passkeys + ACCOUNT.replaced;
  for (const app of apps) {
    if (app.sync) total += syncsFiles(app.slug) ? SYNC.files : SYNC.copies;
    if (app.pushNotifications) total += PUSH;
    if (app.library) total += LIBRARY;
  }
  return total;
}

describe('the free plan, shared by every app', () => {
  it('has room for every server’s storage limit and the library list', () => {
    const total = storageLimits() + LIBRARY_LIST;
    expect(STORAGE_BUDGET).toBeLessThan(FREE_STORAGE);
    expect(
      total,
      'The storage limits add up to too much: lower them before adding this app (docs/adr/0017).',
    ).toBeLessThanOrEqual(STORAGE_BUDGET);
  });

  it('has Durable Object namespaces for every site', () => {
    expect(
      namespaces(),
      'The free plan has 100 Durable Object namespaces for the whole account (docs/deployment.md).',
    ).toBeLessThanOrEqual(FREE_NAMESPACES);
  });

  it('can be kept waiting by push services for a quarter of its daily time at most', () => {
    // Each app waits at most about DAILY_SENDS seconds a day (docs/adr/0009).
    const waiting = apps.filter((app) => app.pushNotifications).length * DAILY_SENDS;
    expect(
      waiting,
      'Push services could keep the servers waiting too long: lower DAILY_SENDS (docs/adr/0009).',
    ).toBeLessThanOrEqual(FREE_SECONDS / 4);
  });
});

/** Durable Object rows written while `run` runs: each put() and each setAlarm() is one. */
async function rowsWritten(run: () => Promise<unknown>): Promise<number> {
  const put = vi.spyOn(MemoryStorage.prototype, 'put');
  const alarm = vi.spyOn(MemoryStorage.prototype, 'setAlarm');
  try {
    await run();
    return put.mock.calls.length + alarm.mock.calls.length;
  } finally {
    put.mockRestore();
    alarm.mockRestore();
  }
}

describe('the free plan’s row writes (audit 5 B-4)', () => {
  // Besides 100,000 requests a day, SQLite-backed objects may write 100,000
  // rows a day for every app together, and a setAlarm() counts as one. Those
  // run out first: the cheapest requests a stranger can make that write
  // anything cost these rows (docs/adr/0010, "Free quota"), so a new route
  // can't quietly make it cheaper without failing here.
  const FREE_ROW_WRITES = 100_000;
  const FREE_REQUESTS = 100_000;

  it('a device link: its row, its place in the order of expiry, and the first alarm', async () => {
    const links = memoryNamespace((state) => new AccountLink(state));
    const env: AccountEnv = {
      ASSETS: { fetch: async () => new Response('page') },
      ACCOUNT_LINKS: links.namespace,
      ACCOUNT_PASSKEYS: null as unknown as DurableObjectNamespace,
      ACCOUNT_STATUS: null as unknown as DurableObjectNamespace,
    };
    const link = (id: string) =>
      accountWorker.fetch(
        new Request(`https://shkriuss.app/api/account/link/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ data: 'A'.repeat(80) }),
        }),
        env,
      );
    expect(await rowsWritten(() => link('A'.repeat(22)))).toBe(3);
    expect(await rowsWritten(() => link('B'.repeat(22)))).toBe(2);
    // So about 50,000 such requests use up the day's writes, long before its requests.
    expect(FREE_ROW_WRITES / 2).toBeLessThan(FREE_REQUESTS);
  });

  it('a first sync copy: the meter’s two rows, its room, the write count, the copy, its last use and the alarm', async () => {
    const server = memorySync();
    const copy = () =>
      server.fetch(
        new Request('https://notes.shkriuss.app/api/sync/copy', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${toBase64Url(randomBytes(32))}` },
          body: JSON.stringify({ base: null, data: 'A'.repeat(100) }),
        }),
      );
    expect(await rowsWritten(copy)).toBe(7);
    expect(FREE_ROW_WRITES / 7).toBeLessThan(FREE_REQUESTS);
  });
});
