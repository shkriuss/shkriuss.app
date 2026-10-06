import { readFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";
import { config } from "../app.config.ts";
import { m } from "../src/messages.ts";

// The app template in real browsers, as every new app starts: its production build, with its
// real service worker, data layer and backup worker, under the production security headers. The
// fixture fails every test on a CSP violation, an error or a failed request.

/** The app's name and what it does, as its messages say, so these tests need no change. */
const NAME = m.appName();
const DESCRIPTION = m.appDescription();

/** Text as the build writes it into the page: in its head, escaped as HTML. */
function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Opens the app on its list. */
async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
}

async function add(page: Page, text: string): Promise<void> {
  await page.getByRole("textbox", { name: "New item" }).fill(text);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: text })).toBeVisible();
}

/** The backup is made and read in a worker, which takes seconds: the key takes 256 MiB. */
const DERIVING = { timeout: 30_000 };

for (const colorScheme of ["light", "dark"] as const) {
  test(`the app opens on its list, with no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await open(page);
    await expect(page).toHaveTitle(NAME);
    // The page names and describes the app before any script runs, from app.config.ts.
    const html = await (await page.request.get("/")).text();
    expect(html).toContain(`<title>${escaped(NAME)}</title>`);
    expect(html).toContain(`<meta name="description" content="${escaped(DESCRIPTION)}">`);
    await expect(page.getByRole("main")).toContainText("No items yet.");
    await add(page, "Milk");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("items are added, listed, kept and deleted, with the focus where the user is", async ({
  page,
}) => {
  await open(page);
  await add(page, "Milk");
  // Enter adds as well, and the field is empty again for the next.
  const field = page.getByRole("textbox", { name: "New item" });
  await field.fill("  Eggs  ");
  await field.press("Enter");
  await expect(page.getByRole("listitem")).toHaveText(["MilkDelete", "EggsDelete"]);
  await expect(field).toHaveValue("");

  await page.reload();
  const items = page.getByRole("list", { name: "Items" });
  await expect(items.getByRole("listitem")).toHaveText(["MilkDelete", "EggsDelete"]);

  // The focus goes to the next item's button, then to the field once the list is empty.
  await items.getByRole("button", { name: "Delete “Milk”" }).click();
  await expect(items.getByRole("button", { name: "Delete “Eggs”" })).toBeFocused();
  await items.getByRole("button", { name: "Delete “Eggs”" }).click();
  await expect(field).toBeFocused();
  await expect(page.getByRole("main")).toContainText("No items yet.");
});

test("an empty or blank item is refused, with what to do, and one click adds the next", async ({
  page,
}) => {
  await open(page);
  const field = page.getByRole("textbox", { name: "New item" });
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Enter the item.")).toBeVisible();
  await expect(field).toBeFocused();
  await field.fill("   ");
  await field.press("Enter");
  await expect(page.getByText("Enter the item.")).toBeVisible();
  await expect(page.getByRole("main")).toContainText("No items yet.");
  // The error goes as the user types, not when the pointer goes down on "Add", which would
  // move the button from under it.
  await field.fill("Milk");
  await expect(page.getByText("Enter the item.")).toBeHidden();
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Milk" })).toBeVisible();
});

test("the settings have every part that every app has", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page).toHaveTitle(`Settings – ${NAME}`);
  for (const name of ["Install", "Storage", "Backups", `About ${NAME}`]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: `About ${NAME}` })).toContainText(DESCRIPTION);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("an encrypted backup of the items restores them, through the app's own worker", async ({
  page,
}) => {
  await open(page);
  await add(page, "Milk");
  await add(page, "Eggs");
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "Settings" })
    .click();

  await page
    .getByRole("region", { name: "Backups" })
    .getByRole("button", { name: "Back up", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Back up your data" });
  const passphrase = (await dialog.getByText(/^[a-z]+(?:-[a-z]+){5}$/).textContent()) ?? "";
  await dialog.getByRole("button", { name: "Back up", exact: true }).click();
  const ready = page.getByRole("dialog", { name: "Your backup is ready" });
  await expect(ready).toBeVisible(DERIVING);
  const download = page.waitForEvent("download");
  await ready.getByRole("button", { name: "Save backup" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    new RegExp(`^shkriuss-${config.id}-\\d{4}-\\d{2}-\\d{2}\\.age$`, "v"),
  );
  await page
    .getByRole("dialog", { name: "Backed up" })
    .getByRole("button", { name: "Done" })
    .click();

  // Another device, which has none of the items: the database goes, and the app starts again.
  // Deleting the items would not do: their deletions are newer than the backup, which can never
  // bring them back (data model §5).
  await page.evaluate(
    async () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("shkriuss");
        request.addEventListener("success", () => {
          resolve();
        });
        request.addEventListener("error", () => {
          reject(new Error("The test could not delete the database."));
        });
      }),
  );
  await page.goto("/settings");
  await expect(page.getByRole("region", { name: "Backups" })).toContainText("No backup yet.");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Restore from a backup" }).click();
  await (
    await chooser
  ).setFiles({
    name: file.suggestedFilename(),
    mimeType: "application/octet-stream",
    buffer: await readFile(await file.path()),
  });
  const encrypted = page.getByRole("dialog", { name: "This backup is encrypted" });
  await encrypted.getByRole("textbox", { name: "Passphrase" }).fill(passphrase);
  await encrypted.getByRole("button", { name: "Open" }).click();
  const preview = page.getByRole("dialog", { name: "Restore this backup?" });
  await expect(preview).toContainText("Restoring it brings 2 new.", DERIVING);
  await preview.getByRole("button", { name: "Restore", exact: true }).click();
  const restored = page.getByRole("dialog", { name: "Restored" });
  await expect(restored).toContainText("Restored: 2 new.");
  await restored.getByRole("button", { name: "Done" }).click();

  await page.getByRole("banner").getByRole("link", { name: NAME }).click();
  await expect(page.getByRole("list", { name: "Items" }).getByRole("listitem")).toHaveText([
    "MilkDelete",
    "EggsDelete",
  ]);
});

test("the app's service worker controls it and keeps every file of the build, for offline", async ({
  page,
}) => {
  await open(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const missing = await page.evaluate(async () => {
    const sums = await (await fetch("/sha256sums.txt")).text();
    const files = sums
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/)[1] ?? "")
      .filter((file) => file !== "/sw.js");
    const kept = await Promise.all(
      files.map(
        async (file) => (await caches.match(file === "/index.html" ? "/" : file)) !== undefined,
      ),
    );
    return files.filter((_file, index) => kept[index] !== true);
  });
  expect(missing).toStrictEqual([]);
});

test("a newer version of the app in another window closes the data here, and the app says so", async ({
  page,
}) => {
  await open(page);
  // Once the service worker is ready, nothing else changes the update banner.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // What a newer version of the app does when it opens the database: it upgrades it.
  await page.evaluate(
    async () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("shkriuss", 1000);
        request.addEventListener("success", () => {
          request.result.close();
          resolve();
        });
        request.addEventListener("error", () => {
          reject(new Error("The test could not upgrade the database."));
        });
      }),
  );
  const banner = page.getByRole("status");
  await expect(banner).toContainText("The app was updated in another window.");
  const loaded = page.waitForEvent("load");
  await banner.getByRole("button", { name: "Reload" }).click();
  await loaded;
  // This build is older than the database now: it opens nothing, and says why.
  await expect(page.getByRole("heading", { level: 1, name: "This app was updated" })).toBeVisible();
  await expect(page).toHaveTitle(`This app was updated – ${NAME}`);
  await expect(page.getByRole("main")).toContainText("Reload the app to use it.");
});

test("an address that the app does not have says so, in the frame", async ({ page }) => {
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: `Go to ${NAME}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeFocused();
});
