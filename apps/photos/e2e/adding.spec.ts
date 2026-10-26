// Adding photos with the keyboard: "Add photos" is busy while the photos are
// added (it reads as unavailable and ignores presses), but keeps focus. On
// iPhone and iPad, the page says that picked photos may be JPEG copies.
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { jpeg, picture } from './helpers.ts';

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
