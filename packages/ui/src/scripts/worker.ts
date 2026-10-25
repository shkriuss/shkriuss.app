/**
 * Starts a web worker from one of the site's own build files, for work that
 * would otherwise freeze the page (for example Grammar's checker). Import the
 * worker's URL with Vite's `?worker&url`:
 *
 *   import checkerUrl from './checker.worker.ts?worker&url';
 *   const worker = startWorker(checkerUrl);
 *
 * For a worker that answers each question it's sent (like Photos' and
 * Repairs', which make photos smaller), askWorker() on the page and
 * answerQuestions() in the worker do the messages (lib/ask-worker.ts).
 *
 * Our CSP enables Trusted Types, so the script URL must come from a named
 * policy ("shkriuss-worker") that only allows this site's own build files
 * (/_astro/….js).
 *
 * Inside a worker, allowThreadScripts() lets WebAssembly code use several
 * processor cores (see below).
 */
import { isBuiltWorkerUrl } from '../lib/worker-url.ts';

export { answerQuestions, askWorker } from '../lib/ask-worker.ts';

interface TrustedTypePolicyLike {
  createScriptURL(input: string): unknown;
}
interface TrustedTypesLike {
  createPolicy(
    name: string,
    rules: { createScriptURL: (input: string) => string },
  ): TrustedTypePolicyLike;
}

const trustedTypes = (): TrustedTypesLike | undefined =>
  (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes;

/** Created once: a policy name can only be used once per page. */
let policy: TrustedTypePolicyLike | null | undefined;

function scriptUrl(url: string): string {
  const types = trustedTypes();
  policy ??= types
    ? types.createPolicy('shkriuss-worker', {
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

/**
 * Inside a worker only: lets WebAssembly code start its helper threads from
 * exactly these script URLs (same site), and nothing else.
 *
 * WebAssembly built with Emscripten (e.g. onnxruntime-web, for Grammar's Deep
 * check) runs on several cores by starting workers with
 * `new Worker(new URL(import.meta.url))`. That's a plain URL, which Trusted
 * Types blocks unless the "default" policy allows it. This creates that
 * policy: it allows these URLs as worker scripts and refuses everything else
 * (other URLs, HTML, scripts). Only apps with `webAssembly: true` may create
 * it (their CSP lists it), and it's never created on a page (docs/adr/0012).
 */
export function allowThreadScripts(urls: readonly string[]): void {
  if (typeof document !== 'undefined') throw new Error('allowThreadScripts: only in a worker');
  const allowed = new Set(urls.map((url) => new URL(url, location.origin).href));
  for (const url of allowed) {
    if (new URL(url).origin !== location.origin) throw new Error(`Not this site: ${url}`);
  }
  trustedTypes()?.createPolicy('default', {
    createScriptURL: (input) => {
      if (!allowed.has(input)) throw new TypeError(`Blocked thread script: ${input}`);
      return input;
    },
  });
}
