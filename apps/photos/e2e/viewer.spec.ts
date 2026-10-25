// Photos' viewer with a keyboard and a screen reader.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addPhotos, jpeg, picture } from './helpers.ts';

test('a photo opens with focus on which photo it is', async ({ page }) => {
  // It opened on "Previous", where Enter shows another photo (audit G-14).
  await page.goto('/');
  await addPhotos(page, [
    jpeg('IMG_0001.JPG', await picture(page, { width: 400, height: 300 })),
    jpeg('IMG_0002.JPG', await picture(page, { width: 400, height: 300, color: '#36c' })),
  ]);
  const tiles = page.locator('[data-months] .tile');
  await expect(tiles).toHaveCount(2);
  await tiles.first().focus();
  await page.keyboard.press('Enter');
  const viewer = page.locator('[data-viewer]');
  await expect(viewer.getByRole('heading')).toBeFocused();

  // The arrow keys still move between photos; closing goes back to the one shown.
  await page.keyboard.press('ArrowRight');
  await expect(viewer.locator('[data-detail="kind"]')).toHaveText(/ · 2 of 2$/);
  await page.keyboard.press('Escape');
  await expect(tiles.nth(1)).toBeFocused();
});
