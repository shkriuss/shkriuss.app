import { describe, expect, it, vi } from "vitest";
import { ACTIVATE_MESSAGE, type BuildData, versionCache } from "../src/protocol.ts";
import {
  type Answer,
  buildOf,
  type FakeCaches,
  FakeScope,
  FakeWindow,
  HEADERS,
  NETWORK_ERROR,
  NO_ANSWER,
  ORIGIN,
  sha256,
} from "./test/fakes.ts";
import { integrity, removeApp, serveApp } from "./worker.ts";

const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";
const C = "cccccccccccccccc";
const BROKEN = "0123456789abcdef";

/** The files of version A, by URL path. */
const FILES_A = {
  "/": "<!doctype html><title>A</title>",
  "/assets/index-AAAAAAAA.js": "console.info('a');",
  "/assets/lazy-AAAAAAAA.js": "export const lazy = 'a';",
  "/licenses.txt": "licenses",
};

/** The files of version B: a new entry script and shell, the same licenses. */
const FILES_B = {
  "/": "<!doctype html><title>B</title>",
  "/assets/index-BBBBBBBB.js": "console.info('b');",
  "/licenses.txt": "licenses",
};

/** The files of version C: a new shell again. */
const FILES_C = {
  "/": "<!doctype html><title>C</title>",
  "/assets/index-BBBBBBBB.js": "console.info('b');",
  "/licenses.txt": "licenses",
};

const STATE_KEY = "/pwa-state.json";

/**
 * A service worker of a version whose files the host serves, with the files at the URL paths of
 * `firstUse` kept on first use.
 */
async function start(
  files: Record<string, string>,
  version: string,
  {
    replaces = [],
    firstUse = [],
    scope = new FakeScope(),
  }: { replaces?: string[]; firstUse?: string[]; scope?: FakeScope } = {},
): Promise<{ scope: FakeScope; build: BuildData }> {
  const build = await buildOf(files, version, replaces, firstUse);
  for (const [path, content] of Object.entries(files)) {
    scope.host.set(path, content);
  }
  serveApp(scope, build);
  return { scope, build };
}

/** Version A, installed and active; the host serves its files. */
async function activeA(): Promise<FakeScope> {
  const { scope } = await start(FILES_A, A);
  await scope.lifecycle("install");
  await scope.lifecycle("activate");
  scope.requests.length = 0;
  return scope;
}

/** Version B, active after version A, which is now the previous one. */
async function activeBAfterA(): Promise<FakeScope> {
  const scope = await activeA();
  const next = new FakeScope(scope.caches);
  await start(FILES_B, B, { scope: next });
  await next.lifecycle("install");
  await next.lifecycle("activate");
  next.requests.length = 0;
  return next;
}

/** The headers of an answer, by lowercase name. */
function headersOf(response: Response | "network"): Record<string, string> {
  if (response === "network") {
    throw new Error("The service worker let the request go to the network.");
  }
  return Object.fromEntries(response.headers);
}

/** The build's security headers, by lowercase name. */
const BUILD_HEADERS = Object.fromEntries(
  HEADERS.map(([name, value]) => [name.toLowerCase(), value]),
);

async function state(scope: FakeScope): Promise<unknown> {
  const texts = await scope.caches.texts("pwa-state");
  return texts === undefined ? undefined : JSON.parse(texts[STATE_KEY] ?? "null");
}

async function recordState(scope: FakeScope, record: object): Promise<void> {
  await scope.caches.seed("pwa-state", { [STATE_KEY]: JSON.stringify(record) });
}

async function text(response: Response | "network"): Promise<string> {
  if (response === "network") {
    throw new Error("The service worker let the request go to the network.");
  }
  return response.text();
}

