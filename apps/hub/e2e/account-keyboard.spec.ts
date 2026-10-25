// The Account page with a keyboard: where focus goes when the device code it
// was on goes away.
import { expect, test } from '../../../tests/e2e/fixtures.ts';

test('when the code expires, focus goes to “Show a code”', async ({ page }) => {
  // The code's panel was hidden with focus in it: focus went to the top of
  // the page, and the next Tab skipped "Show a code" (audit G-5).
  await page.clock.install();
  await page.goto('/account/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  const show = page.getByRole('button', { name: 'Show a code' });
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeFocused();

  // A code works for 10 minutes.
  await page.clock.fastForward('11:00');
  await expect(page.locator('[data-link-status]')).toHaveText(
    'The code expired. Show a new one if you still need it.',
  );
  await expect(show).toBeFocused();
});
