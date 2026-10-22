// Photos: adding photos (the originals kept exactly as they are), the
// library by month, looking at a photo, choosing several, deleting.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { addPhotos, jpeg, naturalWidth, picture, stored, withExif } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const tiles = (page: Page) => page.locator('[data-months] .tile');
const viewer = (page: Page) => page.locator('[data-viewer]');
const monthHeadings = (page: Page) => page.locator('[data-months] h3');

test('adds photos, keeps the originals exactly, and shows them by month', async ({ page }) => {
  await expect(page.getByText('No photos yet.', { exact: false })).toBeVisible();
  const july = withExif(await picture(page, { color: '#36c' }), '2019:07:04 18:30:05');
  const october = withExif(
    await picture(page, { width: 3000, height: 4000 }),
    '2026:10:21 14:03:22',
  );
  await addPhotos(page, [
    jpeg('IMG_0001.JPG', july),
    jpeg('IMG_0002.JPG', october),
    // A kind of photo this browser can't show, a file that isn't a photo, and one already picked.
    { name: 'IMG_0100.HEIC', mimeType: 'image/heic', buffer: Buffer.from('heic photo bytes') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') },
    jpeg('copy of IMG_0001.JPG', july),
  ]);
  await expect(
    status(page, 'Added 3 photos. 1 photo was already here. 1 file isn’t a photo.'),
  ).toBeAttached();
  await expect(tiles(page)).toHaveCount(3);
  await expect(page.locator('[data-summary]')).toContainText('3 photos ·');
  await expect(monthHeadings(page).filter({ hasText: 'July 2019' })).toHaveText(/1 photo$/);
  await expect(monthHeadings(page).last()).toContainText('July 2019');
  await expect(
    page.getByRole('button', { name: 'Photo taken Oct 21, 2026, 2:03 PM' }),
  ).toBeVisible();
  // The one this browser can't show says what kind it is.
  await expect(tiles(page).filter({ hasText: 'HEIC' })).toHaveCount(1);
  expect(await stored(page)).toEqual({ photos: 3, files: 3 });
  await checkA11y(page, 'the library');

  // Kept after a reload.
  await page.reload();
  const julyTile = page.getByRole('button', { name: 'Photo taken Jul 4, 2019, 6:30 PM' });
  await expect.poll(() => naturalWidth(julyTile.locator('img'))).toBe(512);

  // Looking at it: a screen-sized copy, its details, and the original saved exactly.
  await julyTile.click();
  const dialog = viewer(page);
  await expect(dialog.getByRole('heading')).toHaveText('Jul 4, 2019, 6:30 PM');
  await expect.poll(() => naturalWidth(dialog.getByRole('img'))).toBe(2048);
  await expect(dialog.locator('[data-detail="name"]')).toHaveText('IMG_0001.JPG');
  await expect(dialog.locator('[data-detail="size"]')).toHaveText(/ · 4,000 × 3,000$/);
  await expect(dialog.locator('[data-detail="kind"]')).toHaveText('JPG · 3 of 3');
  await checkA11y(page, 'a photo');
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save original' }).click();
  expect((await download).suggestedFilename()).toBe('IMG_0001.JPG');
  expect((await readFile(await (await download).path())).equals(july)).toBe(true);

  // Moving between them (from the last back to the first).
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.locator('[data-detail="kind"]')).toHaveText(/ · 1 of 3$/);
  await page.keyboard.press('ArrowLeft');
  await expect(dialog.locator('[data-detail="kind"]')).toHaveText('JPG · 3 of 3');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(julyTile).toBeFocused();

  // The HEIC: not shown here, but its original can be saved.
  await tiles(page).filter({ hasText: 'HEIC' }).click();
  await expect(dialog.getByText('This browser can’t show this kind of photo.')).toBeVisible();
  const heic = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Save original' }).click();
  expect(await readFile(await (await heic).path(), 'utf8')).toBe('heic photo bytes');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'a photo this browser can’t show (dark)');
});

test('chooses several to save or delete, and deletes one while looking at it', async ({ page }) => {
  const pictures = await Promise.all(
    ['#c33', '#36c', '#3a6'].map((color) => picture(page, { width: 800, height: 600, color })),
  );
  await addPhotos(
    page,
    pictures.map((buffer, index) => jpeg(`IMG_000${index}.JPG`, buffer)),
  );
  await expect(tiles(page)).toHaveCount(3);

  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('[data-selected-count]')).toHaveText('Tap photos to choose them.');
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await tiles(page).nth(0).click();
  await tiles(page).nth(1).click();
  await expect(tiles(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(tiles(page).nth(2)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-selected-count]')).toHaveText('2 photos chosen');
  await checkA11y(page, 'choosing photos');

  // Saving the chosen originals: one file each.
  const saved: string[] = [];
  page.on('download', (download) => saved.push(download.suggestedFilename()));
  await page.getByRole('button', { name: 'Save originals' }).click();
  await expect(status(page, 'Saved 2 originals.')).toBeAttached();
  await expect.poll(() => saved.length).toBe(2);

  // Deleting them, after asking.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete 2 photos?' });
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(status(page, 'Deleted 2 photos.')).toBeAttached();
  await expect(tiles(page)).toHaveCount(1);
  await expect.poll(() => stored(page)).toEqual({ photos: 1, files: 1 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Select' })).toBeFocused();

  // The last one, from the viewer: nothing left to look at, so it closes.
  await tiles(page).first().click();
  await viewer(page).getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this photo?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(status(page, 'Deleted the photo.')).toBeAttached();
  await expect(viewer(page)).toBeHidden();
  await expect(page.getByText('No photos yet.', { exact: false })).toBeVisible();
  expect(await stored(page)).toEqual({ photos: 0, files: 0 });
});

test('“Delete all data” deletes the photos', async ({ page }) => {
  await addPhotos(page, [jpeg('IMG_0001.JPG', await picture(page, { width: 400, height: 300 }))]);
  await expect(tiles(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Back up' })).toBeHidden();
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('No photos yet.', { exact: false })).toBeVisible();
  expect(await stored(page)).toEqual({ photos: 0, files: 0 });
});
