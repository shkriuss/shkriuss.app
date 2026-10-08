import { describe, expect, it } from "vitest";
import { ACTIVATE_MESSAGE, type BuildData, versionCache } from "../src/protocol.ts";
import {
  type Answer,
  buildOf,
  FakeScope,
  FakeWindow,
  NETWORK_ERROR,
  NO_ANSWER,
  ORIGIN,
  sha256,
} from "./test/fakes.ts";
import { integrity, removeApp, serveApp } from "./worker.ts";

const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";
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

const STATE_KEY = "/pwa-state.json";

/** A service worker of a version whose files the host serves. */
async function start(
  files: Record<string, string>,
  version: string,
  { replaces = [], scope = new FakeScope() }: { replaces?: string[]; scope?: FakeScope } = {},
): Promise<{ scope: FakeScope; build: BuildData }> {
  const build = await buildOf(files, version, replaces);
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

  it("deletes every cache, unregisters itself, then reloads every window", async () => {
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
    expect(await scope.caches.keys()).toStrictEqual([]);
    // Reloaded once it is unregistered, the windows load the app from the network.
    expect(steps).toStrictEqual([
      "unregister, with caches []",
      `reload ${ORIGIN}/`,
      `reload ${ORIGIN}/settings`,
    ]);
  });
});
