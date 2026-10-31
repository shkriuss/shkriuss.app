/**
 * /robots.txt: what crawlers may read. The sites had none, so Cloudflare
 * served a robots.txt of its own under their names, with terms the owner
 * never wrote (audit 5 I-1). Ours says every page may be read, but not the
 * servers' answers under /api/, which are never pages. The integration
 * writes it into each build, next to security.txt.
 */

/** Where it's served, on every site. */
export const ROBOTS_TXT = 'robots.txt';

export function robotsTxt(): string {
  // "Disallow" first: by the original rules the first line that matches
  // wins (Google takes the most specific one either way).
  return ['User-agent: *', 'Disallow: /api/', 'Allow: /', ''].join('\n');
}
