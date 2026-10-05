import type { Page } from "@playwright/test";

// What the end-to-end tests do with the test app's data layer, `window.platform.data`.

/** Opens the test app and waits until its script has run. */
export async function load(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.platform !== undefined);
}

export async function open(page: Page, version: 1 | 2): Promise<string> {
  return page.evaluate(async (as) => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.data.open(as);
  }, version);
}

export async function write(page: Page, texts: readonly string[]): Promise<string[]> {
  return page.evaluate(async (all) => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.data.write(all);
  }, texts);
}

export async function read(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return (await window.platform.data.read()).toSorted();
  });
}

export async function forget(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    await window.platform.data.forget();
  });
}

/** What an import of `n` new records does. */
export function added(n: number): {
  new: number;
  updated: number;
  deleted: number;
  unchanged: number;
} {
  return { new: n, updated: 0, deleted: 0, unchanged: 0 };
}
