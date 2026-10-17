/**
 * Every site in apps/ that browser tests run against, each on its own local
 * port. New apps are picked up automatically.
 */
import { join } from 'node:path';
import { repoRoot, siteSlugs } from '../../scripts/lib/sites.ts';

export interface TestSite {
  slug: string;
  dir: string;
  port: number;
  baseURL: string;
}

export const sites: TestSite[] = siteSlugs().map((slug, index) => {
  const port = 8787 + index;
  return { slug, dir: join(repoRoot, 'apps', slug), port, baseURL: `http://127.0.0.1:${port}` };
});
