import type { Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";
import { added, forget, load, open, read, write } from "./app.ts";

// The data layer in real browsers (data model §3, §6, §7): records last, the tabs of one app
// share its clock, and a newer version of the app upgrades the database, which older ones then
// refuse to open.

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

async function backup(page: Page): Promise<string> {
  return page.evaluate(async () => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.data.backup();
  });
}

async function restore(page: Page, from: string): Promise<unknown> {
  return page.evaluate(async (json) => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    return window.platform.data.restore(json);
  }, from);
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

test("a backup carries the records to another device, and to a newer version", async ({ page }) => {
  await load(page);
  expect(await open(page, 1)).toBe("open");
  await write(page, ["Milk", "Eggs"]);
  const before = await device(page);
  const copy = await backup(page);

  // Another device: the same app with no data, and a device id of its own.
  await forget(page);
  expect(await open(page, 1)).toBe("open");
  expect(await device(page)).not.toBe(before);
  expect(await restore(page, copy)).toEqual({ preview: added(2), imported: added(2) });
  expect(await read(page)).toEqual(["Eggs", "Milk"]);
  // Importing the same backup again changes nothing.
  expect(await restore(page, copy)).toEqual({
    preview: { new: 0, updated: 0, deleted: 0, unchanged: 2 },
    imported: { new: 0, updated: 0, deleted: 0, unchanged: 2 },
  });

  // A newer version of the app migrates the older backup as it imports it.
  await forget(page);
  expect(await open(page, 2)).toBe("open");
  expect(await restore(page, copy)).toEqual({ preview: added(2), imported: added(2) });
  expect(await read(page)).toEqual(["Eggs", "Milk"]);
});
