import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";

// The components of @shkriuss/ui in real browsers, under the production security headers, on
// the components page of src/gallery.tsx. The fixture fails every test on a CSP violation.

async function gallery(page: Page): Promise<void> {
  await page.goto("/ui");
  await expect(page.getByRole("heading", { level: 1, name: "Components" })).toBeVisible();
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`the components have no accessibility violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await gallery(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test("React Aria adds no stylesheet to the page, which the CSP would refuse", async ({ page }) => {
  await gallery(page);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Backup reminders").click();
  await expect(page.getByText("Pressed 1 time.")).toBeVisible();
  await expect(page.locator("style")).toHaveCount(0);
  // Its rule for pressable elements comes with styles.css instead.
  await expect(page.locator("meta#react-aria-pressable-style")).toHaveCount(1);
  // Chromium reports the same value by its short name.
  const touchAction = await page
    .getByRole("button", { name: "Save" })
    .evaluate((button) => getComputedStyle(button).touchAction);
  expect(["pan-x pan-y pinch-zoom", "manipulation"]).toContain(touchAction);
});

test("a button responds to the pointer and the keyboard, and not when it is disabled", async ({
  page,
}) => {
  await gallery(page);
  const save = page.getByRole("button", { name: "Save" });
  await save.click();
  await save.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(page.getByText("Pressed 3 times.")).toBeVisible();
  const unavailable = page.getByRole("button", { name: "Unavailable" });
  await expect(unavailable).toBeDisabled();
  await unavailable.click({ force: true });
  await expect(page.getByText("Pressed 3 times.")).toBeVisible();
});

test("buttons and switches are at least 44 by 44 pixels, so that they are easy to tap", async ({
  page,
}) => {
  await gallery(page);
  const targets = [
    ...(await page.getByRole("button").all()),
    page.locator("label").filter({ has: page.getByRole("switch") }),
  ];
  expect(targets.length).toBeGreaterThan(5);
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test("a text field has its label and its description, and its error when it is invalid", async ({
  page,
}) => {
  await gallery(page);
  const field = page.getByRole("textbox", { name: "Name" });
  await expect(field).toHaveAccessibleDescription("As others should see it.");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Check" }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a name.")).toBeVisible();
  await expect(field).toHaveAccessibleDescription(/Enter a name\./);
  await field.fill("Ada");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Enter a name.")).toBeHidden();
});

test("a switch turns on and off with the pointer and the keyboard", async ({ page }) => {
  await gallery(page);
  const reminders = page.getByRole("switch", { name: "Backup reminders" });
  await expect(reminders).not.toBeChecked();
  await page.getByText("Backup reminders").click();
  await expect(reminders).toBeChecked();
  await expect(page.getByText("Reminders are on.")).toBeVisible();
  await reminders.focus();
  await page.keyboard.press("Space");
  await expect(reminders).not.toBeChecked();
  await expect(page.getByText("Reminders are off.")).toBeVisible();
});

test("a link is underlined and leads to its page", async ({ page }) => {
  await gallery(page);
  const link = page.getByRole("link", { name: "Licenses" });
  await expect(link).toHaveAttribute("href", "/licenses.txt");
  await expect(link).toHaveCSS("text-decoration-line", "underline");
});

test("a dialog takes the focus, keeps the page still, closes with Escape and gives the focus back", async ({
  page,
}) => {
  await gallery(page);
  const html = page.locator("html");
  const open = page.getByRole("button", { name: "Delete everything" });
  await open.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Delete everything?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(html).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(html).not.toHaveCSS("overflow", "hidden");
  await expect(page.getByText("Nothing was deleted.")).toBeVisible();
});

test("a dialog's buttons do their action and close it", async ({ page }) => {
  await gallery(page);
  await page.getByRole("button", { name: "Delete everything" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete everything?" });
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Everything was deleted.")).toBeVisible();
});

test("a banner tells its message to screen readers, with its actions", async ({ page }) => {
  await gallery(page);
  const banner = page.getByRole("status").filter({ hasText: "An update is available." });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Later" })).toBeVisible();
});
