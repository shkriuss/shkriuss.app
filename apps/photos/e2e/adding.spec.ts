// Adding photos with the keyboard: "Add photos" is busy while the photos are
// added (it reads as unavailable and ignores presses), but keeps focus. On
// iPhone and iPad, the page says that picked photos may be JPEG copies.
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { addPhotos, jpeg, picture, stored } from './helpers.ts';

const IPHONE_HINT =
  'On iPhone and iPad, photos picked from the Photo Library may be added as JPEG copies, not as the original files.';

test.describe('on an iPhone', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  });

  test('says photos from the Photo Library may be JPEG copies, and how to keep the originals', async ({
    page,
  }) => {
    // Safari's photo picker there likely converts HEIC photos (audit 3 F3-3).
    await page.goto('/');
    const hint = page.locator('[data-apple-hint]');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText(IPHONE_HINT);
    await expect(hint).toContainText('“Choose File”');
    await expect(hint).toContainText('Settings → Camera → Formats');
    await checkA11y(page, 'the iPhone hint');
    await page.emulateMedia({ colorScheme: 'dark' });
    await checkA11y(page, 'the iPhone hint (dark)');
    // It fits a small phone, with text at 200% too.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});

test('says nothing about iPhone photos on other devices', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add photos' })).toBeVisible();
  await expect(page.locator('[data-apple-hint]')).toBeHidden();
});

test('“Add photos” keeps focus while the photos are added', async ({ page }) => {
  await page.goto('/');
  const add = page.getByRole('button', { name: 'Add photos' });
  await add.focus();
  // Notes when it was busy, and whether focus ever left it.
  await add.evaluate((button) => {
    const seen = { busy: false, left: 0 };
    (window as unknown as { seen: typeof seen }).seen = seen;
    new MutationObserver(() => {
      seen.busy ||= button.getAttribute('aria-disabled') === 'true';
    }).observe(button, { attributes: true });
    button.addEventListener('focusout', () => {
      seen.left += 1;
    });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles([jpeg('IMG_0001.JPG', await picture(page))]);
  await expect(page.getByRole('status').filter({ hasText: 'Added 1 photo.' })).toBeAttached();
  await expect(add).not.toHaveAttribute('aria-disabled');
  await expect(add).toBeFocused();
  expect(await page.evaluate(() => (window as unknown as { seen: unknown }).seen)).toEqual({
    busy: true,
    left: 0,
  });
});

test('a full device: says the photo couldn’t be saved, and keeps nothing of it', async ({
  page,
}) => {
  // The likeliest failure for an app that keeps originals: the browser runs
  // out of room for them (audit 4 J-5). A photo's files and details are
  // saved together; if either can't be, nothing of the photo is kept.
  await page.goto('/');
  for (const kind of ['photo-files:', 'photo:']) {
    await page.evaluate((kind) => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, value, key) {
        if (typeof key === 'string' && key.startsWith(kind)) {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return put.call(this, value, key);
      };
    }, kind);
    await addPhotos(page, [jpeg('IMG_0001.JPG', await picture(page))]);
    // In the notice at the top, read out at once.
    await expect(page.getByRole('alert').filter({ hasText: 'couldn’t be saved' })).toHaveText(
      'No photos were added. 1 photo couldn’t be saved. This device may be out of space.',
    );
    expect(await stored(page), kind).toEqual({ photos: 0, files: 0 });
    await expect(page.locator('[data-months] .tile')).toHaveCount(0);
    await page.reload();
  }
  // With room again, it's added.
  await addPhotos(page, [jpeg('IMG_0001.JPG', await picture(page))]);
  await expect(page.locator('[data-months] .tile')).toHaveCount(1);
  expect(await stored(page)).toEqual({ photos: 1, files: 1 });
});
