// Photos with a keyboard: where focus is, and that it can be seen, while
// choosing photos.
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addPhotos, jpeg, picture } from './helpers.ts';

const tiles = (page: Page) => page.locator('[data-months] .tile');

/** How an element's outline is drawn: its style, width, colour and offset. */
const outline = (element: Locator) =>
  element.evaluate((node) => {
    const style = getComputedStyle(node);
    return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} ${style.outlineOffset}`;
  });

/** Adds `count` small photos. */
async function addSome(page: Page, count: number): Promise<void> {
  const colors = ['#c33', '#36c', '#3a6', '#c93', '#93c', '#3cc'];
  const files = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      picture(page, { width: 120, height: 90, color: colors[index % colors.length] }),
    ),
  );
  await addPhotos(
    page,
    files.map((buffer, index) => jpeg(`IMG_${String(index).padStart(4, '0')}.JPG`, buffer)),
  );
  await expect(tiles(page)).toHaveCount(count);
}

test('a chosen photo with keyboard focus shows the focus ring', async ({ page }) => {
  // (audit G-1)
  await page.goto('/');
  await addSome(page, 3);
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeFocused();

  // The ring a focused photo shows before it's chosen.
  await tiles(page).first().focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tiles(page).first()).toBeFocused();
  const ring = await outline(tiles(page).first());

  // Chosen with Space, it keeps that ring; a chosen photo without focus looks different.
  await page.keyboard.press('Space');
  await expect(tiles(page).first()).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(tiles(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  expect(await outline(tiles(page).nth(1))).toBe(ring);
  expect(await outline(tiles(page).first())).not.toBe(ring);

  // In Windows contrast themes too: the focus ring is the theme's own focus colour.
  await page.emulateMedia({ forcedColors: 'active' });
  const done = page.getByRole('button', { name: 'Done' });
  await done.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(done).toBeFocused();
  const forcedRing = await outline(done);
  await tiles(page).nth(1).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(tiles(page).nth(1)).toBeFocused();
  expect(await outline(tiles(page).nth(1))).toBe(forcedRing);
  expect(await outline(tiles(page).first())).not.toBe(forcedRing);
});