describe("integrity", () => {
  it("gives a SHA-256 in hexadecimal as a request's integrity", () => {
    expect(integrity("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(
      "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    );
  });
});

describe("install (§4)", () => {
  it("keeps every file of its version, each requested with its hash, revalidated, without redirects", async () => {
    const { scope, build } = await start(FILES_A, A);
    await scope.lifecycle("install");
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
    expect(scope.requests.map((request) => request.url).toSorted()).toStrictEqual(
      Object.keys(FILES_A)
        .map((path) => `${ORIGIN}${path}`)
        .toSorted(),
    );
    for (const request of scope.requests) {
      const file = build.files.find(({ url }) => `${ORIGIN}${url}` === request.url);
      expect(request.integrity).toBe(integrity(file?.sha256 ?? ""));
      expect(request.cache).toBe("no-cache");
      expect(request.redirect).toBe("error");
    }
    // The first version waits for nothing; the browser activates it.
    expect(scope.skipWaiting).not.toHaveBeenCalled();
    expect(scope.caches.stores.has("pwa-state")).toBe(false);
  });

  it.each<[string, Answer]>([
    ["a file that fails its hash", "console.info('changed on the host');"],
    ["a file that is missing", { status: 404 }],
    ["a part of a file", { status: 206 }],
    ["a redirect", { redirect: "/" }],
    ["a network error", NETWORK_ERROR],
  ])("fails, and deletes its cache, on %s", async (_case, answer) => {
    const { scope } = await start(FILES_A, A);
    scope.host.set("/assets/lazy-AAAAAAAA.js", answer);
    await expect(scope.lifecycle("install")).rejects.toThrow(
      `Version ${A} could not keep its files.`,
    );
    expect(scope.caches.stores.has(versionCache(A))).toBe(false);
  });

  it("stops its other requests at the first failure", async () => {
    const { scope } = await start(FILES_A, A);
    scope.host.set("/", { status: 500 });
    scope.host.set("/assets/lazy-AAAAAAAA.js", NO_ANSWER);
    await expect(scope.lifecycle("install")).rejects.toThrow("could not keep its files");
    const stopped = scope.requests.find((request) => request.url.endsWith("/lazy-AAAAAAAA.js"));
    expect(stopped?.signal.aborted).toBe(true);
  });

  it("keeps the cache of the active version if the browser installs that script again", async () => {
    const scope = await activeA();
    serveApp(scope, await buildOf(FILES_A, A));
    scope.host.set("/licenses.txt", NETWORK_ERROR);
    await expect(scope.lifecycle("install")).rejects.toThrow("could not keep its files");
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
  });

  it("keeps the cache of the previous version if the browser installs its script again", async () => {
    // B is active and A the previous version, whose windows still load its files; the host
    // serves A again.
    const { scope } = await start(FILES_A, A);
    await scope.caches.seed(versionCache(A), FILES_A);
    await recordState(scope, { active: B, previous: A });
    scope.host.set("/licenses.txt", NETWORK_ERROR);
    await expect(scope.lifecycle("install")).rejects.toThrow("could not keep its files");
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
  });

  it("fails, and keeps nothing, when its cache is deleted while it installs", async () => {
    // As by another version that becomes active meanwhile, which deletes the caches it does
    // not know (§5).
    const { scope } = await start(FILES_B, B);
    const fetch = scope.fetch.bind(scope);
    vi.spyOn(scope, "fetch").mockImplementationOnce(async (request) => {
      await scope.caches.delete(versionCache(B));
      return fetch(request);
    });
    await expect(scope.lifecycle("install")).rejects.toThrow(
      `Version ${B} lost its cache while it installed.`,
    );
    expect(scope.caches.stores.has(versionCache(B))).toBe(false);
  });

  it("deletes the cache of a waiting version that it replaces, once it has installed", async () => {
    // A is active and B waits; C installs and takes B's place.
    const scope = await activeA();
    await start(FILES_B, B, { scope });
    await scope.lifecycle("install");
    const next = new FakeScope(scope.caches);
    next.registration.active = { state: "activated" };
    await start(FILES_C, C, { scope: next });
    await next.lifecycle("install");
    expect((await scope.caches.keys()).toSorted()).toStrictEqual(
      [versionCache(A), versionCache(C), "pwa-state"].toSorted(),
    );
  });

  it("deletes no cache while a version becomes active, which may be the one it replaces", async () => {
    const scope = await activeA();
    await start(FILES_B, B, { scope });
    await scope.lifecycle("install");
    const next = new FakeScope(scope.caches);
    next.registration.active = { state: "activating" };
    await start(FILES_C, C, { scope: next });
    await next.lifecycle("install");
    expect((await scope.caches.keys()).toSorted()).toStrictEqual(
      [versionCache(A), versionCache(B), versionCache(C), "pwa-state"].toSorted(),
    );
  });

  it("takes over at once from an active version that it replaces (§8)", async () => {
    const { scope } = await start(FILES_B, B, { replaces: [BROKEN] });
    await recordState(scope, { active: BROKEN });
    await scope.lifecycle("install");
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
  });

  it("waits if the active version is not one that it replaces", async () => {
    const { scope } = await start(FILES_B, B, { replaces: [BROKEN] });
    await recordState(scope, { active: A });
    await scope.lifecycle("install");
    expect(scope.skipWaiting).not.toHaveBeenCalled();
  });

  it("copies the files that the cache of another version keeps with their hashes, and requests only the others", async () => {
    const scope = await activeA();
    // The cache of a version that never became active keeps B's entry script.
    await scope.caches.seed(versionCache(C), {
      "/assets/index-BBBBBBBB.js": FILES_B["/assets/index-BBBBBBBB.js"],
    });
    const next = new FakeScope(scope.caches);
    await start(FILES_B, B, { scope: next });
    await next.lifecycle("install");
    expect(await next.caches.texts(versionCache(B))).toStrictEqual(FILES_B);
    // Only the new app shell came from the host.
    expect(next.requests.map((request) => request.url)).toStrictEqual([`${ORIGIN}/`]);
    // A copy keeps only the Content-Type of its file (§6.5).
    expect(next.caches.headersOf(versionCache(B), "/licenses.txt")).toStrictEqual({
      "content-type": "text/plain",
    });
  });

  it("keeps only the Content-Type of a file that it requested, not the host's other headers", async () => {
    const scope = await activeA();
    expect(scope.caches.headersOf(versionCache(A), "/licenses.txt")).toStrictEqual({
      "content-type": "text/plain",
    });
  });

  it("keeps only the Content-Type of a copy, whatever headers the other cache kept", async () => {
    const scope = await activeA();
    await scope.caches.seed(
      versionCache(C),
      { "/assets/index-BBBBBBBB.js": FILES_B["/assets/index-BBBBBBBB.js"] },
      {
        headers: {
          "Content-Type": "text/javascript",
          "Content-Security-Policy-Report-Only":
            "default-src 'none'; report-uri https://evil.example/",
          "Set-Cookie": "a=1",
        },
      },
    );
    const next = new FakeScope(scope.caches);
    await start(FILES_B, B, { scope: next });
    await next.lifecycle("install");
    expect(next.caches.headersOf(versionCache(B), "/assets/index-BBBBBBBB.js")).toStrictEqual({
      "content-type": "text/javascript",
    });
  });

  it.each<[string, (caches: FakeCaches) => Promise<void>]>([
    [
      "fails its hash",
      async (caches) => caches.seed(versionCache(A), { "/licenses.txt": "licenses, changed" }),
    ],
    [
      "has a status other than 200",
      async (caches) =>
        caches.seed(versionCache(A), { "/licenses.txt": "licenses" }, { status: 203 }),
    ],
    [
      "is in a cache that fails",
      async (caches) => {
        caches.failing.add(versionCache(A));
      },
    ],
  ])("requests a file whose copy %s", async (_case, spoil) => {
    const scope = await activeA();
    await spoil(scope.caches);
    const next = new FakeScope(scope.caches);
    await start(FILES_B, B, { scope: next });
    await next.lifecycle("install");
    expect(await next.caches.texts(versionCache(B))).toStrictEqual(FILES_B);
    expect(next.requests.map((request) => request.url)).toContain(`${ORIGIN}/licenses.txt`);
  });
});

describe("activate (§5)", () => {
  it("records itself as the active version, without a previous one at first", async () => {
    const scope = await activeA();
    expect(await state(scope)).toStrictEqual({ active: A });
    expect(scope.clients.claim).toHaveBeenCalledOnce();
  });

  it("records the version it took over from as the previous one", async () => {
    const scope = await activeA();
    await start(FILES_B, B, { scope });
    await scope.lifecycle("install");
    await scope.lifecycle("activate");
    expect(await state(scope)).toStrictEqual({ active: B, previous: A });
  });

  it("keeps the previous version when it is activated again", async () => {
    const { scope } = await start(FILES_A, A);
    await recordState(scope, { active: A, previous: B });
    await scope.lifecycle("activate");
    expect(await state(scope)).toStrictEqual({ active: A, previous: B });
  });

  it("deletes its other caches, but its own, the previous version's and the state", async () => {
    const { scope } = await start(FILES_B, B);
    await recordState(scope, { active: A, previous: BROKEN });
    for (const name of [versionCache(A), versionCache(B), versionCache(BROKEN), "another-cache"]) {
      await scope.caches.seed(name, { "/": name });
    }
    await scope.lifecycle("activate");
    expect((await scope.caches.keys()).toSorted()).toStrictEqual(
      ["another-cache", versionCache(A), versionCache(B), "pwa-state"].toSorted(),
    );
  });

  it("deletes no cache while a newer version installs, whose cache it cannot tell", async () => {
    const { scope } = await start(FILES_B, B);
    await recordState(scope, { active: A });
    for (const name of [versionCache(A), versionCache(B), versionCache(C)]) {
      await scope.caches.seed(name, { "/": name });
    }
    scope.registration.installing = {};
    await scope.lifecycle("activate");
    expect(await state(scope)).toStrictEqual({ active: B, previous: A });
    expect((await scope.caches.keys()).toSorted()).toStrictEqual(
      [versionCache(A), versionCache(B), versionCache(C), "pwa-state"].toSorted(),
    );
  });

  it.each([
    ["is not JSON", "{"],
    ["is not an object", "null"],
    ["has no version ids", JSON.stringify({ active: "the first", previous: 1 })],
  ])("reads a record that %s as none", async (_case, record) => {
    const { scope } = await start(FILES_A, A);
    await scope.caches.seed("pwa-state", { [STATE_KEY]: record });
    await scope.lifecycle("activate");
    expect(await state(scope)).toStrictEqual({ active: A });
  });

  it("reloads every window when it replaces the active version (§8)", async () => {
    const { scope } = await start(FILES_B, B, { replaces: [BROKEN] });
    await recordState(scope, { active: BROKEN });
    const windows = [new FakeWindow(`${ORIGIN}/`), new FakeWindow(`${ORIGIN}/notes/42`)];
    // A window that has gone cannot be reloaded, and the others still are.
    windows[0]?.navigate.mockRejectedValueOnce(new TypeError("The window has gone."));
    scope.windows.push(...windows);
    await scope.lifecycle("activate");
    expect(scope.clients.matchAll).toHaveBeenCalledWith({ type: "window" });
    for (const window of windows) {
      expect(window.navigate).toHaveBeenCalledWith(window.url);
    }
  });

  it("reloads no window on a normal update", async () => {
    const { scope } = await start(FILES_B, B, { replaces: [BROKEN] });
    await recordState(scope, { active: A });
    const window = new FakeWindow(`${ORIGIN}/`);
    scope.windows.push(window);
    await scope.lifecycle("activate");
    expect(window.navigate).not.toHaveBeenCalled();
  });
});

describe("fetch (§6)", () => {
  it("answers a navigation to a file of its version with that file, offline too", async () => {
    const scope = await activeA();
    scope.host.clear();
    expect(await text(await scope.request("/licenses.txt", { navigate: true }))).toBe("licenses");
    expect(await text(await scope.request("/", { navigate: true }))).toBe(FILES_A["/"]);
    expect(scope.requests).toStrictEqual([]);
  });

  it("answers every other navigation with the app shell, whatever its path and query", async () => {
    const scope = await activeA();
    const urls = ["/notes/42?sort=date", "/index.html", "/assets/", "/licenses.txt/x"];
    const answers: Record<string, string> = {};
    for (const url of urls) {
      answers[url] = await text(await scope.request(url, { navigate: true }));
    }
    expect(answers).toStrictEqual(Object.fromEntries(urls.map((url) => [url, FILES_A["/"]])));
  });

  it.each([["/sw.js"], ["/sha256sums.txt"], ["/.well-known/security.txt"]])(
    "lets a navigation to %s go to the network",
    async (url) => {
      const scope = await activeA();
      expect(await scope.request(url, { navigate: true })).toBe("network");
    },
  );

  it.each([
    ["a POST request", "/", "POST"],
    ["a HEAD request", "/licenses.txt", "HEAD"],
    ["another origin", "https://example.com/assets/index-AAAAAAAA.js", "GET"],
  ])("lets %s go to the network", async (_case, url, method) => {
    const scope = await activeA();
    expect(await scope.request(url, { method })).toBe("network");
  });

  it("answers a request for a file of its version from its cache", async () => {
    const scope = await activeA();
    scope.host.clear();
    expect(await text(await scope.request("/assets/lazy-AAAAAAAA.js"))).toBe(
      FILES_A["/assets/lazy-AAAAAAAA.js"],
    );
    expect(scope.requests).toStrictEqual([]);
  });

  it("answers a request for a file of the previous version from that version's cache (§7.3)", async () => {
    const scope = await activeA();
    // Version B takes over; a window still runs version A and loads its lazy chunk.
    const next = new FakeScope(scope.caches);
    await start(FILES_B, B, { scope: next });
    await next.lifecycle("install");
    await next.lifecycle("activate");
    next.host.clear();
    next.requests.length = 0;
    expect(await text(await next.request("/assets/lazy-AAAAAAAA.js"))).toBe(
      FILES_A["/assets/lazy-AAAAAAAA.js"],
    );
    expect(await text(await next.request("/assets/index-BBBBBBBB.js"))).toBe(
      FILES_B["/assets/index-BBBBBBBB.js"],
    );
    expect(next.requests).toStrictEqual([]);
    // A file of neither version goes to the network.
    next.host.set("/assets/other-CCCCCCCC.js", "other");
    expect(await text(await next.request("/assets/other-CCCCCCCC.js"))).toBe("other");
  });

  it("sends anything else to the network, such as a file's URL with a query", async () => {
    const scope = await activeA();
    expect(await text(await scope.request("/licenses.txt?download"))).toBe("licenses");
    expect(scope.requests.map((request) => request.url)).toStrictEqual([
      `${ORIGIN}/licenses.txt?download`,
    ]);
    await expect(scope.request("/not-a-file.txt")).rejects.toThrow("Failed to fetch");
  });

  it("finds a file by its URL without the fragment", async () => {
    const scope = await activeA();
    scope.host.clear();
    expect(await text(await scope.request("/licenses.txt#top"))).toBe("licenses");
  });

  it("gets a file missing from its cache from the network, and keeps it again (§6.4)", async () => {
    const scope = await activeA();
    scope.caches.stores.get(versionCache(A))?.delete(`${ORIGIN}/assets/lazy-AAAAAAAA.js`);
    expect(await text(await scope.request("/assets/lazy-AAAAAAAA.js"))).toBe(
      FILES_A["/assets/lazy-AAAAAAAA.js"],
    );
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
    // The page's request, then the repair's, which is checked like an install's.
    const [page, repair, ...others] = scope.requests;
    expect(page?.integrity).toBe("");
    expect(repair?.integrity).toBe(integrity(await sha256(FILES_A["/assets/lazy-AAAAAAAA.js"])));
    expect(others).toStrictEqual([]);
  });

  it("repairs the app shell when a navigation misses it", async () => {
    const scope = await activeA();
    scope.caches.stores.get(versionCache(A))?.delete(`${ORIGIN}/`);
    scope.host.set("/notes/42", FILES_A["/"]);
    expect(await text(await scope.request("/notes/42", { navigate: true }))).toBe(FILES_A["/"]);
    expect(scope.requests[0]?.url).toBe(`${ORIGIN}/notes/42`);
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
  });

  it("gets a missing file of its version from the network, though the previous version has one under its URL", async () => {
    // B is active and A the previous version, whose app shell is another file under "/".
    const scope = await activeA();
    const next = new FakeScope(scope.caches);
    await start(FILES_B, B, { scope: next });
    await next.lifecycle("install");
    await next.lifecycle("activate");
    next.caches.stores.get(versionCache(B))?.delete(`${ORIGIN}/`);
    // The host answers any other path with the app shell, as its single-page fallback does.
    next.host.set("/notes/42", FILES_B["/"]);
    expect(await text(await next.request("/notes/42", { navigate: true }))).toBe(FILES_B["/"]);
    expect(await next.caches.texts(versionCache(B))).toStrictEqual(FILES_B);
  });

  it("lets the network answer when Cache Storage fails", async () => {
    const scope = await activeA();
    scope.caches.damaged = true;
    scope.host.set("/notes/42", FILES_A["/"]);
    expect(await text(await scope.request("/notes/42", { navigate: true }))).toBe(FILES_A["/"]);
    expect(await text(await scope.request("/assets/lazy-AAAAAAAA.js"))).toBe(
      FILES_A["/assets/lazy-AAAAAAAA.js"],
    );
  });

  it("repairs once for several misses at a time, and only what is missing", async () => {
    const scope = await activeA();
    scope.caches.stores.delete(versionCache(A));
    await Promise.all([
      scope.request("/assets/index-AAAAAAAA.js"),
      scope.request("/assets/lazy-AAAAAAAA.js"),
    ]);
    const repairs = scope.requests.filter((request) => request.integrity !== "");
    expect(repairs.map((request) => request.url).toSorted()).toStrictEqual(
      Object.keys(FILES_A)
        .map((path) => `${ORIGIN}${path}`)
        .toSorted(),
    );
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
  });

  it("tries a failed repair again at the next miss", async () => {
    const scope = await activeA();
    scope.caches.stores.get(versionCache(A))?.delete(`${ORIGIN}/licenses.txt`);
    scope.host.set("/licenses.txt", { status: 503 });
    const answer = await scope.request("/licenses.txt");
    expect(answer !== "network" && answer.status).toBe(503);
    expect(await scope.caches.texts(versionCache(A))).not.toHaveProperty("/licenses.txt");
    scope.host.set("/licenses.txt", "licenses");
    await scope.request("/licenses.txt");
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
  });

  it("repairs a file from the cache of another version that keeps it with its hash, offline too", async () => {
    const scope = await activeBAfterA();
    scope.caches.stores.get(versionCache(B))?.delete(`${ORIGIN}/licenses.txt`);
    scope.host.clear();
    await expect(scope.request("/licenses.txt")).rejects.toThrow("Failed to fetch");
    await vi.waitFor(async () => {
      expect(await scope.caches.texts(versionCache(B))).toStrictEqual(FILES_B);
    });
  });
});

describe("files kept on first use (§2.1, §4, §6.3)", () => {
  /** Two large files of version A that it keeps on first use, such as WebAssembly modules. */
  const MODULE = "/assets/checker-AAAAAAAA.wasm";
  const DICTIONARY = "/assets/words-AAAAAAAA.dat";
  const WITH_MODULES_A = { ...FILES_A, [MODULE]: "the module", [DICTIONARY]: "the words" };
  /** Version B: the same module, other words. */
  const WITH_MODULES_B = { ...FILES_B, [MODULE]: "the module", [DICTIONARY]: "other words" };
  const FIRST_USE = [MODULE, DICTIONARY];
  const RECORD = "/pwa-first-use.json";

  /** Version A, with its modules, installed and active; the host serves its files. */
  async function activeWithModules(): Promise<FakeScope> {
    const { scope } = await start(WITH_MODULES_A, A, { firstUse: FIRST_USE });
    await scope.lifecycle("install");
    await scope.lifecycle("activate");
    scope.requests.length = 0;
    return scope;
  }

  /** Version B, with its modules, installed after version A in the same Cache Storage. */
  async function installB(scope: FakeScope): Promise<FakeScope> {
    const next = new FakeScope(scope.caches);
    await start(WITH_MODULES_B, B, { firstUse: FIRST_USE, scope: next });
    await next.lifecycle("install");
    return next;
  }

  async function recorded(scope: FakeScope): Promise<boolean> {
    return (await scope.caches.texts("pwa-state"))?.[RECORD] !== undefined;
  }

  it("are not requested at install, with every other file", async () => {
    const { scope } = await start(WITH_MODULES_A, A, { firstUse: FIRST_USE });
    await scope.lifecycle("install");
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
    expect(scope.requests.map((request) => new URL(request.url).pathname).toSorted()).toStrictEqual(
      Object.keys(FILES_A).toSorted(),
    );
  });

  it("are requested at their first use as at install, kept, and answered, and the app's use recorded", async () => {
    const scope = await activeWithModules();
    expect(await recorded(scope)).toBe(false);
    expect(await text(await scope.request(MODULE))).toBe("the module");
    const [request, ...others] = scope.requests;
    expect(others).toStrictEqual([]);
    expect(request?.integrity).toBe(integrity(await sha256("the module")));
    expect(request?.cache).toBe("no-cache");
    expect(request?.redirect).toBe("error");
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual({
      ...FILES_A,
      [MODULE]: "the module",
    });
    expect(await recorded(scope)).toBe(true);

    // From then on, from the cache, offline too, with the build's headers.
    scope.host.clear();
    const again = await scope.request(MODULE);
    expect(await text(again)).toBe("the module");
    expect(headersOf(again)).toMatchObject(BUILD_HEADERS);
    expect(scope.requests).toHaveLength(1);
  });

  it("answers a navigation to one as any request for it", async () => {
    const scope = await activeWithModules();
    expect(await text(await scope.request(MODULE, { navigate: true }))).toBe("the module");
    expect(scope.requests[0]?.integrity).toBe(integrity(await sha256("the module")));
    expect(await scope.caches.texts(versionCache(A))).toHaveProperty(MODULE, "the module");
  });

  it.each<[string, Answer, string]>([
    ["fails its hash", "a module changed on the host", "the integrity check failed"],
    ["is missing on the host", { status: 404 }, "answered with status 404"],
    ["comes through a redirect", { redirect: "/elsewhere.wasm" }, "redirected"],
    ["cannot be fetched, as offline", NETWORK_ERROR, "Failed to fetch"],
  ])(
    "are neither answered nor kept if one %s: never from the network unchecked",
    async (_case, answer, failure) => {
      const scope = await activeWithModules();
      scope.host.set(MODULE, answer);
      await expect(scope.request(MODULE)).rejects.toThrow(failure);
      // One request, checked: no other went to the network for it.
      expect(scope.requests).toHaveLength(1);
      expect(scope.requests[0]?.integrity).toBe(integrity(await sha256("the module")));
      expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
      expect(await recorded(scope)).toBe(false);
    },
  );

  it("come from the host, checked, when Cache Storage fails", async () => {
    const scope = await activeWithModules();
    scope.caches.damaged = true;
    expect(await text(await scope.request(MODULE))).toBe("the module");
    expect(scope.requests[0]?.integrity).toBe(integrity(await sha256("the module")));
  });

  it("are requested again, checked, if a page changed the kept one in Cache Storage", async () => {
    const scope = await activeWithModules();
    await scope.request(MODULE);
    await scope.caches.seed(versionCache(A), { [MODULE]: "a module that a page changed" });
    expect(await text(await scope.request(MODULE))).toBe("the module");
    expect(scope.requests).toHaveLength(2);
    expect(await scope.caches.texts(versionCache(A))).toHaveProperty(MODULE, "the module");
  });

  it("are not kept by a version whose cache is gone, which they would make again", async () => {
    const scope = await activeWithModules();
    await scope.caches.delete(versionCache(A));
    expect(await text(await scope.request(MODULE))).toBe("the module");
    expect(await scope.caches.keys()).not.toContain(versionCache(A));
  });

  it("are kept at install once the app has used one: copied if unchanged, else requested", async () => {
    const scope = await activeWithModules();
    await scope.request(MODULE);
    const next = await installB(scope);
    expect(await next.caches.texts(versionCache(B))).toStrictEqual(WITH_MODULES_B);
    // The new app shell and entry script, and the words that changed; the module was copied.
    expect(next.requests.map((request) => new URL(request.url).pathname).toSorted()).toStrictEqual(
      ["/", "/assets/index-BBBBBBBB.js", DICTIONARY].toSorted(),
    );
  });

  it("are not requested at install while the app has not used one, but copied if another version keeps one", async () => {
    const scope = await activeWithModules();
    // As if a page had put the module there, without the record of a first use.
    await scope.caches.seed(versionCache(A), { [MODULE]: "the module" });
    const next = await installB(scope);
    expect(await next.caches.texts(versionCache(B))).toStrictEqual({
      ...FILES_B,
      [MODULE]: "the module",
    });
    expect(next.requests.map((request) => new URL(request.url).pathname)).not.toContain(DICTIONARY);
  });

  it("are not requested by a repair, which gets the other missing files", async () => {
    const scope = await activeWithModules();
    await scope.request(MODULE);
    scope.requests.length = 0;
    scope.caches.stores.delete(versionCache(A));
    await scope.request("/licenses.txt");
    const repaired = scope.requests.filter((request) => request.integrity !== "");
    expect(repaired.map((request) => new URL(request.url).pathname).toSorted()).toStrictEqual(
      Object.keys(FILES_A).toSorted(),
    );
    // The module comes again at its next use.
    expect(await text(await scope.request(MODULE))).toBe("the module");
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual({
      ...FILES_A,
      [MODULE]: "the module",
    });
  });
});

describe("checks before serving (§6.5)", () => {
  it("answers with the build's security headers, in place of those its cache keeps", async () => {
    const scope = await activeA();
    // The app shell as the build made it, but kept with other headers, as a page could put it.
    await scope.caches.seed(
      versionCache(A),
      { "/": FILES_A["/"] },
      { headers: { "Content-Type": "text/html", "Content-Security-Policy": "script-src *" } },
    );
    const answer = await scope.request("/notes/42", { navigate: true });
    expect(headersOf(answer)).toStrictEqual({ "content-type": "text/html", ...BUILD_HEADERS });
    expect(await text(answer)).toBe(FILES_A["/"]);
  });

  it("answers without the headers of the body's encoding on the network, which is decoded", async () => {
    const scope = await activeA();
    expect(scope.caches.headersOf(versionCache(A), "/licenses.txt")).not.toHaveProperty(
      "content-encoding",
    );
    expect(headersOf(await scope.request("/licenses.txt"))).toStrictEqual({
      "content-type": "text/plain",
      ...BUILD_HEADERS,
    });
  });

  it("answers with no header that its cache keeps but the Content-Type, such as one a page added", async () => {
    const scope = await activeA();
    // The app shell as the build made it, with headers that a script could have put with it: a
    // reporting policy would make every launch report to whoever it names.
    await scope.caches.seed(
      versionCache(A),
      { "/": FILES_A["/"] },
      {
        headers: {
          "Content-Type": "text/html",
          "Content-Security-Policy-Report-Only":
            "default-src 'none'; report-uri https://evil.example/",
          "Reporting-Endpoints": 'evil="https://evil.example/"',
          "Set-Cookie": "a=1",
          "X-Evil": "1",
        },
      },
    );
    const answer = await scope.request("/", { navigate: true });
    expect(headersOf(answer)).toStrictEqual({ "content-type": "text/html", ...BUILD_HEADERS });
    expect(await text(answer)).toBe(FILES_A["/"]);
  });

  it("answers with no Content-Type when its cache keeps none", async () => {
    const scope = await activeA();
    // Bytes, not text: a response made from text gets a Content-Type of its own.
    await (
      await scope.caches.open(versionCache(A))
    ).put(`${ORIGIN}/licenses.txt`, new Response(new TextEncoder().encode("licenses")));
    expect(headersOf(await scope.request("/licenses.txt"))).toStrictEqual(BUILD_HEADERS);
  });

  it("serves no file of its version that a page changed in Cache Storage, and gets it again", async () => {
    const scope = await activeA();
    await scope.caches.seed(versionCache(A), { "/assets/lazy-AAAAAAAA.js": "steal();" });
    expect(await text(await scope.request("/assets/lazy-AAAAAAAA.js"))).toBe(
      FILES_A["/assets/lazy-AAAAAAAA.js"],
    );
    expect(await scope.caches.texts(versionCache(A))).toStrictEqual(FILES_A);
    // The page's request, then the repair's, which is checked like an install's.
    expect(scope.requests.map((request) => request.integrity === "")).toStrictEqual([true, false]);
  });

  it("serves no changed app shell offline either", async () => {
    const scope = await activeA();
    await scope.caches.seed(
      versionCache(A),
      { "/": '<meta http-equiv="refresh" content="0; url=https://example.com/">' },
      { headers: { "Content-Type": "text/html" } },
    );
    scope.host.clear();
    await expect(scope.request("/notes/42", { navigate: true })).rejects.toThrow("Failed to fetch");
    expect(await scope.caches.texts(versionCache(A))).not.toHaveProperty("/");
  });

  it("serves no file of its version that its cache keeps with another status", async () => {
    const scope = await activeA();
    await scope.caches.seed(versionCache(A), { "/licenses.txt": "licenses" }, { status: 203 });
    expect(await text(await scope.request("/licenses.txt"))).toBe("licenses");
    expect(scope.requests[0]?.url).toBe(`${ORIGIN}/licenses.txt`);
    expect(scope.caches.stores.get(versionCache(A))?.get(`${ORIGIN}/licenses.txt`)?.status).toBe(
      200,
    );
  });

  it("serves from its cache only the files of its version, not what a page put under other URLs", async () => {
    const scope = await activeA();
    await scope.caches.seed(versionCache(A), { "/assets/other-CCCCCCCC.js": "planted" });
    scope.host.set("/assets/other-CCCCCCCC.js", "from the host");
    expect(await text(await scope.request("/assets/other-CCCCCCCC.js"))).toBe("from the host");
  });

  it("serves the files of the previous version as they are kept, whose hashes it does not know", async () => {
    const scope = await activeBAfterA();
    await scope.caches.seed(
      versionCache(A),
      { "/assets/lazy-AAAAAAAA.js": "export const lazy = 'a, kept';" },
      { headers: { "Content-Security-Policy": "script-src 'self'" } },
    );
    const answer = await scope.request("/assets/lazy-AAAAAAAA.js");
    expect(headersOf(answer)).toHaveProperty("content-security-policy", "script-src 'self'");
    expect(await text(answer)).toBe("export const lazy = 'a, kept';");
  });
});

describe("messages (§10)", () => {
  it("makes its version active when a window of the app asks", async () => {
    const { scope } = await start(FILES_B, B);
    await scope.message(ACTIVATE_MESSAGE, { type: "window" });
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
  });

  it.each([
    ["another message", { type: "skip-waiting" }, { type: "window" }],
    ["a message with more fields", { type: "activate", now: true }, { type: "window" }],
    ["a message from a worker", ACTIVATE_MESSAGE, { type: "worker" }],
    ["a message from a port", ACTIVATE_MESSAGE, null],
  ])("ignores %s", async (_case, data, source) => {
    const { scope } = await start(FILES_B, B);
    await scope.message(data, source);
    expect(scope.skipWaiting).not.toHaveBeenCalled();
  });
});

describe("removeApp (§9)", () => {
  it("takes over as soon as it has installed", async () => {
    const scope = new FakeScope();
    removeApp(scope);
    await scope.lifecycle("install");
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
  });

  it("deletes every cache of the service worker, unregisters itself, then reloads every window", async () => {
    const scope = new FakeScope();
    for (const name of [versionCache(A), "pwa-state", "another-cache"]) {
      await scope.caches.seed(name, { "/": name });
    }
    const steps: string[] = [];
    scope.registration.unregister.mockImplementation(async () => {
      steps.push(`unregister, with caches [${(await scope.caches.keys()).join()}]`);
      return true;
    });
    const windows = [new FakeWindow(`${ORIGIN}/`), new FakeWindow(`${ORIGIN}/settings`)];
    for (const window of windows) {
      window.navigate.mockImplementationOnce(async (url) => {
        steps.push(`reload ${url}`);
        // A window that has gone cannot be reloaded, and the others still are.
        throw new TypeError("The window has gone.");
      });
    }
    scope.windows.push(...windows);
    removeApp(scope);
    await scope.lifecycle("activate");
    // Only the service worker's caches go: a cache of another name is not its to delete.
    expect(await scope.caches.keys()).toStrictEqual(["another-cache"]);
    // Reloaded once it is unregistered, the windows load the app from the network.
    expect(steps).toStrictEqual([
      "unregister, with caches [another-cache]",
      `reload ${ORIGIN}/`,
      `reload ${ORIGIN}/settings`,
    ]);
  });
});
