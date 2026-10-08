/**
 * What the build, the service worker and the page share (docs/specs/service-worker.md): the data
 * that `/sw.js` contains, the names of its caches and the one message it accepts.
 *
 * Nothing here depends on the browser or on Node.js.
 */

/** A file of the precache list (§2.1). */
export interface PrecacheFile {
  /** The URL path that the host serves the file at without a redirect, such as `/`. */
  readonly url: string;
  /** Its SHA-256 in lowercase hexadecimal, as `sha256sums.txt` gives it. */
  readonly sha256: string;
}

/** What a build puts into its `/sw.js` (§2.3). */
export interface BuildData {
  /** The version id (§2.2). */
  readonly version: string;
  /** The precache list, sorted by URL path. */
  readonly files: readonly PrecacheFile[];
  /** The ids of the broken versions that this one replaces at once (§8). */
  readonly replaces: readonly string[];
}

/** The app shell: the URL of `/index.html`, which answers navigations that are not to a file. */
export const APP_SHELL_URL = "/";

/**
 * URLs that the build serves but does not precache; navigations to them go to the network.
 * `security.txt` expires a fixed time after the commit that a build is made from, so it changes
 * with every commit: precached, it would make every commit a new version of the app.
 */
export const NOT_PRECACHED_URLS: readonly string[] = [
  "/sw.js",
  "/sha256sums.txt",
  "/.well-known/security.txt",
];

const VERSION_ID = /^[0-9a-f]{16}$/;

/** Whether `value` is a version id: 16 lowercase hexadecimal digits (§2.2). */
export function isVersionId(value: unknown): value is string {
  return typeof value === "string" && VERSION_ID.test(value);
}

/** The start of the name of every cache of the service worker. */
export const CACHE_PREFIX = "pwa-";

/** The cache in which the service worker records the active and the previous version (§5). */
export const STATE_CACHE = `${CACHE_PREFIX}state`;

/** The cache that keeps the files of a version (§4). */
export function versionCache(version: string): string {
  return `${CACHE_PREFIX}${version}`;
}

/** The message that makes the waiting service worker's version active (§10). */
export interface ActivateMessage {
  readonly type: "activate";
}

export const ACTIVATE_MESSAGE: ActivateMessage = { type: "activate" };

/** Whether `data` is the activate message, and nothing more. */
export function isActivateMessage(data: unknown): data is ActivateMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    Object.keys(data).length === 1 &&
    "type" in data &&
    data.type === ACTIVATE_MESSAGE.type
  );
}
