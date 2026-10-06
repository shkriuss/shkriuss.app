import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import type { UpdateState } from "@shkriuss/pwa";
import { expect, test } from "@shkriuss/config/playwright";

// The shell of @shkriuss/shell in real browsers, under the production security headers, on the
// page /shell of src/shell-page.tsx: a screen of notes from the data layer, in the app's frame.
// The fixture fails every test on a CSP violation, an error or a failed request.

/** Opens the shell's page with no notes yet. */
async function open(page: Page): Promise<void> {
  await page.goto("/shell");
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
}

async function setUpdateState(page: Page, state: UpdateState): Promise<void> {
  await page.evaluate((next) => {
    window.platform?.shell.setUpdateState(next);
  }, state);
}

async function write(page: Page, titles: readonly string[]): Promise<void> {
  await page.evaluate(async (all) => {
    await window.platform?.data.write(all);
  }, titles);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the frame and its update banner have no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await open(page);
    await write(page, ["Milk"]);
    await setUpdateState(page, "update-available");
    await expect(page.getByRole("status")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("the frame has the app's name, its sections and the screen as landmarks", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("banner")).toContainText("Notes");
  const sections = page.getByRole("navigation", { name: "Sections" });
  await expect(sections.getByRole("link", { name: "Notes" })).toBeVisible();
  await expect(sections.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("No notes yet.");
});

test("a keyboard user can skip to the screen first", async ({ page, browserName }) => {
  await open(page);
  // WebKit reaches links with Alt+Tab, as Safari does unless the user opts in to Tab.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.keyboard.press(tab);
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  // Without a new entry in the history.
  expect(new URL(page.url()).hash).toBe("");
});

test("the screen follows the notes as they change", async ({ page }) => {
  await open(page);
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await write(page, ["Milk"]);
  await expect(page.getByRole("listitem")).toHaveText(["Milk"]);
  await write(page, ["Eggs"]);
  await expect(page.getByRole("listitem")).toHaveText(["Eggs", "Milk"]);
});

test("the banner offers an update when one is ready, and applies it when the user agrees", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("status")).toHaveCount(0);
  await setUpdateState(page, "update-available");
  const banner = page.getByRole("status");
  await expect(banner).toContainText("A new version of the app is ready.");
  await banner.getByRole("button", { name: "Update" }).click();
  expect(await page.evaluate(() => window.platform?.shell.applied())).toBe(1);
  await setUpdateState(page, "updating");
  await expect(banner).toHaveText("Updating…");
  await expect(banner.getByRole("button")).toHaveCount(0);
});

test("the banner goes away until there is news, when the user says later", async ({ page }) => {
  await open(page);
  await setUpdateState(page, "update-available");
  await page.getByRole("button", { name: "Later" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  // Another window updated the app: that is news.
  await setUpdateState(page, "outdated");
  const banner = page.getByRole("status");
  await expect(banner).toContainText("The app was updated in another window.");
  await banner.getByRole("button", { name: "Reload" }).click();
  expect(await page.evaluate(() => window.platform?.shell.applied())).toBe(1);
});

test("a screen that fails shows what happened in the frame, and reloads the app", async ({
  page,
}) => {
  await open(page);
  await setUpdateState(page, "update-available");
  await page.getByRole("button", { name: "Break this screen" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Your data stays on this device.");
  // The frame stays, with the update banner: a new version may fix it.
  await expect(page.getByRole("banner")).toContainText("Notes");
  await expect(page.getByRole("status")).toContainText("A new version of the app is ready.");
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Reload" }).click();
  await reloaded;
  await expect(page.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
});
