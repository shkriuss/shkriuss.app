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

/**
 * The storage code apps with an online library get in browser tests
 * (LIBRARY_STORAGE_CODE). Only for tests: the real one is a GitHub secret.
 */
export const TEST_STORAGE_CODE = 'local test storage code';

/**
 * The first site's port; the others follow. Set E2E_PORT_BASE to run beside
 * another checkout's tests (say, a second AI session) without clashing.
 */
function portBase(): number {
  const text = process.env['E2E_PORT_BASE'];
  if (text === undefined || text === '') return 8787;
  const base = Number(text);
  if (!Number.isInteger(base) || base < 1024 || base > 50_000) {
    throw new Error(`E2E_PORT_BASE must be a port from 1024 to 50000, not "${text}".`);
  }
  return base;
}

const base = portBase();

export const sites: TestSite[] = siteSlugs().map((slug, index) => {
  const port = base + index;
  return { slug, dir: join(repoRoot, 'apps', slug), port, baseURL: `http://127.0.0.1:${port}` };
});
