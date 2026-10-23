/**
 * Whether a live page is exactly the one that was deployed (audit I-3).
 * Cloudflare can rewrite pages on the way out (Rocket Loader, Automatic
 * HTTPS Rewrites, Web Analytics, Zaraz…). The CSP blocks what they add, so
 * an app would quietly stop working while every check in CI passed.
 */

/** A problem with the live page, or undefined when it's the deployed one. */
export function livePageProblem(live: string, deployed: string): string | undefined {
  if (live === deployed) return undefined;
  if (live.includes('/cdn-cgi/')) {
    return 'the live page has Cloudflare’s own code in it (/cdn-cgi/)';
  }
  const inline = /<script(?![^>]*\ssrc=)[^>]*>/i;
  if (inline.test(live) && !inline.test(deployed)) {
    return 'the live page has a script that wasn’t deployed';
  }
  return 'the live page isn’t the one deployed (a Cloudflare feature may be changing pages)';
}
