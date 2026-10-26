// Photos of repairs: made smaller and kept on the device (IndexedDB,
// docs/adr/0013-photos-on-the-device.md), shown, looked at, saved as a copy,
// removed, and deleted with their repair or with all data.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { readStore } from '../../../tests/e2e/storage.ts';
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
  yearDialog,
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
  const big = await picture(page, { width: 3000, height: 2000 });
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
  await addPhotos(page, [jpeg('second.jpg', await picture(page, { width: 800, height: 600 }))]);
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

test('a full device: says the photos couldn’t be saved, and saves nothing half-way', async ({
  page,
}) => {
  // The likeliest failure for an app that keeps photos: the browser runs out
  // of room for them (audit 4 J-5). The repair waits in its form, with its
  // photos, until they can be saved.
  await page.getByRole('button', { name: 'New repair' }).click();
  const dialog = repairDialog(page);
  await dialog.getByLabel('Vehicle').fill('Bus 105');
  await addPhotos(page, [jpeg('door.jpg', await picture(page, { width: 800, height: 600 }))]);
  await expect(dialog.locator('[data-form-photos] img')).toHaveCount(1);
  await page.evaluate(() => {
    Object.assign(window, { realPut: IDBObjectStore.prototype.put });
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await fillRepair(page, {});
  // Read out at once (an alert), with focus where the photos are.
  await expect(dialog.getByRole('alert').filter({ hasText: 'Couldn’t save' })).toHaveText(
    'Couldn’t save the photos. Your device may be out of space.',
  );
  await expect(dialog.getByRole('button', { name: 'Add photos' })).toBeFocused();
  await expect(dialog).toBeVisible();
  expect(await storedPhotos(page)).toBe(0);
  const saved = await readStore<{ repairs: unknown[] }>(page, 'repairs');
  expect(saved?.data.repairs ?? []).toEqual([]);

  // With room again, the same form saves, photo and all.
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = (
      window as unknown as { realPut: IDBObjectStore['put'] }
    ).realPut;
  });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved the repair on Bus 105')).toBeAttached();
  expect(await storedPhotos(page)).toBe(1);
});

test('deleting a year deletes its repairs’ photos', async ({ page }) => {
  await page.getByRole('button', { name: 'New repair' }).click();
  const dialog = repairDialog(page);
  await dialog.getByLabel('Vehicle').fill('Bus 105');
  await dialog.getByLabel('Day').fill('2025-06-01');
  await addPhotos(page, [jpeg('door.jpg', await picture(page, { width: 400, height: 300 }))]);
  await expect(dialog.locator('[data-form-photos] img')).toHaveCount(1);
  await fillRepair(page, {});
  await expect(status(page, 'Saved the repair on Bus 105')).toBeAttached();
  expect(await storedPhotos(page)).toBe(1);

  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await yearDialog(page).getByRole('button', { name: 'Delete 1 repair' }).click();
  await expect(status(page, 'Deleted 1 repair from 2025.')).toBeAttached();
  await expect.poll(() => storedPhotos(page)).toBe(0);
});

