/**
 * Registers the offline service worker (/sw.js, generated at build time by
 * @shkriuss/astro-config). Only runs in production builds.
 *
 * Our CSP enables Trusted Types, so the script URL must come from a named
 * policy ("shkriuss-sw") that only ever allows /sw.js.
 *
 * offlineCopySaved() lets a page wait for the first offline copy before
 * downloading something big that the copy includes, so it's downloaded once.
 */
interface TrustedTypePolicyLike {
  createScriptURL(input: string): unknown;
}
interface TrustedTypesLike {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): TrustedTypePolicyLike;
}

const SW_URL = '/sw.js';

/** The registration, once registerServiceWorker() has started it. */
let registration: Promise<ServiceWorkerRegistration | undefined> | undefined;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  const trustedTypes = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes;
  const scriptUrl = trustedTypes
    ? trustedTypes
        .createPolicy('shkriuss-sw', {
          createScriptURL: (input) => {
            if (input !== SW_URL) throw new TypeError(`Blocked service worker URL: ${input}`);
            return input;
          },
        })
        .createScriptURL(SW_URL)
    : SW_URL;

  registration = new Promise((resolve) => {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(scriptUrl as string, { scope: '/' }).then(resolve, () => {
        // Offline support is a bonus; the site works without it.
        resolve(undefined);
      });
    });
  });
}

/**
 * Resolves when this site's files are saved for offline use, or can't be
 * (no service worker, an error). Straight away if an earlier visit saved them.
 *
 * On a first visit, the page and the service worker would otherwise download
 * big files at the same time, and browsers can fail one of two downloads of
 * the same big file at once. Once the copy is saved, the service worker
 * controls the page, so the page's own download comes from the copy.
 */
export async function offlineCopySaved(): Promise<void> {
  if (document.readyState !== 'complete') {
    await new Promise((resolve) => {
      window.addEventListener('load', resolve, { once: true });
    });
  }
  const current = await registration;
  const installing = current?.installing ?? current?.waiting;
  if (!current || current.active || !installing) return;
  await new Promise<void>((resolve) => {
    const settled = () => {
      if (installing.state === 'activated' || installing.state === 'redundant') resolve();
    };
    installing.addEventListener('statechange', settled);
    settled();
  });
}
