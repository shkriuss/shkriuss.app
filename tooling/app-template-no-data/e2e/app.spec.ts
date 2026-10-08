import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";
import { m } from "../src/messages.ts";

// The app template without data in real browsers, as every new app without data starts: its
// production build, with its real service worker, under the production security headers. The
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

/** Opens the app on its first screen, at `url`. */
async function open(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the app opens on its first screen, with no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await open(page);
    await expect(page).toHaveTitle(NAME);
    // The page names and describes the app before any script runs, from app.config.ts.
    const html = await (await page.request.get("/")).text();
    expect(html).toContain(`<title>${escaped(NAME)}</title>`);
    expect(html).toContain(`<meta name="description" content="${escaped(DESCRIPTION)}">`);
    await page.getByRole("textbox", { name: "Text" }).fill("Hello, world");
    await expect(page.getByRole("main").getByRole("status")).toHaveText("2 words");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("it counts the words as the user types, and keeps nothing", async ({ page }) => {
  await open(page);
  const field = page.getByRole("textbox", { name: "Text" });
  const count = page.getByRole("main").getByRole("status");
  await expect(count).toHaveText("0 words");
  await field.fill("One");
  await expect(count).toHaveText("1 word");
  await field.fill("It's 2 o'clock — isn't it?");
  await expect(count).toHaveText("5 words");

  // Once the service worker keeps the app, what it stores is all there is.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  await expect(field).toHaveValue("");
  await expect(count).toHaveText("0 words");
  const stored = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((database) => database.name),
    local: localStorage.length,
    session: sessionStorage.length,
    caches: await caches.keys(),
  }));
  expect(stored).toStrictEqual({
    databases: [],
    local: 0,
    session: 0,
    // The service worker's own: the files of the app, and its state (docs/specs/service-worker.md).
    caches: expect.arrayContaining([expect.stringMatching(/^pwa-/v)]),
  });
  expect(stored.caches.filter((name) => !name.startsWith("pwa-"))).toStrictEqual([]);
});

test("the settings have installing and About, and neither storage nor backups", async ({
  page,
}) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page).toHaveTitle(`Settings – ${NAME}`);
  await expect(page.getByRole("region")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Install" })).toBeVisible();
  const about = page.getByRole("region", { name: `About ${NAME}` });
  await expect(about).toContainText(DESCRIPTION);
  await expect(about).toContainText(
    "This app keeps none of your data: what you enter stays on this device, until you close the app.",
  );
  await expect(about).not.toContainText("backup");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("on iPhone and iPad, the settings say how to add the app to the Home Screen, with no data to take along", async ({
  page,
}) => {
  // What Safari has on iPhone and iPad, outside the Home Screen.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
  });
  await page.goto("/settings");
  await expect(page.getByRole("region", { name: "Install" }).getByRole("status")).toHaveText(
    "To install this app, open your browser's share menu, then choose Add to Home Screen.",
  );
});

test("says where to report a security problem, at /.well-known/security.txt", async ({
  request,
}) => {
  const response = await request.get("/.well-known/security.txt");
  expect(response.status()).toBe(200);
  // RFC 9116 asks for UTF-8 plain text.
  expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
  expect(await response.text()).toMatch(
    /^Contact: https:\/\/github\.com\/shkriuss\/shkriuss\.app\/security\/advisories\/new$/m,
  );
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
      // security.txt changes with every commit, so it is not kept: it would make each a version.
      .filter((file) => file !== "/sw.js" && file !== "/.well-known/security.txt");
    const kept = await Promise.all(
      files.map(
        async (file) => (await caches.match(file === "/index.html" ? "/" : file)) !== undefined,
      ),
    );
    return files.filter((_file, index) => kept[index] !== true);
  });
  expect(missing).toStrictEqual([]);
});

test("it works offline after the first visit", async ({ page, network }) => {
  await open(page, network.url);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  network.cut();
  await page.reload();
  await page.getByRole("textbox", { name: "Text" }).fill("Still counting, offline.");
  await expect(page.getByRole("main").getByRole("status")).toHaveText("3 words");
  // Every address of the app opens offline, as the service worker answers each navigation.
  await page.goto(`${network.url}settings`);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
});

test("an address that the app does not have says so, in the frame", async ({ page }) => {
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: `Go to ${NAME}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeFocused();
});
