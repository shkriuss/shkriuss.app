/**
 * What every app's servers together can use of Cloudflare's free plan,
 * worked out from the code and apps.json. Each app with sync, notifications
 * or an online library adds its own limits, so a new app can't quietly use
 * up what all of them share (audit J-2, B-1).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORAGE_LIMITS as ACCOUNT } from '../../packages/account/src/worker.ts';
import { LIMITS as LIBRARY_LIMITS } from '../../packages/library/src/validate.ts';
import { STORAGE_LIMITS as LIBRARY } from '../../packages/library/src/worker.ts';
import { DAILY_SENDS, STORAGE_LIMITS as PUSH } from '../../packages/push/src/worker.ts';
import { apps } from '../../packages/registry/src/index.ts';
import { STORAGE_LIMITS as SYNC } from '../../packages/sync/src/worker.ts';
import { parseJsonc } from '../../scripts/lib/jsonc.ts';

const repoRoot = join(import.meta.dirname, '../..');

/** Durable Object storage on the free plan, for every app together. */
const FREE_STORAGE = 5_000_000_000;
/** What the limits may add up to; the rest is a margin. */
const STORAGE_BUDGET = 4_500_000_000;
/**
 * Pull requests whose previews fit at once (docs/deployment.md says how
 * many). Each set of previews has its own storage, with smaller limits, and
 * its own Durable Object namespaces.
 */
const PREVIEWS = 2;
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

/** Every site's Durable Object namespaces: its own, or one set of previews'. */
function namespaces(where: 'site' | 'preview'): number {
  const sites = readdirSync(join(repoRoot, 'apps')).filter((slug) =>
    existsSync(join(repoRoot, 'apps', slug, 'wrangler.jsonc')),
  );
  let total = 0;
  for (const slug of sites) {
    const config = parseJsonc(
      readFileSync(join(repoRoot, 'apps', slug, 'wrangler.jsonc'), 'utf8'),
    ) as {
      durable_objects?: { bindings: unknown[] };
      previews?: { durable_objects?: { bindings: unknown[] } };
    };
    const own = where === 'site' ? config.durable_objects : config.previews?.durable_objects;
    total += own?.bindings.length ?? 0;
  }
  return total;
}

/** Every namespace's limit together, on the real sites or on one preview. */
function storageLimits(where: 'site' | 'preview'): number {
  let total = ACCOUNT.passkeys[where] + ACCOUNT.replaced[where];
  for (const app of apps) {
    if (app.sync) total += (syncsFiles(app.slug) ? SYNC.files : SYNC.copies)[where];
    if (app.pushNotifications) total += PUSH[where];
    if (app.library) total += LIBRARY[where];
  }
  return total;
}

describe('the free plan, shared by every app', () => {
  it('has room for every server’s storage limit, two open previews and the library list', () => {
    const total = storageLimits('site') + PREVIEWS * storageLimits('preview') + LIBRARY_LIST;
    expect(STORAGE_BUDGET).toBeLessThan(FREE_STORAGE);
    expect(
      total,
      'The storage limits add up to too much: lower them before adding this app (docs/adr/0017).',
    ).toBeLessThanOrEqual(STORAGE_BUDGET);
  });

  it('has Durable Object namespaces for every site and two pull requests’ previews', () => {
    expect(namespaces('preview')).toBe(namespaces('site'));
    expect(
      namespaces('site') + PREVIEWS * namespaces('preview'),
      'Fewer pull requests can have previews at once: say how many in PREVIEWS and in docs/deployment.md.',
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
