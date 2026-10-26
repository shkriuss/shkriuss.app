// Shelf with a keyboard: where focus goes when the brands or categories are drawn again.
import { expect, test } from '../../../tests/e2e/fixtures.ts';

test('a brand keeps focus after its filter is turned off', async ({ page }) => {
  // Turning it off drew the brands again, and focus went to the top of the page (audit G-5).
  await page.goto('/');
  for (const [name, brand] of [
    ['Olive oil', 'Acme'],
    ['Soap', 'Acme'],
    ['Tea', 'Other'],
  ] as const) {
    await page.getByRole('button', { name: 'Add item' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Brand (optional)').fill(brand);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
  }
  const acme = page.locator('[data-brands]').getByRole('button', { name: /^Acme/ });

  // On: over to the list, which shows only Acme's items.
  await acme.focus();
  await page.keyboard.press('Enter');
  await expect(acme).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-items-heading]')).toBeFocused();

  // Off: focus stays on the brand.
  await acme.focus();
  await page.keyboard.press('Enter');
  await expect(acme).toHaveAttribute('aria-pressed', 'false');
  await expect(acme).toBeFocused();
});

test('the category form gives focus back to its category after the categories were drawn again', async ({
  page,
}) => {
  // Shelf's own close handler sent focus to "Add category" (audit 3 G-3).
  // The item form's case is in tests/e2e/keep-focus.spec.ts.
  await page.goto('/');
  const food = page.locator('[data-categories]').getByRole('button', { name: /^Food and drink/ });
  const other = await page.context().newPage();
  await other.goto('/');
  await page.bringToFront();
  await food.focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog', { name: 'Edit category' });
  await expect(form).toBeVisible();

  // Another tab adds an item to it: the categories are drawn again, with the new count.
  await other.getByRole('button', { name: 'Add item' }).click();
  const itemForm = other.getByRole('dialog');
  await itemForm.getByLabel('Name').fill('Tea');
  await itemForm.getByLabel('Category').selectOption({ label: 'Food and drink' });
  await itemForm.getByRole('button', { name: 'Save' }).click();
  await expect(food).toContainText('1 item');

  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
  await expect(food).toBeFocused();
});
