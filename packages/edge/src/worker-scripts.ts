/**
 * Worker scripts under Trusted Types (ADR 0011).
 *
 * The Content-Security-Policy accepts only a TrustedScriptURL as the script of a worker or
 * service worker. One Trusted Types policy, `WORKER_POLICY`, creates them, and only for the
 * app's own worker scripts:
 *
 * - the worker bundles: Vite builds each module named `<name>.worker.ts` into one file,
 *   `/assets/<name>.worker-<hash>.js`;
 * - the service worker, `/sw.js`.
 *
 * Nothing here depends on the browser or on Node.js: the build uses it to find worker scripts,
 * and `@shkriuss/edge/workers` uses it to check URLs in the browser.
 */

/** The name of the one Trusted Types policy an app may have. */
export const WORKER_POLICY = "shkriuss-workers";

/** The service worker's URL path. It is at the root so that it can control the whole app. */
export const SERVICE_WORKER_PATH = "/sw.js";

/**
 * The start of the line that a worker script logs on its console for each Content-Security-Policy
 * violation inside it, before "<directive>: <blocked URI>". The end-to-end tests' fixture, in
 * `@shkriuss/config/playwright`, counts such a line as a violation.
 */
export const WORKER_VIOLATION = "Content-Security-Policy violation in a worker: ";

/**
 * The code at the start of every worker script: it logs each Content-Security-Policy violation
 * inside the worker on its console. A page's violations come to the page, where the end-to-end
 * tests listen to them; nothing can listen inside a worker before its script runs.
 */
export const REPORT_WORKER_VIOLATIONS = `self.addEventListener("securitypolicyviolation",e=>{console.error(${JSON.stringify(WORKER_VIOLATION)}+e.effectiveDirective+": "+e.blockedURI)});\n`;

/** A worker bundle as Vite names it: a lowercase kebab-case name and an 8-character hash. */
const WORKER_BUNDLE = /^\/assets\/[a-z0-9]+(?:-[a-z0-9]+)*\.worker-[A-Za-z0-9_-]{8}\.js$/;

/** Whether `path` is the URL path of a worker bundle, such as `/assets/age.worker-AbC_12-z.js`. */
export function isWorkerBundlePath(path: string): boolean {
  return WORKER_BUNDLE.test(path);
}

/** Whether `path` is the URL path of a worker bundle or of the service worker. */
export function isWorkerScriptPath(path: string): boolean {
  return path === SERVICE_WORKER_PATH || isWorkerBundlePath(path);
}

/**
 * Resolves `input` against `base`, the page's URL, and returns the absolute URL if it is one of
 * the app's worker scripts. Throws a TypeError for anything else: another origin, a query, a
 * fragment, user credentials, or another path. The policy returns this normalized URL, so the
 * browser loads exactly the script that was checked.
 */
export function workerScriptUrl(input: string, base: string): string {
  const { origin } = new URL(base);
  const url = new URL(input, base);
  // Exactly the page's origin and a path: no other origin, credentials, query or fragment.
  if (url.href !== `${origin}${url.pathname}` || !isWorkerScriptPath(url.pathname)) {
    throw new TypeError(
      `${JSON.stringify(input)} is not one of this app's worker scripts (ADR 0011).`,
    );
  }
  return url.href;
}
