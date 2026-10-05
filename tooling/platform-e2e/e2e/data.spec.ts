import type { Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";

// The data layer in real browsers (data model §3, §6, §7): records last, the tabs of one app
// share its clock, and a newer version of the app upgrades the database, which older ones then
// refuse to open.

/** Opens the test app and waits until its script has run. */
async function load(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.platform !== undefined);
}

async function open(page: Page, version: 1 | 2): Promise<string> {
  return page.evaluate(async (as) => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.data.open(as);
  }, version);
}

async function write(page: Page, texts: readonly string[]): Promise<string[]> {
  return page.evaluate(async (all) => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.data.write(all);
  }, texts);
}

async function read(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return (await window.platform.data.read()).toSorted();
  });
}

async function device(page: Page): Promise<string> {
  return page.evaluate(async () => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.data.device();
  });
}

async function versionChanges(page: Page): Promise<number> {
  return page.evaluate(() => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.data.versionChanges();
  });
}

test("records and the device id last across reloads", async ({ page }) => {
  await load(page);
  expect(await open(page, 1)).toBe("open");
  await write(page, ["Milk", "Eggs"]);
  const id = await device(page);
  expect(id).toMatch(/^[0-9a-f]{16}$/);
  await page.reload();
  await page.waitForFunction(() => window.platform !== undefined);
  expect(await open(page, 1)).toBe("open");
  expect(await read(page)).toEqual(["Eggs", "Milk"]);
  expect(await device(page)).toBe(id);
});

test("two tabs of the app never issue the same HLC", async ({ page, context }) => {
  const other = await context.newPage();
  await Promise.all([load(page), load(other)]);
  expect(await Promise.all([open(page, 1), open(other, 1)])).toEqual(["open", "open"]);
  const texts = Array.from({ length: 25 }, (_, index) => `Note ${index}`);
  const [first, second] = await Promise.all([write(page, texts), write(other, texts)]);
  expect(new Set([...first, ...second]).size).toBe(50);
  expect(await read(other)).toHaveLength(50);
});

test("a newer version upgrades the database, which older ones then refuse", async ({
  page,
  context,
}) => {
  await load(page);
  expect(await open(page, 1)).toBe("open");
  await write(page, ["Milk"]);

  const newer = await context.newPage();
  await load(newer);
  expect(await open(newer, 2)).toBe("open");
  expect(await read(newer)).toEqual(["Milk"]);
  // The older tab closed the database, so that the upgrade could go ahead.
  expect(await versionChanges(page)).toBe(1);

  // The older version, loaded again, refuses the newer database and leaves it as it is.
  await page.reload();
  await page.waitForFunction(() => window.platform !== undefined);
  expect(await open(page, 1)).toBe("newer-version");
  await write(newer, ["Eggs"]);
  expect(await read(newer)).toEqual(["Eggs", "Milk"]);
  expect(await versionChanges(newer)).toBe(0);
});
