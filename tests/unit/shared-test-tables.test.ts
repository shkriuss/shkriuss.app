/**
 * The shared browser tests' tables (tests/e2e/every-site.ts) have a line for
 * every site, and none for a site that's gone. The browser tests check this
 * too, but only after everything is built, and then a removed app's line
 * fails those tests on every site without saying why (audit 6 J-3). Here it
 * fails first, saying what to change.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { siteTables } from '../../scripts/lib/create-app.ts';
import { repoRoot, siteSlugs } from '../../scripts/lib/sites.ts';

const dir = join(repoRoot, 'tests/e2e');
const tables = readdirSync(dir)
  .filter((name) => name.endsWith('.ts'))
  .flatMap((name) =>
    siteTables(readFileSync(join(dir, name), 'utf8')).map((table) => ({
      ...table,
      file: `tests/e2e/${name}`,
    })),
  );
const sites = siteSlugs();

describe('the shared browser tests’ tables', () => {
  it('are found', () => {
    expect(tables.length).toBeGreaterThanOrEqual(6);
  });

  for (const { file, name, sites: lines } of tables) {
    it(`${file} ${name} has a line for every site, and for no other`, () => {
      expect(
        sites.filter((site) => !lines.includes(site)),
        `No line in ${file} (${name}) for these sites: add what to do there, or null and why not`,
      ).toEqual([]);
      expect(
        lines.filter((site) => !sites.includes(site)),
        `Lines in ${file} (${name}) for sites that don’t exist (removed or renamed?): delete them (docs/adding-an-app.md, “Removing an app”)`,
      ).toEqual([]);
      expect(new Set(lines).size, `A site has two lines in ${file} (${name})`).toBe(lines.length);
    });
  }
});
