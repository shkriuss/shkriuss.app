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

/**
 * The sites to test, from E2E_SITES ("tally,notes"; empty for every site).
 * Starting all 15 servers takes about a minute, so a quick run while working
 * on one app can start only its own (audit J-14). The hub always runs: sync
 * tests need it. CI tests every site.
 */
export function chosenSites(all: readonly string[], text: string | undefined): string[] {
  if (text === undefined || text.trim() === '') return [...all];
  const wanted = new Set(
    text
      .split(',')
      .map((slug) => slug.trim())
      .filter(Boolean),
  );
  const unknown = [...wanted].filter((slug) => !all.includes(slug));
  if (unknown.length > 0) {
    throw new Error(`E2E_SITES: no site called ${unknown.join(', ')}. Sites: ${all.join(', ')}.`);
  }
  return all.filter((slug) => slug === 'hub' || wanted.has(slug));
}

const base = portBase();
const all = siteSlugs();
const chosen = new Set(chosenSites(all, process.env['E2E_SITES']));

// Each site keeps its own port whichever are chosen.
export const sites: TestSite[] = all
  .map((slug, index) => {
    const port = base + index;
    return { slug, dir: join(repoRoot, 'apps', slug), port, baseURL: `http://127.0.0.1:${port}` };
  })
  .filter((site) => chosen.has(site.slug));
