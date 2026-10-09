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
  const ownUrls = new Set(build.files.map((file) => file.url));
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
   * Requests `files` and keeps them in this version's cache (§4): each with its SHA-256 as its
   * integrity, so the browser checks every byte, revalidated with the host and never through a
   * redirect. Throws on the first failure, after the other requests have stopped.
   */
  async function precache(files: readonly PrecacheFile[]): Promise<void> {
    const cache = await scope.caches.open(ownCache);
    const controller = new AbortController();
    const failures: unknown[] = [];
    await Promise.all(
      files.map(async ({ url, sha256 }) => {
        try {
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

  /** Requests again, in the background, the files of this version that its cache lacks (§6.4). */
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
   * The file at `key` from this version's cache, or else, unless it is a file of this version,
   * from the previous version's (§6.3). A file of this version that is missing is repaired, and
   * comes from the network meanwhile (§6.4): the previous version's file under its URL may be
   * another one, as its app shell is.
   */
  async function fromCaches(
    event: FetchEventLike,
    key: string,
    ownFile: boolean,
  ): Promise<Response | undefined> {
    const options = { ignoreVary: true };
    const cached = await scope.caches.match(key, { ...options, cacheName: ownCache });
    if (cached !== undefined) {
      return cached;
    }
    if (ownFile) {
      // Offline, it fails again at the next miss, which tries again.
      event.waitUntil(repair().catch(() => undefined));
      return undefined;
    }
    const { previous } = await readState();
    return previous === undefined
      ? undefined
      : scope.caches.match(key, { ...options, cacheName: versionCache(previous) });
  }

  /** Answers with the file at `key` that a cache keeps, or else from the network. */
  async function respond(event: FetchEventLike, key: string, ownFile: boolean): Promise<Response> {
    let found: Response | undefined;
    try {
      found = await fromCaches(event, key, ownFile);
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
      const file = ownUrls.has(url.pathname) ? url.pathname : APP_SHELL_URL;
      event.respondWith(respond(event, `${origin}${file}`, true));
      return;
    }
    // §6.3: a file of this version or the previous one, by its exact URL, or the network.
    url.hash = "";
    event.respondWith(respond(event, url.href, url.search === "" && ownUrls.has(url.pathname)));
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
