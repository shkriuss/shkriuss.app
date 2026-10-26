// Repairs' photo viewer with a keyboard and a screen reader.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  addPhotos,
  fillRepair,
  jpeg,
  NOW,
  picture,
  repairDialog,
  repairItems,
  TIME_ZONE,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('a photo opens with focus on which photo it is', async ({ page }) => {
  // It opened on "Previous", where Enter shows another photo (audit G-14).
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'New repair' }).click();
  await repairDialog(page).getByLabel('Vehicle').fill('Bus 105');
  await addPhotos(page, [
    jpeg('door.jpg', await picture(page, { width: 800, height: 600 })),
    jpeg('wheel.jpg', await picture(page, { width: 800, height: 600, color: '#36c' })),
  ]);
  await expect(repairDialog(page).locator('[data-form-photos] img')).toHaveCount(2);
  await fillRepair(page, {});
  // Named with their repair, not "Photo 1" in every repair (audit 3 G-8).
  const thumbs = repairItems(page).first().locator('[data-photos] img');
  await expect(thumbs.nth(0)).toHaveAttribute('alt', 'Photo 1 of 2, Bus 105, Oct 21, 2026');
  await expect(thumbs.nth(1)).toHaveAttribute('alt', 'Photo 2 of 2, Bus 105, Oct 21, 2026');
  const thumb = repairItems(page)
    .first()
    .getByRole('button', { name: 'Photo 1 of 2, Bus 105, Oct 21, 2026', exact: true });
  await thumb.focus();
  await page.keyboard.press('Enter');
  const viewer = page.getByRole('dialog', { name: /^Photo/ });
  await expect(viewer.getByRole('heading', { name: 'Photo 1 of 2' })).toBeFocused();
  // Next and Previous say which photo they show; focus stays on the button.
  await viewer.getByRole('button', { name: 'Next' }).focus();
  await page.keyboard.press('Enter');
  await expect(viewer.getByRole('status')).toHaveText('Photo 2 of 2');
  await page.keyboard.press('Enter');
  await expect(viewer.getByRole('status')).toHaveText('Photo 1 of 2');
  await expect(viewer.getByRole('button', { name: 'Next' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(thumb).toBeFocused();
});
