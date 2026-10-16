/**
 * Every site in apps/ that browser tests run against, each on its own local
 * port. New apps are picked up automatically.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface TestSite {
  slug: string;
  dir: string;
  port: number;
  baseURL: string;
}

const repoRoot = join(import.meta.dirname, '../..');
const appsDir = join(repoRoot, 'apps');

const slugs = readdirSync(appsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(appsDir, entry.name, 'wrangler.jsonc')))
  .map((entry) => entry.name)
  // The hub first, then apps alphabetically, so ports stay stable.
  .sort((a, b) => (a === 'hub' ? -1 : b === 'hub' ? 1 : a.localeCompare(b)));

export const sites: TestSite[] = slugs.map((slug, index) => {
  const port = 8787 + index;
  return { slug, dir: join(appsDir, slug), port, baseURL: `http://127.0.0.1:${port}` };
});

export function siteFor(projectName: string): TestSite {
  const site = sites.find((entry) => entry.slug === projectName);
  if (!site) throw new Error(`No site for Playwright project "${projectName}".`);
  return site;
}
