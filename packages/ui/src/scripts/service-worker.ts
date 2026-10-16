/**
 * Registers the offline service worker (/sw.js, generated at build time by
 * @shkriuss/astro-config). Only runs in production builds.
 *
 * Our CSP enables Trusted Types, so the script URL must come from a named
 * policy ("shkriuss-sw") that only ever allows /sw.js.
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

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(scriptUrl as string, { scope: '/' }).catch(() => {
      // Offline support is a bonus; the site works without it.
    });
  });
}
