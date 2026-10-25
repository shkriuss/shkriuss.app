// The Account page while it waits for the account service: buttons keep
// focus (they're busy, not disabled), and focus moves on with what replaces
// them. And how its messages are read out.
import { createAccount } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

test('a message is read out once, from a live region on the page before its text', async ({
  page,
}) => {
  await createAccount(page);
  await page.reload();
  const message = page.locator('[data-message]');
  await expect(message).toBeHidden();
  // Notes what changes in the page's live regions, and in which moment (task).
  await page.evaluate(() => {
    const log: { shown?: true; text?: string; moment: number }[] = [];
    (window as unknown as { log: typeof log }).log = log;
    let moment = 0;
    new MutationObserver((records) => {
      moment += 1;
      for (const record of records) {
        const element =
          record.target instanceof Element ? record.target : record.target.parentElement;
        const region = element?.closest<HTMLElement>(
          '[role="status"], [role="alert"], [aria-live]',
        );
        if (!region) continue;
        if (record.type === 'attributes') {
          if (region === element && !region.hidden) log.push({ shown: true, moment });
        } else if (region.textContent) {
          log.push({ text: region.textContent, moment });
        }
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ['hidden'],
    });
  });

  await page.getByRole('button', { name: 'Sign out of this device' }).click();
  await page
    .getByRole('dialog', { name: 'Sign out of this device?' })
    .getByRole('button', { name: 'Sign out' })
    .click();
  await expect(message).toHaveText('This device is signed out.');
  await expect(message).not.toHaveClass(/visually-hidden/);
  await expect(message).toBeVisible();
  const log = await page.evaluate(
    () => (window as unknown as { log: { shown?: true; text?: string; moment: number }[] }).log,
  );
  // Written once, in one live region: read out once.
  const written = log.filter((entry) => entry.text === 'This device is signed out.');
  expect(written).toHaveLength(1);
  // On the page (empty) before its text arrives, so screen readers notice the text.
  const shown = log.find((entry) => entry.shown);
  expect(shown).toBeDefined();
  expect(written[0]?.moment).toBeGreaterThan(shown?.moment ?? Infinity);
});

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

test('says it couldn’t reach the account service when the network hangs', async ({
  page,
  guard,
}) => {
  // Audit G-11: "Making a code…" used to stay for ever, and presses did nothing.
  await page.clock.install();
  await createAccount(page);
  await page.route(
    (url) => url.pathname.startsWith('/api/account/link'),
    () => new Promise<void>(() => undefined),
  );
  guard.allowConsole('net::ERR');
  await page.getByRole('button', { name: 'Show a code' }).click();
  await expect(page.locator('[data-link-status]')).toHaveText('Making a code…');
  await page.clock.fastForward(20_000);
  await expect(page.locator('[data-link-status]')).toHaveText(/^Couldn’t reach shkriuss\.app/);
  await expect(page.getByRole('button', { name: 'Show a code' })).not.toHaveAttribute(
    'aria-disabled',
    'true',
  );
});
