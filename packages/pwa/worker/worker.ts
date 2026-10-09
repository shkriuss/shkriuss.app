/**
 * The service worker of every app (docs/specs/service-worker.md).
 *
 * - `serveApp()` keeps a checked copy of every file of its version and answers the app's
 *   requests from it; `sw.ts` starts it with the data of the build.
 * - `removeApp()` deletes the caches and unregisters the service worker; `remove.ts` starts it,
 *   in a build that turns the service worker off (§9).
 *
 * Both take the service worker's global scope as a parameter, so that tests can run them.
 */
import {
  APP_SHELL_URL,
  type BuildData,
  CACHE_PREFIX,
  isActivateMessage,
  isVersionId,
  NOT_PRECACHED_URLS,
  type PrecacheFile,
  STATE_CACHE,
  versionCache,
} from "../src/protocol.ts";

/** An event whose handling the service worker can extend with a promise. */
export interface Extendable {
  waitUntil(promise: Promise<unknown>): void;
}

export interface FetchEventLike extends Extendable {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

export interface MessageEventLike extends Extendable {
  readonly data: unknown;
  readonly source: unknown;
}

export interface WindowClientLike {
  readonly url: string;
  navigate(url: string): Promise<unknown>;
}

export interface CacheLike {
  keys(): Promise<readonly Request[]>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
  match(
    request: string,
    options: { readonly cacheName: string; readonly ignoreVary: boolean },
  ): Promise<Response | undefined>;
}

/** What the service worker uses of its global scope; the browser's `self` has all of it. */
export interface WorkerScope {
  readonly caches: CacheStorageLike;
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options: { type: "window" }): Promise<readonly WindowClientLike[]>;
  };
  readonly location: { readonly origin: string };
  readonly registration: {
    /** The worker of a newer version while it installs. */
    readonly installing: unknown;
    /** The worker of the active version, which may be becoming active. */
    readonly active: { readonly state: string } | null;
    unregister(): Promise<boolean>;
  };
  fetch(request: Request): Promise<Response>;
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: Extendable) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchEventLike) => void): void;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}

/** What `pwa-state` records (§5). */
interface State {
  readonly active?: string;
  readonly previous?: string;
}

/** The key of the record in `pwa-state`; it is never requested. */
const STATE_PATH = "/pwa-state.json";

/** The `integrity` of a request for a file with this SHA-256, given in hexadecimal. */
export function integrity(sha256: string): string {
  let bytes = "";
  for (let index = 0; index < sha256.length; index += 2) {
    bytes += String.fromCharCode(Number.parseInt(sha256.slice(index, index + 2), 16));
  }
  return `sha256-${btoa(bytes)}`;
}

/** The SHA-256 of `bytes` in lowercase hexadecimal, as the precache list gives it. */
async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The body of `response`, if its status is 200 and its bytes have this SHA-256 (§4, §6.5). */
async function checkedBody(response: Response, sha256: string): Promise<ArrayBuffer | undefined> {
  if (response.status !== 200) {
    return undefined;
  }
  const body = await response.arrayBuffer();
  return (await sha256Of(body)) === sha256 ? body : undefined;
}

/**
 * The headers of `response` for a response with its body as read, which is decoded: without
 * those that describe the body's encoding and length on the network.
 */
function decodedHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  return headers;
}

function isWindowClient(source: unknown): boolean {
  return (
    typeof source === "object" && source !== null && "type" in source && source.type === "window"
  );
}

/** Reloads every window of the app (§8, §9), without waiting: the reloads need it active. */
async function reloadWindows(scope: WorkerScope): Promise<void> {
  for (const client of await scope.clients.matchAll({ type: "window" })) {
    // A window that has gone, or that the browser does not let it navigate, stays as it is.
    client.navigate(client.url).catch(() => undefined);
  }
}

