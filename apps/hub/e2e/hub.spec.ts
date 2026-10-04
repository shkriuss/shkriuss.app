import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "./fixtures.ts";

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

test("has no accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: "What to expect" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