// Audit F2-9: a photo no repair used (after an older backup was restored,
// say) stayed on the device for good.
test('deletes a photo no repair uses, after an older backup is restored', async ({ page }) => {
  // A backup with one repair, and no photo.
  await seed(page, {
    vehicles: [vehicle({ id: 'b105', name: 'Bus 105' })],
    repairs: [repair({ id: 'old', date: '2026-10-20' })],
  });
  await page.getByRole('button', { name: 'Back up' }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'Back up your data' })
    .getByRole('button', { name: 'Download without a passphrase' })
    .click();
  const backup = await (await download).path();

  // Then a repair with a photo.
  await page.getByRole('button', { name: 'New repair' }).click();
  await repairDialog(page).getByLabel('Vehicle').fill('Bus 105');
  await addPhotos(page, [jpeg('door.jpg', await picture(page, { width: 400, height: 300 }))]);
  await expect(repairDialog(page).locator('[data-form-photos] img')).toHaveCount(1);
  await fillRepair(page, { work: 'Replaced the door glass' });
  await expect(status(page, 'Saved the repair on Bus 105.')).toBeAttached();
  expect(await storedPhotos(page)).toBe(1);

  // A few minutes later the backup is restored: no repair has the photo now.
  await page.clock.setFixedTime(NOW.getTime() + 5 * 60 * 1000);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore' }).click();
  await (await chooser).setFiles(backup);
  const reloaded = page.waitForEvent('load');
  await page
    .getByRole('dialog', { name: 'Restore a backup' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await reloaded;
  await expect(repairItems(page)).toHaveCount(1);
  await expect.poll(() => storedPhotos(page)).toBe(0);
});

test('up to 10 photos, and moving between them', async ({ page }) => {
  const small = await picture(page, { width: 40, height: 30 });
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

// Audit 3 F2-1: the form kept its own photos as they were when it opened, so
// saving it took off a photo added in another tab (or on another device).
test('a photo added in another tab shows in a form open here, 10 at most', async ({ page }) => {
  const small = await picture(page, { width: 40, height: 30 });
  const elsewhere = Array.from({ length: 9 }, (_, index) => `on-the-tablet-${index}`);
  await seed(page, {
    vehicles: [vehicle({ id: 'b105', name: 'Bus 105' })],
    repairs: [repair({ id: 'r', photos: elsewhere })],
  });
  const other = await page.context().newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto('/');

  // Here: a photo added in the form, not saved yet.
  await repairItems(page).first().locator('[data-action="edit-repair"]').click();
  const dialog = repairDialog(page);
  await addPhotos(page, [jpeg('here.jpg', small)]);
  await expect(dialog.locator('[data-form-photos] img')).toHaveCount(1);
  // In the other tab: another one, saved.
  await repairItems(other).first().locator('[data-action="edit-repair"]').click();
  await addPhotos(other, [jpeg('there.jpg', small)]);
  await expect(repairDialog(other).locator('[data-form-photos] img')).toHaveCount(1);
  await fillRepair(other, {});
  await expect(repairDialog(other)).toBeHidden();

  // It shows here too: 11 in all, one more than a repair keeps, so one has to go.
  await expect(dialog.locator('[data-form-photos] img')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('[data-error-for="photos"]')).toHaveText('Add up to 10 photos.');
  await expect(dialog.getByRole('button', { name: 'Remove photo 1' })).toBeFocused();
  await page.keyboard.press('Enter');
  await fillRepair(page, {});
  await expect(dialog).toBeHidden();
  const saved = await readStore<{ repairs: { photos: string[] }[] }>(page, 'repairs');
  expect(saved?.data.repairs[0]?.photos).toEqual([...elsewhere, expect.any(String)]);
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
  await addPhotos(page, [jpeg('here.jpg', await picture(page, { width: 400, height: 300 }))]);
  await fillRepair(page, { work: 'Checked again' });
  await expect(item.locator('[data-photos] img')).toHaveCount(1);
  await expect(item.locator('[data-photos-elsewhere]')).toHaveText('1 photo on another device');
  const saved = await readStore<{ repairs: { photos: string[] }[] }>(page, 'repairs');
  expect(saved?.data.repairs[0]?.photos).toEqual(['taken-on-the-tablet', expect.any(String)]);
  expect(await storedPhotos(page)).toBe(1);

  // "Delete all data" deletes the photos too.
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('No repairs yet.', { exact: false })).toBeVisible();
  expect(await storedPhotos(page)).toBe(0);
});

test('makes photos smaller in a worker, so the page doesn’t freeze', async ({ page }) => {
  // It was done on the page itself, which stops everything else while a big
  // photo is made smaller (audit J-12).
  const big = await picture(page);
  const worker = page.waitForEvent('worker');
  await page.getByRole('button', { name: 'New repair' }).click();
  await addPhotos(page, [jpeg('door.jpg', big)]);
  expect((await worker).url()).toContain('make-photo.worker');
  const formPhotos = repairDialog(page).locator('[data-form-photos] img');
  await expect(formPhotos).toHaveCount(1);
  await expect.poll(() => naturalWidth(formPhotos.first())).toBe(320);
});