/** Starts the service worker of a version of the app, whose data the build gives. */
export function serveApp(scope: WorkerScope, build: BuildData): void {
  const { origin } = scope.location;
  const ownCache = versionCache(build.version);
  // The files of this version by URL path; the app shell is one (§2.1).
  const ownFiles = new Map(build.files.map((file) => [file.url, file]));
  const stateKey = `${origin}${STATE_PATH}`;
  let repairing: Promise<void> | undefined;

  async function readState(): Promise<State> {
    const response = await scope.caches.match(stateKey, {
      cacheName: STATE_CACHE,
      ignoreVary: true,
    });
    if (response === undefined) {
      return {};
    }
    try {
      const value: unknown = await response.json();
      if (typeof value !== "object" || value === null) {
        return {};
      }
      const active: unknown = Reflect.get(value, "active");
      const previous: unknown = Reflect.get(value, "previous");
      return {
        ...(isVersionId(active) && { active }),
        ...(isVersionId(previous) && { previous }),
      };
    } catch {
      return {};
    }
  }

  async function writeState(state: State): Promise<void> {
    const cache = await scope.caches.open(STATE_CACHE);
    const body = JSON.stringify(state);
    await cache.put(
      stateKey,
      new Response(body, { headers: { "Content-Type": "application/json" } }),
    );
  }

  /**
   * Copies the file at `url` into `cache` from the first of the caches named `from` that keeps it
   * with this SHA-256, which it computes from the kept bytes (§4). Resolves to whether one did.
   */
  async function copy(
    cache: CacheLike,
    from: readonly string[],
    { url, sha256 }: PrecacheFile,
  ): Promise<boolean> {
    const key = `${origin}${url}`;
    for (const cacheName of from) {
      let kept: Response | undefined;
      let body: ArrayBuffer | undefined;
      try {
        kept = await scope.caches.match(key, { cacheName, ignoreVary: true });
        body = kept === undefined ? undefined : await checkedBody(kept, sha256);
      } catch {
        // A cache that fails, or that another version deletes meanwhile, has nothing to copy.
      }
      if (kept !== undefined && body !== undefined) {
        const headers = decodedHeaders(kept);
        await cache.put(
          key,
          new Response(body, { status: 200, statusText: kept.statusText, headers }),
        );
        return true;
      }
    }
    return false;
  }

  /**
   * Keeps `files` in this version's cache (§4). Each file that the cache of another version keeps
   * with its SHA-256 is copied; every other one is requested with its SHA-256 as its integrity,
   * so the browser checks every byte, revalidated with the host and never through a redirect.
   * Throws on the first failure, after the other requests have stopped.
   */
  async function precache(files: readonly PrecacheFile[]): Promise<void> {
    const cache = await scope.caches.open(ownCache);
    const others = (await scope.caches.keys()).filter(
      (name) => name.startsWith(CACHE_PREFIX) && name !== STATE_CACHE && name !== ownCache,
    );
    const controller = new AbortController();
    const failures: unknown[] = [];
    await Promise.all(
      files.map(async (file) => {
        const { url, sha256 } = file;
        try {
          if (await copy(cache, others, file)) {
            return;
          }
          const response = await scope.fetch(
            new Request(`${origin}${url}`, {
              integrity: integrity(sha256),
              cache: "no-cache",
              redirect: "error",
              signal: controller.signal,
            }),
          );
          if (response.status !== 200) {
            throw new Error(`${url} answered with status ${response.status}.`);
          }
          await cache.put(`${origin}${url}`, response);
        } catch (error) {
          failures.push(error);
          controller.abort();
        }
      }),
    );
    if (failures.length > 0) {
      throw new Error(`Version ${build.version} could not keep its files.`, {
        cause: failures[0],
      });
    }
  }

  /** Deletes the caches of versions of the app, but those of `versions` and `pwa-state`. */
  async function deleteCachesBut(versions: readonly (string | undefined)[]): Promise<void> {
    const names = new Set([STATE_CACHE]);
    for (const version of versions) {
      if (version !== undefined) {
        names.add(versionCache(version));
      }
    }
    for (const name of await scope.caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && !names.has(name)) {
        await scope.caches.delete(name);
      }
    }
  }

  async function install(): Promise<void> {
    const state = await readState();
    try {
      await precache(build.files);
      // Another version that became active meanwhile deletes the caches it does not know (§5).
      // Without its cache, this one would serve another version's files.
      if (!(await scope.caches.keys()).includes(ownCache)) {
        throw new Error(`Version ${build.version} lost its cache while it installed.`);
      }
    } catch (error) {
      // A version installs complete or not at all. Its cache can be the active one only when
      // the browser installs the active script again, and then it keeps it.
      if (build.version !== state.active && build.version !== state.previous) {
        await scope.caches.delete(ownCache);
      }
      throw error;
    }
    // The waiting version that this one replaces will never become active: its cache goes now,
    // rather than at the next activation (§4). Not while a version becomes active, which may be
    // that one, before it has recorded itself.
    if (scope.registration.active?.state !== "activating") {
      const now = await readState();
      await deleteCachesBut([build.version, now.active, now.previous]);
    }
    if (state.active !== undefined && build.replaces.includes(state.active)) {
      await scope.skipWaiting();
    }
  }

  async function activate(): Promise<void> {
    const state = await readState();
    const previous = state.active === build.version ? state.previous : state.active;
    await writeState(
      previous === undefined ? { active: build.version } : { active: build.version, previous },
    );
    // A newer version that installs meanwhile keeps its files in a cache that this one cannot
    // tell from an old one: the caches then wait until that one has installed (§5).
    if (scope.registration.installing === null) {
      await deleteCachesBut([build.version, previous]);
    }
    await scope.clients.claim();
    if (state.active !== undefined && build.replaces.includes(state.active)) {
      await reloadWindows(scope);
    }
  }

  /** Gets again, in the background, the files of this version that its cache lacks (§6.4). */
  async function repair(): Promise<void> {
    repairing ??= (async () => {
      try {
        const cache = await scope.caches.open(ownCache);
        const kept = new Set((await cache.keys()).map((request) => request.url));
        await precache(build.files.filter(({ url }) => !kept.has(`${origin}${url}`)));
      } finally {
        repairing = undefined;
      }
    })();
    return repairing;
  }

  /**
   * A file of this version from its cache, if it still has its SHA-256 and status 200, with the
   * security headers of the build (§6.5). A file that is missing, or that a page changed in Cache
   * Storage, which then goes, is repaired, and comes from the network meanwhile (§6.4): the
   * previous version's file under its URL may be another one, as its app shell is.
   */
  async function fromOwnCache(
    event: FetchEventLike,
    { url, sha256 }: PrecacheFile,
  ): Promise<Response | undefined> {
    const key = `${origin}${url}`;
    const kept = await scope.caches.match(key, { cacheName: ownCache, ignoreVary: true });
    if (kept !== undefined) {
      const body = await checkedBody(kept, sha256);
      if (body !== undefined) {
        const headers = decodedHeaders(kept);
        for (const [name, value] of build.headers) {
          headers.set(name, value);
        }
        return new Response(body, { status: 200, statusText: kept.statusText, headers });
      }
      // Changed in Cache Storage: it goes, and the repair gets it again.
      await (await scope.caches.open(ownCache)).delete(key);
    }
    // Offline, it fails again at the next miss, which tries again.
    event.waitUntil(repair().catch(() => undefined));
    return undefined;
  }

  /** The response kept under `key` in the previous version's cache, if any (§6.3). */
  async function fromPreviousCache(key: string): Promise<Response | undefined> {
    const { previous } = await readState();
    return previous === undefined
      ? undefined
      : scope.caches.match(key, { cacheName: versionCache(previous), ignoreVary: true });
  }

  /** Answers with what `find` gets from the caches, or else from the network. */
  async function respond(
    event: FetchEventLike,
    find: () => Promise<Response | undefined>,
  ): Promise<Response> {
    let found: Response | undefined;
    try {
      found = await find();
    } catch {
      // Cache Storage failed, as when the browser's storage is damaged: the network answers, as
      // without a service worker (§11).
    }
    return found ?? scope.fetch(event.request);
  }

  scope.addEventListener("install", (event) => {
    event.waitUntil(install());
  });

  scope.addEventListener("activate", (event) => {
    event.waitUntil(activate());
  });

  scope.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    // Only GET requests of the app's origin (§6.1); everything else goes on as without it.
    if (request.method !== "GET" || url.origin !== origin) {
      return;
    }
    if (request.mode === "navigate") {
      // §6.2: a file of the version, or else the app shell; never the files it does not keep.
      if (NOT_PRECACHED_URLS.includes(url.pathname)) {
        return;
      }
      const file = ownFiles.get(url.pathname) ?? ownFiles.get(APP_SHELL_URL);
      if (file !== undefined) {
        event.respondWith(respond(event, async () => fromOwnCache(event, file)));
      }
      return;
    }
    // §6.3: a file of this version by its exact URL, or else one that the previous version keeps
    // under it, or the network.
    url.hash = "";
    const file = url.search === "" ? ownFiles.get(url.pathname) : undefined;
    event.respondWith(
      respond(event, async () =>
        file === undefined ? fromPreviousCache(url.href) : fromOwnCache(event, file),
      ),
    );
  });

  scope.addEventListener("message", (event) => {
    // §10: only the activate message, and only from a window of the app.
    if (isWindowClient(event.source) && isActivateMessage(event.data)) {
      event.waitUntil(scope.skipWaiting());
    }
  });
}

/**
 * Starts the service worker of a build that turns service workers off (§9): it takes over at
 * once, deletes every cache, unregisters itself and reloads every window from the network. It
 * never touches IndexedDB or any other storage.
 */
export function removeApp(scope: WorkerScope): void {
  scope.addEventListener("install", (event) => {
    event.waitUntil(scope.skipWaiting());
  });
  scope.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        for (const name of await scope.caches.keys()) {
          await scope.caches.delete(name);
        }
        await scope.registration.unregister();
        await reloadWindows(scope);
      })(),
    );
  });
}
