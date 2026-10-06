import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@shkriuss/config/playwright";

test("shows the placeholder page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("shkriuss.app");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "shkriuss.app" })).toBeVisible();
  // This section is a lazily loaded chunk.
  await expect(page.getByRole("heading", { level: 2, name: "What to expect" })).toBeVisible();
});

test("serves the page for any path, like a single-page app", async ({ page }) => {
  await page.goto("/some/unknown/path");
  await expect(page.getByRole("heading", { level: 1, name: "shkriuss.app" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "What to expect" })).toBeVisible();
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`has no accessibility violations in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "What to expect" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
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
  const link = page.getByRole("link", { name: "github.com/shkriuss/shkriuss.app" });
  await expect(link).toBeVisible();
  // The first element that takes the focus. WebKit, like Safari, moves to links with Alt+Tab.
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(link).toBeFocused();
  await expect(link).toHaveCSS("outline-style", "solid");
  await expect(link).toHaveCSS("outline-color", "rgb(29, 78, 216)");
});
