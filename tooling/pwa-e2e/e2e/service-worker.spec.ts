import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";
import { type Build, builtFile, versionOf } from "../builds.ts";

// The service worker of @shkriuss/pwa in real browsers (docs/specs/service-worker.md §13), with
// the builds of builds.ts at one origin, under the production security headers. The fixture
// fails every test on a CSP or integrity violation, an error, or a failed request of a page.

/** From now on, the browser context gets `build` from the host, or no answer when offline. */
async function serve(context: BrowserContext, build: Build | "offline"): Promise<void> {
  await context.addCookies([{ name: "build", value: build, url: "http://127.0.0.1:4175" }]);
}

/** Waits until the page's script has run and its service worker is in `state`. */
async function stateIs(page: Page, state: string): Promise<void> {
  await page.waitForFunction((expected) => window.pwaTest?.updates.getState() === expected, state);
}

/** Opens the app and waits until a version is active and controls the page. */
async function open(page: Page): Promise<void> {
  await page.goto("/");
  await stateIs(page, "ready");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** The build that the page runs. */
async function buildOf(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.pwaTest?.build);
}

async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => window.pwaTest?.updates.checkForUpdate());
}

async function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await caches.keys()).toSorted());
}

/** Does what reloads the page, and waits until the reloaded page's script has run. */
async function reloadedBy(page: Page, action: () => Promise<unknown>): Promise<void> {
  const loaded = page.waitForEvent("load");
  await action();
  await loaded;
  await page.waitForFunction(() => window.pwaTest !== undefined);
}

test("the app works offline after its first load, from the version it keeps", async ({
  page,
  context,
}) => {
  await serve(context, "a");
  await open(page);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration())?.updateViaCache,
    ),
  ).toBe("none");
  expect(await cacheNames(page)).toStrictEqual([`pwa-${versionOf("a")}`, "pwa-state"]);

  await serve(context, "offline");
  await page.reload();
  expect(await buildOf(page)).toBe("a");
  expect(await page.evaluate(async () => window.pwaTest?.loadLazy())).toBe("lazy of a");
  // Every other path gets the app shell, as from the host.
  await page.goto("/notes/42?sort=date");
  expect(await buildOf(page)).toBe("a");
});

/**
 * For tests that open a text file: the browser shows it with an inline style of its own, which
 * the Content-Security-Policy refuses. Only that refusal is allowed.
 */
function onlyTheTextViewersStyle(security: { readonly violations: readonly string[] }): void {
  expect(
    security.violations.filter((violation) => violation !== "style-src-attr: inline"),
  ).toStrictEqual([]);
}

test("a navigation to a file of the version gets that file, offline too", async ({
  page,
  context,
  security,
}) => {
  security.expectRefusals();
  await serve(context, "a");
  await open(page);
  await serve(context, "offline");
  const response = await page.goto("/licenses.txt");
  expect(response?.status()).toBe(200);
  // The text that the browser shows. The cached response keeps the host's Content-Encoding with
  // its body already decoded, as the Fetch standard has it; Playwright's Firefox decodes such a
  // body again and fails to read it (microsoft/playwright#29261), while Firefox shows it right.
  expect(await page.evaluate(() => document.body.textContent)).toBe(builtFile("a", "licenses.txt"));
  onlyTheTextViewersStyle(security);
});

test("a page from the kept version has the version's Content-Security-Policy", async ({
  page,
  context,
  security,
}) => {
  security.expectRefusals();
  await serve(context, "a");
  await open(page);
  await serve(context, "offline");
  await page.reload();
  await page.waitForFunction(() => window.pwaTest !== undefined);
  // Trusted Types refuse a string as a script's URL, as the page's own headers require.
  await expect(
    page.evaluate(() => {
      document.createElement("script").src = "/sw.js";
    }),
  ).rejects.toThrow();
  await expect
    .poll(() => security.violations.some((v) => v.startsWith("require-trusted-types-for")))
    .toBe(true);
});

test("a new version installs in the background and waits, until the user agrees", async ({
  page,
  context,
}) => {
  await serve(context, "a");
  await open(page);
  await serve(context, "b");
  await checkForUpdate(page);
  await stateIs(page, "update-available");
  expect(await buildOf(page)).toBe("a");

  await reloadedBy(page, async () => page.evaluate(() => window.pwaTest?.updates.applyUpdate()));
  expect(await buildOf(page)).toBe("b");
  await stateIs(page, "ready");
  // The previous version's files stay for windows that still run it.
  expect(await cacheNames(page)).toStrictEqual(
    [`pwa-${versionOf("a")}`, `pwa-${versionOf("b")}`, "pwa-state"].toSorted(),
  );
});

