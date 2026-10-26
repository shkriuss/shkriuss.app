/**
 * The privacy page's "Last updated" date changes with its text (audit 3
 * D-7): people rely on it, and the page promises to change first when what
 * leaves the device does. Next to the date is a fingerprint of the text it
 * was set for, so changing the text without the date fails here, saying
 * what to set. Much of the page comes from the registry (apps.json), so
 * what it shows from there counts too (audit 4 J-4).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { apps, byName, getSite, HUB_SLUG } from '@shkriuss/registry';
import { describe, expect, it } from 'vitest';

const PAGE = 'apps/hub/src/pages/privacy.astro';
const source = readFileSync(new URL('./pages/privacy.astro', import.meta.url), 'utf8');
/** const LAST_UPDATED = '26 October 2026'; // text <fingerprint> */
const DATE_LINE = /^const LAST_UPDATED = '([^']*)'; \/\/ text ([0-9a-f]{16})$/m;
const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December';

/**
 * Text without its HTML comments, each from "<!--" to the "-->" that ends it.
 * Cut at the markers rather than with a pattern, which CodeQL takes for an
 * incomplete HTML sanitizer (this text is only hashed, never shown).
 */
const withoutComments = (text: string): string =>
  text
    .split('<!--')
    .map((part, index) => {
      if (index === 0) return part;
      const end = part.indexOf('-->');
      return end === -1 ? '' : part.slice(end + 3);
    })
    .join('');

/** The page's text: without the date line, comments and styles, and however its lines wrap. */
function pageText(text: string): string {
  return withoutComments(
    text
      .replace(DATE_LINE, '')
      .replace(/<style>[\s\S]*?<\/style>/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, ''),
  )
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What the page shows from the registry, in its order: each site's name, what
 * it stores and where, and which send reminders, sync or keep a library online.
 */
const shown = JSON.stringify(
  [getSite(HUB_SLUG), ...[...apps].sort(byName).map((app) => getSite(app.slug))].map(
    ({ slug, name, dataStored, storage, sync, pushNotifications, library }) => ({
      slug,
      name,
      dataStored,
      storage,
      sync,
      pushNotifications,
      library,
    }),
  ),
);

const fingerprint = (text: string, registry = shown): string =>
  createHash('sha256')
    .update(`${pageText(text)}\n${registry}`)
    .digest('hex')
    .slice(0, 16);

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
});
