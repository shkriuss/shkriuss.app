import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@shkriuss/config/playwright";
import { REPORT_URL, SECURITY_URL, SOURCE_URL } from "@shkriuss/shell/site";
import { readCatalog } from "@shkriuss/shell/vite";

// The hub in real browsers (docs/specs/hub.md §5): its production build, under the production
// security headers. The fixture fails every test on a CSP violation, an error or a failed request.

/** Every app, as the hub's build reads them from apps/. */
const APPS = await readCatalog(fileURLToPath(new URL("../..", import.meta.url)));

/** The pages, by their link in the frame and their heading. */
const PAGES = [
  { link: "Install", path: "/install", title: "Install an app" },
  { link: "Privacy", path: "/privacy", title: "Privacy" },
  { link: "Security", path: "/security", title: "Security" },
] as const;

test("the first page says what the apps are, and lists every app with its privacy label", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("shkriuss.app");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "shkriuss.app" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Small, private web apps that work offline.");

  expect(APPS.length).toBeGreaterThan(0);
  const cards = page.getByRole("list", { name: "Apps" }).getByRole("listitem");
  await expect(cards).toHaveCount(APPS.length);
  const host = new URL(page.url()).host;
  for (const [index, app] of APPS.entries()) {
    const card = cards.nth(index);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(app.name);
    // The same build links to each app at the hub's own host: staging's or production's.
    await expect(card.getByRole("link", { name: app.name })).toHaveAttribute(
      "href",
      `https://${app.id}.${host}/`,
    );
    await expect(card).toContainText(app.description);
    const icon = card.locator("img");
    await expect(icon).toHaveAttribute("src", app.icon);
    await expect(icon).toHaveAttribute("alt", "");
    // The browser draws it: the Content-Security-Policy allows data: images.
    expect(
      await icon.evaluate(async (image: HTMLImageElement) => {
        await image.decode();
        return image.naturalWidth > 0;
      }),
    ).toBe(true);
    await expect(card.getByRole("term")).toHaveText([
      "Data collected",
      "Leaves this device",
      "Browser permissions",
    ]);
    await expect(card.getByRole("definition")).toHaveText([
      "None",
      // An app without data has nothing that could leave the device.
      app.keepsData ? "Only the backups that you save" : "Nothing",
      app.allowedFeatures.length === 0 ? "None" : /\S/v,
    ]);
  }
});

test("the frame leads to every page, whose heading then takes the focus", async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Sections" });
  for (const { link, path, title } of PAGES) {
    await navigation.getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeFocused();
    await expect(page).toHaveTitle(`${title} – shkriuss.app`);
    expect(new URL(page.url()).pathname).toBe(path);
  }
  await page.getByRole("banner").getByRole("link", { name: "shkriuss.app" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "shkriuss.app" })).toBeFocused();

  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("free software");
  await expect(footer.getByRole("link", { name: "Source code" })).toHaveAttribute(
    "href",
    SOURCE_URL,
  );
  await expect(footer.getByRole("link", { name: "Licenses" })).toHaveAttribute(
    "href",
    "/licenses.txt",
  );
});

test("the install page explains each kind of device", async ({ page }) => {
  await page.goto("/install");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "On an iPhone or iPad",
    "On Android",
    "On a computer",
  ]);
  await expect(page.getByRole("main")).toContainText("Tap Add to Home Screen, then Add.");
  await expect(page.getByRole("main")).toContainText("keeps its own data, apart from Safari's");
});

test("the privacy page says what stays on the device, and what the host sees", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Your data stays on your device",
    "What our host sees",
    "Backups",
    "Changes",
  ]);
  await expect(page.getByRole("main")).toContainText("Last changed on");
  await expect(page.getByRole("main")).toContainText("your IP address");
  // The apps never keep the passphrase, but the browser's password manager may.
  await expect(page.getByRole("main")).toContainText("its password manager keeps it");
  await expect(page.getByRole("link", { name: "Cloudflare's privacy policy" })).toHaveAttribute(
    "href",
    "https://www.cloudflare.com/privacypolicy/",
  );
  await expect(page.getByRole("link", { name: "The history of this page" })).toHaveAttribute(
    "href",
    `${SOURCE_URL}/commits/main/apps/hub/src/messages.ts`,
  );
});

test("the security page says how to check a site, and how to report a problem", async ({
  page,
}) => {
  await page.goto("/security");
  // The middle section is a lazily loaded chunk.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "How the apps are protected",
    "Check what a site serves",
    "Report a problem",
  ]);
  await expect(page.getByRole("main").locator("pre")).toContainText(
    "gh attestation verify index.html --repo shkriuss/shkriuss.app",
  );
  await expect(page.getByRole("link", { name: "Report a vulnerability" })).toHaveAttribute(
    "href",
    REPORT_URL,
  );
  await expect(page.getByRole("link", { name: "Security policy" })).toHaveAttribute(
    "href",
    SECURITY_URL,
  );
});

test("an address that the hub has no page for says so, in the frame", async ({ page }) => {
  await page.goto("/some/unknown/path");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await expect(page).toHaveTitle("Page not found – shkriuss.app");
  await page.getByRole("link", { name: "Go to the apps" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "shkriuss.app" })).toBeFocused();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`has no accessibility violations in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    for (const path of ["/", ...PAGES.map((each) => each.path), "/some/unknown/path"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (path === "/security") {
        await expect(page.getByRole("heading", { level: 2 })).toHaveCount(3);
      }
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations, path).toEqual([]);
    }
  });
}

test("follows the device's light or dark theme, with the design tokens", async ({ page }) => {
  const body = page.locator("body");
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(body).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(body).toHaveCSS("color", "rgb(17, 24, 39)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(body).toHaveCSS("background-color", "rgb(17, 24, 39)");
  await expect(body).toHaveCSS("color", "rgb(243, 244, 246)");
});

test("outlines the element that has the keyboard focus", async ({ page, browserName }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The first element that takes the focus: the link that skips to the page. WebKit, like
  // Safari, moves to links with Alt+Tab.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toHaveCSS("outline-style", "solid");
  await expect(skip).toHaveCSS("outline-color", "rgb(29, 78, 216)");
});
