/**
 * The privacy page's "Last updated" date changes with its text (audit 3
 * D-7): people rely on it, and the page promises to change first when what
 * leaves the device does. Next to the date is a fingerprint of the text it
 * was set for, so changing the text without the date fails here, saying
 * what to set. Much of the page comes from the registry (apps.json), so
 * what it shows from there counts too (audit 4 J-4). The fingerprint itself
 * is in lib/privacy-fingerprint.ts, which the app generator uses too.
 */
import { readFileSync } from 'node:fs';
import { apps, byName, getSite, HUB_SLUG } from '@shkriuss/registry';
import { describe, expect, it } from 'vitest';
import {
  DATE_LINE,
  fingerprint as fingerprintOf,
  shownOf,
  withDate,
} from './lib/privacy-fingerprint.ts';

const PAGE = 'apps/hub/src/pages/privacy.astro';
const source = readFileSync(new URL('./pages/privacy.astro', import.meta.url), 'utf8');
const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';

/** What the page shows from the registry, as the page gets it. */
const shown = shownOf([
  getSite(HUB_SLUG),
  ...[...apps].sort(byName).map((app) => getSite(app.slug)),
]);

const fingerprint = (text: string, registry = shown): string => fingerprintOf(text, registry);

describe('the privacy page', () => {
  const [, date = '', saved = ''] = DATE_LINE.exec(source) ?? [];

  it('says when it was last updated', () => {
    expect(date, `${PAGE} needs: const LAST_UPDATED = '<date>'; // text <fingerprint>`).toMatch(
      new RegExp(`^\\d{1,2} (${MONTHS}) 20\\d\\d$`),
    );
  });

  it('changes that date whenever its text changes', () => {
    const now = fingerprint(source);
    expect(
      saved,
      `${PAGE} changed. If what it says changed, set LAST_UPDATED to today's date. Then end that line with "// text ${now}".`,
    ).toBe(now);
  });

  it('shows the day its text went live, if that’s later (audit 6 D-2)', () => {
    // lib/last-updated.ts: the day the pull request was merged, from git.
    expect(source).toContain('const shownDate = lastUpdated(LAST_UPDATED);');
    expect(source).toContain('Last updated: {shownDate}');
  });

  it('notices a changed word, but not a line wrapped differently', () => {
    const now = fingerprint(source);
    expect(fingerprint(source.replace('Short version', 'Short\n      version'))).toBe(now);
    expect(fingerprint(source.replace('Short version', 'Long version'))).not.toBe(now);
  });

  it('notices a change in what it shows from the registry (audit 4 J-4)', () => {
    const now = fingerprint(source);
    const before = JSON.parse(shown) as { pushNotifications: boolean }[];
    const changed = before.map((site, index) =>
      index === 1 ? { ...site, pushNotifications: !site.pushNotifications } : site,
    );
    expect(fingerprint(source, JSON.stringify(changed))).not.toBe(now);
    expect(fingerprint(source, shown.replace('theme', 'colour'))).not.toBe(now);
  });

  it('can be given a new date and fingerprint, as the app generator does', () => {
    const changed = shown.replace('theme', 'colour');
    const dated = withDate(source, '2 November 2026', changed);
    expect(DATE_LINE.exec(dated)?.slice(1)).toEqual([
      '2 November 2026',
      fingerprint(source, changed),
    ]);
    // Only that line changes.
    expect(dated.replace(DATE_LINE, '')).toBe(source.replace(DATE_LINE, ''));
    expect(() => withDate('no date here', '2 November 2026', shown)).toThrow(/LAST_UPDATED/);
  });
});
