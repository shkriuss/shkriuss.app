/**
 * Starts the app's workers and registers its service worker under Trusted Types (ADR 0011).
 *
 * The Content-Security-Policy refuses a plain string as the script of a worker or service
 * worker. This module creates the one Trusted Types policy an app may have, which turns only
 * the app's own worker scripts into TrustedScriptURLs, and it is the only way an app starts
 * them:
 *
 * ```ts
 * import { startWorker } from "@shkriuss/edge/workers";
 * import ageWorker from "./age.worker.ts?worker&url";
 *
 * const worker = startWorker(ageWorker);
 * ```
 *
 * Under `vite dev` there is no Content-Security-Policy, and worker URLs do not look like those
 * of a build, so URLs are passed on unchanged. Production builds leave that code out.
 */
import { SERVICE_WORKER_PATH, WORKER_POLICY, workerScriptUrl } from "../src/worker-scripts.ts";

/**
 * The parts of the Trusted Types API this module uses. TypeScript's DOM types do not describe
 * Trusted Types yet, and they type the script URL of a worker as a string or a URL, so the
 * TrustedScriptURL that the policy returns is typed as the string it stands for.
 */
interface ScriptUrlPolicy {
  createScriptURL(input: string): string;
}

interface PolicyFactory {
  createPolicy(name: string, rules: { createScriptURL(input: string): string }): ScriptUrlPolicy;
}

function isPolicyFactory(value: unknown): value is PolicyFactory {
  return (
    typeof value === "object" &&
    value !== null &&
    "createPolicy" in value &&
    typeof value.createPolicy === "function"
  );
}

let policy: ScriptUrlPolicy | undefined;

/** The URL of one of the app's worker scripts, as the browser accepts it; throws for any other. */
function trustedScriptUrl(input: string): string {
  const trustedTypes: unknown = Reflect.get(globalThis, "trustedTypes");
  if (!isPolicyFactory(trustedTypes)) {
    // A browser without Trusted Types takes strings, which are checked all the same.
    return workerScriptUrl(input, location.href);
  }
  // Created on first use. The Content-Security-Policy allows this name once, so nothing can
  // claim it afterwards, and it allows no policy at all in a build without worker scripts.
  policy ??= trustedTypes.createPolicy(WORKER_POLICY, {
    createScriptURL: (url) => workerScriptUrl(url, location.href),
  });
  return policy.createScriptURL(input);
}

/**
 * Starts a worker from a worker bundle: a module named `<name>.worker.ts`, imported with
 * `?worker&url`. Throws a TypeError for any other URL.
 */
export function startWorker(url: string, options?: WorkerOptions): Worker {
  return new Worker(import.meta.env.DEV ? url : trustedScriptUrl(url), options);
}

/** Registers the app's service worker, `/sw.js`. */
export function registerServiceWorker(
  options?: RegistrationOptions,
): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register(
    import.meta.env.DEV ? SERVICE_WORKER_PATH : trustedScriptUrl(SERVICE_WORKER_PATH),
    options,
  );
}
