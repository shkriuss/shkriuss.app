/**
 * The privacy page's fingerprint, kept next to its "Last updated" date
 * (audit 3 D-7): a hash of the page's text and of what it shows from the
 * registry (apps.json, audit 4 J-4). ../privacy.test.ts fails when the
 * fingerprint isn't the text's, so the date can't be left behind. A new
 * app adds a row to the page, so the app generator sets both too
 * (scripts/lib/create-app.ts), or its first pull request would fail.
 */
import { createHash } from 'node:crypto';
import type { SiteInfo } from '@shkriuss/registry';

/** const LAST_UPDATED = '26 October 2026'; // text <fingerprint> */
export const DATE_LINE = /^const LAST_UPDATED = '([^']*)'; \/\/ text ([0-9a-f]{16})$/m;

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
 * What the page shows from the registry, in its order (the hub, then the
 * apps by name): each site's name, what it stores and where, and which send
 * reminders, sync or keep a library online.
 */
export const shownOf = (sites: readonly SiteInfo[]): string =>
  JSON.stringify(
    sites.map(({ slug, name, dataStored, storage, sync, pushNotifications, library }) => ({
      slug,
      name,
      dataStored,
      storage,
      sync,
      pushNotifications,
      library,
    })),
  );

/** The fingerprint of the page's `source` showing `shown` from the registry. */
export const fingerprint = (source: string, shown: string): string =>
  createHash('sha256')
    .update(`${pageText(source)}\n${shown}`)
    .digest('hex')
    .slice(0, 16);

/** `source` with its date line set to `date`, and the fingerprint for showing `shown`. */
export function withDate(source: string, date: string, shown: string): string {
  if (!DATE_LINE.test(source)) throw new Error("Can't find the privacy page's LAST_UPDATED line.");
  return source.replace(
    DATE_LINE,
    `const LAST_UPDATED = '${date}'; // text ${fingerprint(source, shown)}`,
  );
}
