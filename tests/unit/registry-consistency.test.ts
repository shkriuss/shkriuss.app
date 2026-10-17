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
  durable_objects?: { bindings: { name: string; class_name: string }[] };
  migrations?: { tag: string; new_sqlite_classes?: string[] }[];
  previews: { durable_objects?: { bindings: { name: string; class_name: string }[] } };
}

/** The Durable Objects an app with notifications needs (packages/push). */
const PUSH_BINDINGS = [
  { name: 'PUSH_DEVICES', class_name: 'PushDevice' },
  { name: 'PUSH_KEYS', class_name: 'PushKeys' },
];

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
    expect(config.workers_dev).toBe(false);
    expect(config.previews).toBeDefined();
  });

  const push = slug !== HUB_SLUG && apps.find((app) => app.slug === slug)?.pushNotifications;
  it(push ? 'runs the notification service for /api/push' : 'serves static files only', () => {
    const config = wranglerConfig(slug);
    if (!push) {
      expect(config.main).toBeUndefined();
      expect(config.durable_objects).toBeUndefined();
      return;
    }
    expect(config.main).toBe('src/worker.ts');
    expect(config.assets.run_worker_first).toEqual(['/api/*']);
    expect(config.durable_objects?.bindings).toEqual(PUSH_BINDINGS);
    // PR previews need their own storage, or they'd have none.
    expect(config.previews.durable_objects?.bindings).toEqual(PUSH_BINDINGS);
    const classes = (config.migrations ?? []).flatMap((m) => m.new_sqlite_classes ?? []);
    expect(classes).toEqual(expect.arrayContaining(['PushDevice', 'PushKeys']));
    const worker = readFileSync(join(repoRoot, 'apps', slug, 'src/worker.ts'), 'utf8');
    expect(worker).toContain(
      "export { default, PushDevice, PushKeys } from '@shkriuss/push/worker'",
    );
  });
});
