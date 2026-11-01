// "Sync between your devices" while it waits for the network, and what it
// reads out (packages/ui SyncControls, the same in every app with sync;
// tested once, here). The browser's clock is a test clock, so a time limit
// can run out at once. How it connects and syncs is tested for every app in
// tests/e2e/sync.spec.ts.
import type { Locator, Page } from '@playwright/test';
import { createAccount, hubURL, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

const status = (page: Page) => page.locator('[data-sync-status]');
const announcer = (page: Page) => page.locator('[data-sync-announcer]');

/** From when the page has loaded, notes everything written in a live region (what screen readers read out). */
const recordReadOut = (page: Page) =>
  page.addInitScript(() => {
    const said: string[] = [];
    (window as unknown as { said: string[] }).said = said;
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver((records) => {
        for (const { target } of records) {
          const element = target instanceof Element ? target : target.parentElement;
          const region = element?.closest('[role="status"], [role="alert"], [aria-live]');
          if (region) said.push(region.textContent ?? '');
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  });
const readOut = (page: Page) => page.evaluate(() => (window as unknown as { said: string[] }).said);

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
  await expect(announcer(page)).toHaveText('Couldn’t sync: no connection. It will try again.');
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
  const failed = 'Couldn’t reach Tally’s server. Check your connection and try again.';
  await expect(status(page)).toHaveText(failed);
  await expect(announcer(page)).toHaveText(failed);
  await expect(turnOn).toBeEnabled();
  await expect(turnOn).toBeFocused();
  await page.clock.runFor('00:31');
  await expect(status(page)).toHaveText(failed);
});

// Trying again only helps when the connection was the problem (audit 6 S40).
test('“Turn on sync” says to reload when the page’s code is gone after an update', async ({
  page,
  guard,
}) => {
  // The page stayed open through updates: its code for turning sync on is
  // gone from the server.
  guard.allowConsole('404 (Not Found)');
  await page.route('**/_astro/connect.*.js', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  const turnOn = page.getByRole('button', { name: 'Turn on sync' });
  await turnOn.click();
  const outdated =
    'Part of Tally couldn’t load. Reload the page to get the latest version, then try again.';
  await expect(status(page)).toHaveText(outdated);
  await expect(announcer(page)).toHaveText(outdated);
  await expect(turnOn).toBeEnabled();
});

test('“Turn on sync” says so when this browser won’t keep what it needs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (this === window.sessionStorage) {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }
      setItem.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  const refused = 'This browser won’t save. Is it in private mode, or is storage blocked?';
  await expect(status(page)).toHaveText(refused);
  await expect(announcer(page)).toHaveText(refused);
});

test('the sync status is shown, but only news is read out', async ({ page, guard }) => {
  // The test cuts the connection below.
  guard.allowConsole('net::ERR_FAILED');
  await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Tally');
  await recordReadOut(page);
  await page.reload();
  await expect(status(page)).toHaveText('Synced just now.');
  // The status line isn't a live region, nor in one.
  expect(
    await status(page).evaluate(
      (line) => line.closest('[role="status"], [role="alert"], [role="log"], [aria-live]') === null,
    ),
  ).toBe(true);

  // Syncs that start by themselves (when the page opens, every minute, back
  // on screen) change the line, but nothing is read out.
  const fetched = () =>
    page.waitForResponse((response) => new URL(response.url()).pathname === '/api/sync/copy');
  let synced = fetched();
  await page.clock.runFor('01:00');
  await synced;
  await expect(status(page)).toHaveText('Synced just now.');
  synced = fetched();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await synced;
  await expect(status(page)).toHaveText('Synced just now.');
  expect(await readOut(page)).toEqual([]);

  // "Sync now": its result is read out, each time.
  const syncNow = page.getByRole('button', { name: 'Sync now' });
  await syncNow.click();
  await expect(announcer(page)).toHaveText('Synced just now.');
  await expect(syncNow).toBeEnabled();
  await syncNow.click();
  await expect.poll(() => readOut(page)).toHaveLength(2);

  // A problem is read out once, not again at every sync while it lasts.
  const offline = 'Couldn’t sync: no connection. It will try again.';
  await page.route('**/api/sync/**', (route) => route.abort());
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(status(page)).toHaveText(offline);
  await expect(announcer(page)).toHaveText(offline);
  const failed = page.waitForEvent('requestfailed');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await failed;
  await expect(syncNow).toBeEnabled();
  expect((await readOut(page)).filter((text) => text.trim() === offline)).toHaveLength(1);
});
