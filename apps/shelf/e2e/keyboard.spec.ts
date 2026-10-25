// Shelf with a keyboard: where focus goes when the brands are drawn again.
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
