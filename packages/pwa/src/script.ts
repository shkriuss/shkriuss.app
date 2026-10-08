import { createHash } from "node:crypto";
import {
  APP_SHELL_URL,
  type BuildData,
  type Header,
  isVersionId,
  NOT_PRECACHED_URLS,
  type PrecacheFile,
} from "./protocol.ts";

/** The identifier in the bundled service worker that the build replaces with its data. */
export const BUILD_DATA_PLACEHOLDER = "SHKRIUSS_PWA_BUILD";

/** The version id that a script has while its own id is computed (§2.2). */
const NO_VERSION = "0".repeat(16);

const SHA256 = /^[0-9a-f]{64}$/;

/** A header name: a token of RFC 9110. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Whether `value` can be a header's value: it has no control characters but tab (RFC 9110). */
function isHeaderValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
      return false;
    }
  }
  return true;
}

/**
 * The URL path that the host serves a file at without a redirect (§2.1). Cloudflare serves
 * `/index.html` at `/`, `/<path>/index.html` at `/<path>/` and `/<name>.html` at `/<name>`, and
 * redirects requests for those files to these URLs.
 */
export function fileUrl(path: string): string {
  if (path.endsWith("/index.html")) {
    return path.slice(0, -"index.html".length);
  }
  if (path.endsWith(".html")) {
    return path.slice(0, -".html".length);
  }
  return path;
}

/**
 * The precache list of a build (§2.1): every file in its manifest, as `sha256sums.txt` lists them
 * by path, but `/sw.js`, by the URL the host serves it at. Throws for a build without the app
 * shell, for two files at one URL, and for a hash that is not a SHA-256.
 */
export function precacheList(manifest: ReadonlyMap<string, string>): PrecacheFile[] {
  const files = new Map<string, string>();
  for (const [path, sha256] of manifest) {
    if (NOT_PRECACHED_URLS.includes(path)) {
      continue;
    }
    if (!SHA256.test(sha256)) {
      throw new Error(`The hash of ${path} is not a SHA-256 in lowercase hexadecimal.`);
    }
    const url = fileUrl(path);
    if (files.has(url)) {
      throw new Error(`The build has two files that are served at ${url}.`);
    }
    files.set(url, sha256);
  }
  if (!files.has(APP_SHELL_URL)) {
    throw new Error("The build has no /index.html, which answers navigations offline.");
  }
  // URLs are unique, so the order is total; code-unit order, as `sort` uses, needs no locale.
  return [...files]
    .toSorted(([a], [b]) => (a < b ? -1 : 1))
    .map(([url, sha256]) => ({ url, sha256 }));
}

export interface ServiceWorkerScript {
  /** `/sw.js`, as the build publishes it. */
  readonly script: string;
  /** The data in it. */
  readonly data: BuildData;
}

/**
 * The `/sw.js` of a build (§2.3): `code`, the bundled service worker, with the build's data in
 * place of its one `BUILD_DATA_PLACEHOLDER`.
 *
 * The version id is the start of the SHA-256 of the script with sixteen zeros as its id (§2.2).
 * So every script that differs by a byte has an id, and a cache, of its own: a change to a file,
 * to the security headers, to the service worker's code, or to the versions it replaces. The
 * browser installs a new service worker exactly when its script changes, so a version that fails
 * to install can never delete the cache of one that is in use.
 */
export function serviceWorkerScript(
  code: string,
  manifest: ReadonlyMap<string, string>,
  headers: readonly Header[],
  replaces: readonly string[] = [],
): ServiceWorkerScript {
  const parts = code.split(BUILD_DATA_PLACEHOLDER);
  if (parts.length !== 2) {
    throw new Error(
      `The service worker must use ${BUILD_DATA_PLACEHOLDER} once, not ${parts.length - 1} times.`,
    );
  }
  for (const version of replaces) {
    if (!isVersionId(version)) {
      throw new Error(`${JSON.stringify(version)} is not a version id: 16 lowercase hex digits.`);
    }
  }
  // The service worker sets them on its responses, which throws for a name or value of neither.
  for (const [name, value] of headers) {
    if (!HEADER_NAME.test(name) || !isHeaderValue(value)) {
      throw new Error(`${JSON.stringify(`${name}: ${value}`)} is not a header.`);
    }
  }
  const files = precacheList(manifest);
  // JSON is valid JavaScript (ES2019), so the data goes in as it is.
  const withVersion = (version: string): string =>
    parts.join(JSON.stringify({ version, files, headers, replaces }));
  const version = createHash("sha256").update(withVersion(NO_VERSION)).digest("hex").slice(0, 16);
  return { script: withVersion(version), data: { version, files, headers, replaces } };
}