test("a window of the old version keeps loading its files, then reloads into the new one", async ({
  page,
  context,
}) => {
  await serve(context, "a");
  await open(page);
  const other = await context.newPage();
  await open(other);
  await serve(context, "b");
  await checkForUpdate(other);
  await stateIs(other, "update-available");
  await reloadedBy(other, async () => other.evaluate(() => window.pwaTest?.updates.applyUpdate()));
  expect(await buildOf(other)).toBe("b");

  // The first window still runs version a, and is told that the app was updated.
  await stateIs(page, "outdated");
  expect(await buildOf(page)).toBe("a");
  await serve(context, "offline");
  expect(await page.evaluate(async () => window.pwaTest?.loadLazy())).toBe("lazy of a");
  await reloadedBy(page, async () => page.evaluate(() => window.pwaTest?.updates.applyUpdate()));
  expect(await buildOf(page)).toBe("b");
});

test("a version with a file that fails its hash does not install; the old one stays", async ({
  page,
  context,
}) => {
  await serve(context, "a");
  await open(page);
  await serve(context, "broken");
  const failed = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration === undefined) {
      throw new Error("The page has no service worker.");
    }
    const found = new Promise<ServiceWorker | null>((resolve) => {
      registration.addEventListener("updatefound", () => {
        resolve(registration.installing);
      });
    });
    await registration.update();
    const worker = await found;
    await new Promise<void>((resolve) => {
      if (worker === null || worker.state === "redundant") {
        resolve();
      }
      worker?.addEventListener("statechange", () => {
        if (worker.state === "redundant") {
          resolve();
        }
      });
    });
    return { waiting: registration.waiting !== null, state: worker?.state };
  });
  expect(failed).toStrictEqual({ waiting: false, state: "redundant" });
  expect(await cacheNames(page)).toStrictEqual([`pwa-${versionOf("a")}`, "pwa-state"]);
  expect(await page.evaluate(() => window.pwaTest?.updates.getState())).toBe("ready");
  await page.reload();
  expect(await buildOf(page)).toBe("a");

  // Once the host serves a good version, it installs.
  await serve(context, "b");
  await checkForUpdate(page);
  await stateIs(page, "update-available");
});

test("a version that replaces the active one takes over at once and reloads its windows", async ({
  page,
  context,
}) => {
  await serve(context, "a");
  await open(page);
  await serve(context, "fix");
  await reloadedBy(page, async () => checkForUpdate(page));
  expect(await buildOf(page)).toBe("fix");
  await stateIs(page, "ready");
});

test("removing the service worker deletes its caches and unregisters it, and keeps the data", async ({
  page,
  context,
}) => {
  await serve(context, "a");
  await open(page);
  // Data of the app, as @shkriuss/data keeps it in IndexedDB.
  await page.evaluate(async () => {
    const request = indexedDB.open("pwa-e2e", 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore("notes", { keyPath: "id" });
    });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => {
        resolve(request.result);
      });
      request.addEventListener("error", () => {
        reject(request.error ?? new Error("IndexedDB failed."));
      });
    });
    const transaction = database.transaction("notes", "readwrite");
    transaction.objectStore("notes").put({ id: 1, text: "Milk" });
    await new Promise((resolve) => {
      transaction.addEventListener("complete", resolve);
    });
    database.close();
  });

  await serve(context, "removal");
  await reloadedBy(page, async () => checkForUpdate(page));
  expect(await buildOf(page)).toBe("removal");
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  expect(await cacheNames(page)).toStrictEqual([]);
  const notes = await page.evaluate(async () => {
    const request = indexedDB.open("pwa-e2e", 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.addEventListener("success", () => {
        resolve(request.result);
      });
    });
    const read = database.transaction("notes").objectStore("notes").getAll();
    return new Promise<unknown>((resolve) => {
      read.addEventListener("success", () => {
        resolve(read.result);
      });
    });
  });
  expect(notes).toStrictEqual([{ id: 1, text: "Milk" }]);
});

test("a version whose cache was cleared gets its files again, and works offline again", async ({
  page,
  context,
}) => {
  await serve(context, "a");
  await open(page);
  const cache = `pwa-${versionOf("a")}`;
  expect(await page.evaluate(async (name) => caches.delete(name), cache)).toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.pwaTest !== undefined);
  // The navigation went to the network, and the service worker requested its files again.
  await expect
    .poll(async () =>
      page.evaluate(async (name) => (await (await caches.open(name)).keys()).length, cache),
    )
    .toBe(4);
  await serve(context, "offline");
  await page.reload();
  expect(await buildOf(page)).toBe("a");
  expect(await page.evaluate(async () => window.pwaTest?.loadLazy())).toBe("lazy of a");
});

test("/sha256sums.txt and /sw.js always come from the host", async ({
  page,
  context,
  security,
}) => {
  security.expectRefusals();
  await serve(context, "a");
  await open(page);
  // Version a's service worker controls the page, but the host already serves version b.
  await serve(context, "b");
  for (const file of ["sha256sums.txt", "sw.js"]) {
    const response = await page.goto(`/${file}`);
    expect(await response?.text(), file).toBe(builtFile("b", file));
  }
  onlyTheTextViewersStyle(security);
});
