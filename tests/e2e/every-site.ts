/**
 * Shared browser tests that need something from each app (a change that
 * saves, a list that changes in the background, a page with things on it)
 * keep it in a table with a line for every site: what to do there, or null
 * where the test doesn't apply, with a comment saying why. A site missing
 * from the table fails the test, so a new app is never left out of a shared
 * test without a word, as Photos was from the focus test (audit 3 J-11, G-1).
 */
import { siteSlugs } from '../../scripts/lib/sites.ts';
import { expect, test } from './fixtures.ts';

/** A line for every site: what to do there, or null. */
export type EverySite<T> = Readonly<Record<string, T | null>>;

/** This site's line in `table`: what to do here, or null where the test doesn't apply. */
export function forThisSite<T>(table: EverySite<T>): T | null {
  const name = test.info().project.name;
  const sites = siteSlugs();
  expect(
    Object.keys(table).filter((key) => !sites.includes(key)),
    'Lines for sites that don’t exist (renamed?)',
  ).toEqual([]);
  expect(
    Object.hasOwn(table, name),
    `${name} has no line in this test's table: add what to do there, or null and why not`,
  ).toBe(true);
  return table[name] ?? null;
}
