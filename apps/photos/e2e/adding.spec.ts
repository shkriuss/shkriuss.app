// Adding photos with the keyboard: "Add photos" is busy while the photos are
// added (it reads as unavailable and ignores presses), but keeps focus.
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { jpeg, picture } from './helpers.ts';

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
