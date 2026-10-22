// Photos of repairs: made smaller and kept on the device (IndexedDB,
// docs/adr/0013-photos-on-the-device.md), shown, looked at, saved as a copy,
// removed, and deleted with their repair or with all data.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  addPhotos,
  fillRepair,
  jpeg,
  naturalWidth,
  NOW,
  picture,
  repair,
  repairDialog,
  repairItems,
  seed,
  storedPhotos,
  TIME_ZONE,
  vehicle,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('adds photos to a repair, made smaller, and keeps them on the device', async ({ page }) => {
  // Counted before the app has made its files: counting mustn't get in its way.
  expect(await storedPhotos(page)).toBe(0);
  const big = await picture(page);
  await page.getByRole('button', { name: 'New repair' }).click();
  const dialog = repairDialog(page);
  await dialog.getByLabel('Vehicle').fill('Bus 105');
  await dialog.getByLabel('Damage found').fill('Cracked door glass');
  await addPhotos(page, [
    jpeg('door.jpg', big),
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a picture') },
  ]);
  const formPhotos = dialog.locator('[data-form-photos] img');
  await expect(formPhotos).toHaveCount(1);
  await expect(dialog.getByText('notes.txt isn’t a photo.')).toBeVisible();
  await expect.poll(() => naturalWidth(formPhotos.first())).toBe(320);
  await checkA11y(page, 'photos in the repair form');

  // Closing without saving keeps nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await storedPhotos(page)).toBe(0);

  await page.getByRole('button', { name: 'New repair' }).click();
  await dialog.getByLabel('Vehicle').fill('Bus 105');
  await addPhotos(page, [jpeg('door.jpg', big)]);
  await expect(formPhotos).toHaveCount(1);
  // A photo alone is enough to save.
  await fillRepair(page, {});
  await expect(status(page, 'Saved the repair on Bus 105')).toBeAttached();
  expect(await storedPhotos(page)).toBe(1);
  const thumb = repairItems(page).first().getByRole('button', { name: 'Photo 1' });
  await expect(thumb).toBeVisible();

  // Kept after a reload; looked at full size, and saved as a copy.
  await page.reload();
  await thumb.click();
  const viewer = page.getByRole('dialog', { name: 'Photo' });
  const full = viewer.getByRole('img');
  await expect(full).toHaveAttribute('alt', 'From the repair on Bus 105 on Oct 21, 2026');
  await expect.poll(() => naturalWidth(full)).toBe(1600);
  await expect(viewer.getByRole('button', { name: 'Next' })).toBeHidden();
  await checkA11y(page, 'a photo');
  const download = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Save a copy' }).click();
  expect((await download).suggestedFilename()).toBe('bus-105-2026-10-21-photo-1.jpg');
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(thumb).toBeFocused();

  // Another photo; the first removed. Saving deletes it from the device.
  await repairItems(page).first().locator('[data-action="edit-repair"]').click();
  await expect(formPhotos).toHaveCount(1);
  await addPhotos(page, [jpeg('second.jpg', await picture(page, 800, 600))]);
  await expect(formPhotos).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(formPhotos).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: 'Remove photo 1' })).toBeFocused();
  await fillRepair(page, {});
  await expect(status(page, 'Saved the repair on Bus 105.')).toBeAttached();
  expect(await storedPhotos(page)).toBe(1);
  await repairItems(page).first().getByRole('button', { name: 'Photo 1' }).click();
  await expect.poll(() => naturalWidth(viewer.getByRole('img'))).toBe(800);
  await viewer.getByRole('button', { name: 'Close' }).click();

  // Deleting the repair deletes its photos.
  await repairItems(page).first().locator('[data-action="edit-repair"]').click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this repair?' })
    .getByRole('button', {
      name: 'Delete',
    })
    .click();
  await expect(status(page, 'Deleted the repair.')).toBeAttached();
  await expect.poll(() => storedPhotos(page)).toBe(0);
});

test('up to 10 photos, and moving between them', async ({ page }) => {
  const small = await picture(page, 40, 30);
  await page.getByRole('button', { name: 'New repair' }).click();
  const dialog = repairDialog(page);
  await dialog.getByLabel('Vehicle').fill('Bus 7');
  await addPhotos(
    page,
    Array.from({ length: 11 }, (_, index) => jpeg(`photo-${index + 1}.jpg`, small)),
  );
  await expect(dialog.locator('[data-form-photos] img')).toHaveCount(10);
  await expect(
    dialog.getByText('A repair can have up to 10 photos, so 1 photo wasn’t added.'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Add photos' })).toBeHidden();
  await fillRepair(page, {});
  await expect(repairItems(page).first().locator('[data-photos] img')).toHaveCount(10);

  await repairItems(page).first().getByRole('button', { name: 'Photo 10' }).click();
  const viewer = page.getByRole('dialog', { name: 'Photo 10 of 10' });
  await viewer.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('dialog', { name: 'Photo 1 of 10' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(viewer).toBeVisible();
});

test('photos on another device, and deleting all data', async ({ page }) => {
  await seed(page, {
    vehicles: [vehicle({ id: 'b105', name: 'Bus 105' })],
    repairs: [repair({ id: 'synced', photos: ['taken-on-the-tablet'] })],
  });
  const item = repairItems(page).first();
  await expect(item.locator('[data-photos-elsewhere]')).toHaveText('1 photo on another device');
  await expect(item.locator('[data-photos] img')).toHaveCount(0);

  // Changed here, the photo stays with the repair.
  await item.locator('[data-action="edit-repair"]').click();
  const dialog = repairDialog(page);
  await expect(dialog.locator('[data-form-photos-elsewhere]')).toHaveText(
    '1 photo is on another device. It stays with this repair.',
  );
  await addPhotos(page, [jpeg('here.jpg', await picture(page, 400, 300))]);
  await fillRepair(page, { work: 'Checked again' });
  await expect(item.locator('[data-photos] img')).toHaveCount(1);
  await expect(item.locator('[data-photos-elsewhere]')).toHaveText('1 photo on another device');
  const saved = await page.evaluate(() => localStorage.getItem('shkriuss:repairs'));
  expect(
    (JSON.parse(saved ?? '{}') as { data: { repairs: { photos: string[] }[] } }).data.repairs[0]
      ?.photos,
  ).toEqual(['taken-on-the-tablet', expect.any(String)]);
  expect(await storedPhotos(page)).toBe(1);

  // "Delete all data" deletes the photos too.
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('No repairs yet.', { exact: false })).toBeVisible();
  expect(await storedPhotos(page)).toBe(0);
});
