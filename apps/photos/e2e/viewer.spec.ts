// Photos' viewer with a keyboard and a screen reader.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addPhotos, jpeg, picture, withExif } from './helpers.ts';

test('photos taken in the same minute have names of their own, and the viewer says which it shows', async ({
  page,
}) => {
  // Three photos a few seconds apart, as a camera takes them (audit 3 G-8).
  await page.goto('/');
  const colours = ['#c33', '#36c', '#3c6'];
  const taken = ['2026:10:20 14:05:01', '2026:10:20 14:05:03', '2026:10:20 14:05:07'];
  await addPhotos(
    page,
    await Promise.all(
      taken.map(async (when, index) =>
        jpeg(
          `IMG_100${index}.JPG`,
          withExif(await picture(page, { width: 400, height: 300, color: colours[index] }), when),
        ),
      ),
    ),
  );
  const tiles = page.locator('[data-months] .tile');
  await expect(tiles).toHaveCount(3);
  for (const second of ['01', '03', '07']) {
    await expect(
      page.getByRole('button', {
        name: `Photo taken Oct 20, 2026, 2:05:${second} PM`,
        exact: true,
      }),
    ).toHaveCount(1);
  }

  // Next and Previous keep focus where it is, and the viewer says which photo it shows now.
  await tiles.first().click();
  const viewer = page.locator('[data-viewer]');
  const said = viewer.locator('[data-viewer-announcer]');
  await expect(said).toHaveAttribute('role', 'status');
  await viewer.getByRole('button', { name: 'Next' }).click();
  await expect(said).toHaveText('Photo 2 of 3, taken Oct 20, 2026, 2:05:03 PM');
  await expect(viewer.getByRole('heading')).toHaveText('Oct 20, 2026, 2:05:03 PM');
  await expect(viewer.getByRole('button', { name: 'Next' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(said).toHaveText('Photo 1 of 3, taken Oct 20, 2026, 2:05:07 PM');

  // Deleting one says so in the viewer (the page behind it can't be heard), and which is shown now.
  await viewer.getByRole('button', { name: 'Next' }).click();
  await viewer.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this photo?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(said).toHaveText('Deleted the photo. Photo 2 of 2, taken Oct 20, 2026, 2:05:01 PM.');
  await expect(viewer.getByRole('button', { name: 'Delete' })).toBeFocused();
});

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
