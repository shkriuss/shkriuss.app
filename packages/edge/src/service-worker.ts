/**
 * How `edge()` writes an app's service worker, `/sw.js` (docs/specs/service-worker.md).
 *
 * The service worker lists the SHA-256 of every other file of the build, so `edge()` writes it
 * last: once the HTML has its integrity hashes and `licenses.txt` is written, and before it
 * hashes the build for `sha256sums.txt` and writes `_headers`. The script comes from a Vite
 * plugin named `SERVICE_WORKER_PLUGIN`, which offers it as its `api`; `pwa()` of
 * `@shkriuss/pwa/vite` is that plugin.
 */

/** The name of the plugin that builds the service worker. */
export const SERVICE_WORKER_PLUGIN = "shkriuss:pwa";

/** The service worker, bundled. */
export interface ServiceWorkerBundle {
  /** The ids of the modules whose code it includes, for `licenses.txt`. */
  readonly modules: readonly string[];
  /** `/sw.js`, for a build whose other served files have these SHA-256 hashes, by URL path. */
  script(files: ReadonlyMap<string, string>): string;
}

/** What the plugin offers as its `api`. */
export interface ServiceWorkerApi {
  bundle(): Promise<ServiceWorkerBundle>;
}

function isServiceWorkerApi(value: unknown): value is ServiceWorkerApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "bundle" in value &&
    typeof value.bundle === "function"
  );
}

/** The service worker plugin among a build's `plugins`, if it has one. */
export function serviceWorkerApi(
  plugins: readonly { readonly name: string; readonly api?: unknown }[],
): ServiceWorkerApi | undefined {
  const found = plugins.filter((plugin) => plugin.name === SERVICE_WORKER_PLUGIN);
  if (found.length > 1) {
    throw new Error(`The build has ${found.length} ${SERVICE_WORKER_PLUGIN} plugins; keep one.`);
  }
  const [plugin] = found;
  if (plugin === undefined) {
    return undefined;
  }
  if (!isServiceWorkerApi(plugin.api)) {
    throw new Error(`The ${SERVICE_WORKER_PLUGIN} plugin offers no service worker.`);
  }
  return plugin.api;
}
