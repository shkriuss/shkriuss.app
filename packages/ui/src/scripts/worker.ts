/**
 * Starts a web worker from one of the site's own build files, for work that
 * would otherwise freeze the page (for example Grammar's checker). Import the
 * worker's URL with Vite's `?worker&url`:
 *
 *   import checkerUrl from './checker.worker.ts?worker&url';
 *   const worker = startWorker(checkerUrl);
 *
 * Our CSP enables Trusted Types, so the script URL must come from a named
 * policy ("shkriuss-worker") that only allows this site's own build files
 * (/_astro/….js).
 */
import { isBuiltWorkerUrl } from '../lib/worker-url.ts';

interface TrustedTypePolicyLike {
  createScriptURL(input: string): unknown;
}
interface TrustedTypesLike {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): TrustedTypePolicyLike;
}

/** Created once: a policy name can only be used once per page. */
let policy: TrustedTypePolicyLike | null | undefined;

function scriptUrl(url: string): string {
  const trustedTypes = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes;
  policy ??= trustedTypes
    ? trustedTypes.createPolicy('shkriuss-worker', {
        createScriptURL: (input) => {
          // The dev server serves workers from their source files.
          if (!import.meta.env.DEV && !isBuiltWorkerUrl(input, location.origin)) {
            throw new TypeError(`Blocked worker URL: ${input}`);
          }
          return input;
        },
      })
    : null;
  return (policy ? policy.createScriptURL(url) : url) as string;
}

export function startWorker(url: string): Worker {
  return new Worker(scriptUrl(url), { type: 'module' });
}
