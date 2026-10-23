// "Sync between your devices" while it waits for the network (packages/ui
// SyncControls, the same in every app with sync; tested once, here). The
// browser's clock is a test clock, so a time limit can run out at once.
// How it connects and syncs is tested for every app in tests/e2e/sync.spec.ts.
import type { Locator, Page } from '@playwright/test';
import { createAccount, hubURL, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

const status = (page: Page) => page.locator('[data-sync-status]');

/**
 * Starts counting how often focus leaves `control` (as it does when a
 * focused button is disabled). Call the result to get the count.
 */
async function focusLeaves(control: Locator): Promise<() => Promise<number>> {
  await control.evaluate((element) => {
    element.addEventListener('focusout', () => {
      element.dataset['focusLeft'] = String(Number(element.dataset['focusLeft'] ?? 0) + 1);
    });
  });
  return async () => Number((await control.getAttribute('data-focus-left')) ?? 0);
}

/** From now on, the app's server never answers (a VPN with no connection, say). */
const hang = (page: Page) =>
  page.route('**/api/**', () => {
    // Never answers.
  });

test.beforeEach(async ({ page, guard }) => {
  guard.allowOrigin(hubURL);
  await page.clock.install();
});

test('“Sync now” gives up on a network that hangs, and says so', async ({ page }) => {
  await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Tally');

  await hang(page);
  const syncNow = page.getByRole('button', { name: 'Sync now' });
  await syncNow.focus();
  const left = await focusLeaves(syncNow);
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Syncing…');
  // Waiting: it reads as unavailable, and keeps focus.
  await expect(syncNow).toHaveAttribute('aria-disabled', 'true');
  await expect(syncNow).toBeFocused();

  await page.clock.runFor('00:21');
  await expect(status(page)).toHaveText('Couldn’t sync: no connection. It will try again.');
  await expect(syncNow).toBeEnabled();
  await expect(syncNow).toBeFocused();
  expect(await left()).toBe(0);
});

test('a sync that starts by itself leaves focus on “Sync now”', async ({ page }) => {
  await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Tally');
  const syncNow = page.getByRole('button', { name: 'Sync now' });
  await syncNow.focus();
  const left = await focusLeaves(syncNow);
  let answer: () => void = () => undefined;
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await page.route(
    (url) => url.pathname === '/api/sync/copy',
    async (route) => {
      await answered;
      await route.continue();
    },
  );
  // Back on screen: it syncs.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(syncNow).toHaveAttribute('aria-disabled', 'true');
  await expect(syncNow).toBeFocused();
  answer();
  await expect(syncNow).not.toHaveAttribute('aria-disabled');
  await expect(syncNow).toBeFocused();
  expect(await left()).toBe(0);
});

test('“Turn on sync” gives up on a network that hangs, and says so', async ({ page }) => {
  await page.goto('/');
  // The status line is brought up to date every 30 seconds: the next time
  // comes while it's waiting.
  await page.clock.runFor('00:15');
  await hang(page);
  const turnOn = page.getByRole('button', { name: 'Turn on sync' });
  await turnOn.focus();
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Opening your shkriuss account…');
  await expect(turnOn).toBeDisabled();
  await page.clock.runFor('00:16');
  await expect(status(page)).toHaveText('Opening your shkriuss account…');
  await page.clock.runFor('00:05');
  const failed = "Couldn’t reach Tally's server. Check your connection and try again.";
  await expect(status(page)).toHaveText(failed);
  await expect(turnOn).toBeEnabled();
  await expect(turnOn).toBeFocused();
  await page.clock.runFor('00:31');
  await expect(status(page)).toHaveText(failed);
});
