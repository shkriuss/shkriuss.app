/**
 * Addresses for connecting an app to the account (docs/adr/0010).
 *
 * - From an app: where its hub is.
 * - On the hub: whether an address really is that app, so an app's key is
 *   only ever sent back to the app itself.
 *
 * The real site, PR previews and local tests use different addresses:
 *
 *   calendar.shkriuss.app                  ↔ shkriuss.app
 *   pr-12-calendar.<account>.workers.dev   ↔ pr-12-hub.<account>.workers.dev
 *   http://127.0.0.1:<port> (tests only)   ↔ given by the app's Worker (HUB_ORIGIN)
 */
import { hub, HUB_SLUG } from '@shkriuss/registry';

const PREVIEW = /^(pr-\d+)-([a-z][a-z0-9-]*)\.([a-z0-9-]+\.workers\.dev)$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The hub's origin for an app at `appUrl`, or null if it can't tell. */
export function hubOriginFor(appUrl: URL, override?: string): string | null {
  if (override) return new URL(override).origin;
  const host = appUrl.hostname;
  if (appUrl.protocol === 'https:' && host.endsWith(`.${hub.domain}`)) {
    return `https://${hub.domain}`;
  }
  const preview = PREVIEW.exec(host);
  if (appUrl.protocol === 'https:' && preview) {
    return `https://${preview[1] ?? ''}-${HUB_SLUG}.${preview[3] ?? ''}`;
  }
  return null;
}

/** True if `from` is the address of app `slug`, as seen by the hub at `hubUrl`. */
export function isAppOrigin(from: string, slug: string, hubUrl: URL): boolean {
  let url: URL;
  try {
    url = new URL(from);
  } catch {
    return false;
  }
  if (url.origin !== from) return false;
  if (hubUrl.protocol === 'https:' && hubUrl.hostname === hub.domain) {
    return from === `https://${slug}.${hub.domain}`;
  }
  const preview = PREVIEW.exec(hubUrl.hostname);
  if (hubUrl.protocol === 'https:' && preview && preview[2] === HUB_SLUG) {
    return from === `https://${preview[1] ?? ''}-${slug}.${preview[3] ?? ''}`;
  }
  // Local tests: everything runs on this computer.
  return LOOPBACK.has(hubUrl.hostname) && LOOPBACK.has(url.hostname) && url.protocol === 'http:';
}
