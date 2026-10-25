/**
 * Checks that the registry, the apps/ folders and each app's Cloudflare
 * settings agree with each other, so a typo can't ship a broken deploy.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apps, hub, HUB_SLUG } from '../../packages/registry/src/index.ts';
import { isIconName } from '../../packages/ui/src/icons/index.ts';
import { parseJsonc } from '../../scripts/lib/jsonc.ts';

const repoRoot = join(import.meta.dirname, '../..');
const appFolders = readdirSync(join(repoRoot, 'apps'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

interface WranglerConfig {
  name: string;
  main?: string;
  routes: { pattern: string; custom_domain: boolean }[];
  assets: { directory: string; not_found_handling: string; run_worker_first?: string[] };
  workers_dev: boolean;
  preview_urls: boolean;
  observability?: { enabled: boolean };
  durable_objects?: { bindings: { name: string; class_name: string }[] };
  migrations?: { tag: string; new_sqlite_classes?: string[] }[];
  r2_buckets?: { binding: string; bucket_name: string }[];
}

/** What each server feature needs: its Durable Objects (packages/<feature>). */
type Feature = 'account' | 'push' | 'sync' | 'library';
const FEATURES: Record<
  Feature,
  { service: string; bindings: { name: string; class_name: string }[] }
> = {
  account: {
    service: 'the account service (/api/account)',
    bindings: [
      { name: 'ACCOUNT_LINKS', class_name: 'AccountLink' },
      { name: 'ACCOUNT_PASSKEYS', class_name: 'AccountPasskey' },
      { name: 'ACCOUNT_STATUS', class_name: 'AccountStatus' },
    ],
  },
  push: {
    service: 'notifications (/api/push)',
    bindings: [
      { name: 'PUSH_DEVICES', class_name: 'PushDevice' },
      { name: 'PUSH_KEYS', class_name: 'PushKeys' },
    ],
  },
  sync: {
    service: 'sync (/api/sync)',
    bindings: [{ name: 'SYNC_COPIES', class_name: 'SyncCopy' }],
  },
  library: {
    service: 'an online library (/api/library)',
    bindings: [
      { name: 'LIBRARIES', class_name: 'Library' },
      { name: 'LIBRARY_GATE', class_name: 'LibraryGate' },
    ],
  },
};

/**
 * Each site's Durable Object migrations, as merging deployed them. Cloudflare
 * refuses a deploy whose applied migrations were renamed, changed or
 * reordered, and only main deploys, so nothing else would notice (audit
 * J-4). Never change these: a new migration goes at the end, in the site's
 * wrangler.jsonc and here.
 */
const APPLIED_MIGRATIONS: Record<string, { tag: string; new_sqlite_classes: string[] }[]> = {
  budget: [
    { tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] },
    { tag: 'push-v1', new_sqlite_classes: ['PushDevice', 'PushKeys'] },
  ],
  calendar: [
    { tag: 'push-v1', new_sqlite_classes: ['PushDevice', 'PushKeys'] },
    { tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] },
  ],
  grammar: [{ tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] }],
  habits: [
    { tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] },
    { tag: 'push-v1', new_sqlite_classes: ['PushDevice', 'PushKeys'] },
  ],
  hub: [
    { tag: 'account-v1', new_sqlite_classes: ['AccountLink', 'AccountPasskey'] },
    { tag: 'account-v2', new_sqlite_classes: ['AccountStatus'] },
  ],
  meals: [
    { tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] },
    { tag: 'push-v1', new_sqlite_classes: ['PushDevice', 'PushKeys'] },
  ],
  notes: [{ tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] }],
  photos: [
    { tag: 'v1', new_sqlite_classes: ['SyncCopy', 'Library'] },
    { tag: 'v2', new_sqlite_classes: ['LibraryGate'] },
  ],
  reminders: [
    { tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] },
    { tag: 'push-v1', new_sqlite_classes: ['PushDevice', 'PushKeys'] },
  ],
  repairs: [{ tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] }],
  shelf: [{ tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] }],
  tally: [{ tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] }],
  tasks: [
    { tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] },
    { tag: 'push-v1', new_sqlite_classes: ['PushDevice', 'PushKeys'] },
  ],
  trades: [{ tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] }],
  water: [
    { tag: 'sync-v1', new_sqlite_classes: ['SyncCopy'] },
    { tag: 'push-v1', new_sqlite_classes: ['PushDevice', 'PushKeys'] },
  ],
};

function wranglerConfig(slug: string): WranglerConfig {
  return parseJsonc(
    readFileSync(join(repoRoot, 'apps', slug, 'wrangler.jsonc'), 'utf8'),
  ) as WranglerConfig;
}

describe('registry and folders', () => {
  it('has a folder for every registered app', () => {
    for (const app of apps) expect(appFolders, `apps/${app.slug}`).toContain(app.slug);
  });

  it('has a registry entry for every app folder', () => {
    const registered = [HUB_SLUG, ...apps.map((app) => app.slug)];
    for (const folder of appFolders) expect(registered, `apps/${folder}`).toContain(folder);
  });

  it('only uses icons that exist', () => {
    expect(isIconName(hub.icon), hub.icon).toBe(true);
    for (const app of apps) expect(isIconName(app.icon), `${app.slug}: ${app.icon}`).toBe(true);
  });
});

