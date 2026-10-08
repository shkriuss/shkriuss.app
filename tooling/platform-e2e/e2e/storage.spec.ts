import type { Page } from "@playwright/test";
import type { StorageStatus } from "@shkriuss/pwa";
import { expect, test } from "@shkriuss/config/playwright";
import { load, open, write } from "./app.ts";

// The app's storage (architecture §7) in real browsers: what `appStorage()` of @shkriuss/pwa says
// about the app's data, and asking the browser to keep it. Firefox, which asks the user, answers
// yes in these tests, as @shkriuss/config/playwright sets it up.

declare global {
  interface Window {
    /** How often the page asked the browser to keep its data, from `countPersistRequests()`. */
    persistRequests?: number;
  }
}

/** From the next page on, counts the page's calls of `navigator.storage.persist()`. */
async function countPersistRequests(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.persistRequests = 0;
    Object.defineProperty(navigator.storage, "persist", {
      configurable: true,
      value: async () => {
        window.persistRequests = (window.persistRequests ?? 0) + 1;
        return StorageManager.prototype.persist.call(navigator.storage);
      },
    });
  });
}

/** The status after the app read it again. */
async function refreshed(page: Page): Promise<StorageStatus> {
  return page.evaluate(async () => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    await window.platform.storage.refresh();
    return window.platform.storage.getStatus();
  });
}

test("the app knows whether the browser keeps its data, and how much it stores", async ({
  page,
}) => {
  await load(page);
  const status = await refreshed(page);
  expect(["persisted", "best-effort"]).toContain(status.persistence);
  expect(status.usage).toBeGreaterThanOrEqual(0);
  expect(status.quota).toBeGreaterThan(status.usage ?? 0);
});

test("what the app stores shows in its usage", async ({ page }) => {
  await load(page);
  await open(page, 1);
  const before = (await refreshed(page)).usage ?? 0;
  await write(
    page,
    Array.from({ length: 20 }, (_, note) => `Note ${String(note)}: ${"text ".repeat(2000)}`),
  );
  await expect.poll(async () => (await refreshed(page)).usage ?? 0).toBeGreaterThan(before);
});

test("the app asks the browser to keep its data, and shows the answer", async ({
  page,
  browserName,
}) => {
  await load(page);
  const kept = await page.evaluate(async () => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.storage.requestPersistence();
  });
  // Firefox says yes in these tests; Chromium and WebKit decide by themselves.
  if (browserName === "firefox") {
    expect(kept).toBe(true);
  }
  expect((await refreshed(page)).persistence).toBe(kept ? "persisted" : "best-effort");
});

test("asking quietly asks the browser, but not Firefox, which would ask the user", async ({
  page,
  browserName,
}) => {
  await countPersistRequests(page);
  await load(page);
  const persisted = await page.evaluate(async () => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    const before = await navigator.storage.persisted();
    await window.platform.storage.requestPersistenceQuietly();
    return before;
  });
  const requests = await page.evaluate(() => window.persistRequests);
  // A browser that keeps the data already is asked nothing.
  expect(requests).toBe(browserName === "firefox" || persisted ? 0 : 1);
});
