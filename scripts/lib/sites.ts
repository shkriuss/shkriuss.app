import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const repoRoot = join(import.meta.dirname, '../..');

/** Every deployable site: folders in apps/ that have a wrangler.jsonc. Hub first. */
export function siteSlugs(root: string = repoRoot): string[] {
  const appsDir = join(root, 'apps');
  return readdirSync(appsDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && existsSync(join(appsDir, entry.name, 'wrangler.jsonc')),
    )
    .map((entry) => entry.name)
    .sort((a, b) => (a === 'hub' ? -1 : b === 'hub' ? 1 : a.localeCompare(b)));
}