describe('browser tests', () => {
  // The shared fixtures fail a test on console errors, CSP problems and
  // requests to other websites; Playwright's own test and expect don't.
  const specs = [
    ...appFolders.flatMap((slug) => {
      const folder = join(repoRoot, 'apps', slug, 'e2e');
      return existsSync(folder)
        ? readdirSync(folder)
            .filter((file) => file.endsWith('.spec.ts'))
            .map((file) => join('apps', slug, 'e2e', file))
        : [];
    }),
    'templates/app/e2e/app.spec.ts',
  ];

  it.each(specs)('%s takes test and expect from the shared fixtures', (spec) => {
    const source = readFileSync(join(repoRoot, spec), 'utf8');
    expect(source).toMatch(/from '(\.\.\/)+tests\/e2e\/fixtures\.ts'/);
    expect(source).not.toMatch(/import \{[^}]*\b(test|expect)\b[^}]*\} from '@playwright\/test'/);
  });
});

describe.each(appFolders)('apps/%s', (slug) => {
  const domain = slug === HUB_SLUG ? hub.domain : `${slug}.${hub.domain}`;

  it('has the standard files', () => {
    for (const file of ['package.json', 'astro.config.ts', 'wrangler.jsonc', 'tsconfig.json']) {
      expect(existsSync(join(repoRoot, 'apps', slug, file)), file).toBe(true);
    }
  });

  it('uses its slug as the package name and in astro.config.ts', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'apps', slug, 'package.json'), 'utf8'));
    expect(pkg.name).toBe(slug);
    const config = readFileSync(join(repoRoot, 'apps', slug, 'astro.config.ts'), 'utf8');
    expect(config).toContain(`slug: '${slug}'`);
  });

  it(`deploys to ${domain} as Worker "${slug}"`, () => {
    const config = wranglerConfig(slug);
    expect(config.name).toBe(slug);
    expect(config.routes).toEqual([{ pattern: domain, custom_domain: true }]);
    expect(config.assets).toMatchObject({ directory: './dist', not_found_handling: '404-page' });
    // Only at the real address: no *.workers.dev address, no addresses for
    // single versions, and no pull request previews (docs/adr/0019).
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config).not.toHaveProperty('previews');
    // No logs or traces of requests (the privacy page says so).
    expect(config.observability).toEqual({ enabled: false });
  });

  const entry = apps.find((app) => app.slug === slug);
  const features: Feature[] =
    slug === HUB_SLUG
      ? ['account']
      : [
          ...(entry?.pushNotifications ? (['push'] as const) : []),
          ...(entry?.sync ? (['sync'] as const) : []),
          ...(entry?.library ? (['library'] as const) : []),
        ];
  const bindings = features.flatMap((feature) => FEATURES[feature].bindings);

  it(
    features.length > 0
      ? `runs ${features.map((feature) => FEATURES[feature].service).join(' and ')}`
      : 'serves static files only',
    () => {
      const config = wranglerConfig(slug);
      if (features.length === 0) {
        expect(config.main).toBeUndefined();
        expect(config.durable_objects).toBeUndefined();
        return;
      }
      expect(config.main).toBe('src/worker.ts');
      expect(config.assets.run_worker_first).toEqual(['/api/*']);
      expect(config.durable_objects?.bindings).toEqual(bindings);
      const classes = (config.migrations ?? []).flatMap((m) => m.new_sqlite_classes ?? []);
      expect(classes).toEqual(
        expect.arrayContaining(bindings.map((binding) => binding.class_name)),
      );
      expect(
        config.migrations,
        'Never rename, change or reorder a migration: add a new one at the end, in wrangler.jsonc and in APPLIED_MIGRATIONS',
      ).toEqual(APPLIED_MIGRATIONS[slug]);
      // The Worker exports every storage class, and a default handler.
      const worker = readFileSync(join(repoRoot, 'apps', slug, 'src/worker.ts'), 'utf8');
      expect(worker).toMatch(/export default|export \{ default/);
      for (const feature of features) {
        for (const { class_name } of FEATURES[feature].bindings) {
          expect(worker).toMatch(
            new RegExp(
              `export \\{[^}]*\\b${class_name}\\b[^}]*\\} from '@shkriuss/${feature}/worker'`,
            ),
          );
        }
      }
    },
  );

  it(entry?.library ? 'keeps its library’s files in R2' : 'has no R2 bucket', () => {
    const config = wranglerConfig(slug);
    if (!entry?.library) {
      expect(config.r2_buckets).toBeUndefined();
      return;
    }
    expect(config.r2_buckets).toEqual([
      { binding: 'LIBRARY_FILES', bucket_name: `shkriuss-${slug}` },
    ]);
  });
});
