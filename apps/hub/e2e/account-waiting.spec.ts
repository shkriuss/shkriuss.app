// The Account page while it waits for the account service: buttons keep
// focus (they're busy, not disabled), and focus moves on with what replaces them.
import { createAccount } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

test('“Show a code” keeps focus while it waits, then moves it to “Copy link”', async ({ page }) => {
  await createAccount(page);
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route(
    (url) => url.pathname.startsWith('/api/account/link'),
    async (route) => {
      await answered;
      await route.continue();
    },
  );
  const show = page.getByRole('button', { name: 'Show a code' });
  await show.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-link-status]')).toHaveText('Making a code…');
  await expect(show).toHaveAttribute('aria-disabled', 'true');
  await expect(show).toBeFocused();

  answer();
  await expect(page.locator('[data-link-url]')).toHaveText(/#link=/);
  await expect(show).toBeHidden();
  await expect(page.getByRole('button', { name: 'Copy link' })).toBeFocused();
});
