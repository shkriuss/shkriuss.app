// "Sync between your devices" while it waits for the network (packages/ui
// SyncControls, the same in every app with sync; tested once, here). The
// browser's clock is a test clock, so a time limit can run out at once.
// How it connects and syncs is tested for every app in tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import { createAccount, hubURL, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

const status = (page: Page) => page.locator('[data-sync-status]');

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
  await page.keyboard.press('Enter');
  await expect(status(page)).toHaveText('Syncing…');
  await page.clock.runFor('00:21');
  await expect(status(page)).toHaveText('Couldn’t sync: no connection. It will try again.');
  await expect(syncNow).toBeEnabled();
});

test('“Turn on sync” gives up on a network that hangs, and says so', async ({ page }) => {
  await page.goto('/');
  // The status line is brought up to date every 30 seconds: the next time
  // comes while it's waiting.
  await page.clock.runFor('00:15');
  await hang(page);
  const turnOn = page.getByRole('button', { name: 'Turn on sync' });
  await turnOn.click();
  await expect(status(page)).toHaveText('Opening your shkriuss account…');
  await page.clock.runFor('00:16');
  await expect(status(page)).toHaveText('Opening your shkriuss account…');
  await page.clock.runFor('00:05');
  const failed = "Couldn’t reach Tally's server. Check your connection and try again.";
  await expect(status(page)).toHaveText(failed);
  await expect(turnOn).toBeEnabled();
  await page.clock.runFor('00:31');
  await expect(status(page)).toHaveText(failed);
});
