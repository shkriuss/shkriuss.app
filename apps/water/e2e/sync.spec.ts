// Water's drinks and settings syncing between two devices through the
// account (packages/sync, docs/adr/0010). The connect flow itself is tested
// for every app in tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import { addDays } from '@shkriuss/dates';
import { createAccount, hubURL, signInWithKey, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { readStore } from '../../../tests/e2e/storage.ts';
import type { DrinksState } from '../src/lib/water.ts';
import { drink, history, NOW, seed, TIME_ZONE, todaysDrinks, total } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

/** Waits until the page has synced after `since` (its own clock). */
async function syncedAfter(page: Page, since: number): Promise<void> {
  await page.waitForFunction((after) => {
    const state = JSON.parse(localStorage.getItem('shkriuss-device:sync') ?? 'null') as {
      last?: number | null;
    } | null;
    return (state?.last ?? 0) > after;
  }, since);
}

test('drinks, the goal and reminders sync between devices', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Glass 250 ml' }).click();
  await page.getByLabel('Daily goal (ml)').fill('2500');
  await page.getByLabel('Daily goal (ml)').blur();
  await page.getByRole('checkbox', { name: 'Remind me to drink' }).check();
  await turnOnSync(page, 'Water');

  const tablet = await (
    await browser.newContext({ locale: 'en-US', timezoneId: TIME_ZONE, serviceWorkers: 'block' })
  ).newPage();
  await tablet.clock.setFixedTime(NOW);
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Water');
  await expect(total(tablet)).toHaveText('250 ml');
  await expect(tablet.locator('[data-goal]')).toHaveText('2,500 ml');
  await expect(tablet.getByRole('checkbox', { name: 'Remind me to drink' })).toBeChecked();

  // Changed on the tablet; the phone sees it.
  const uploaded = tablet.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await tablet.getByRole('button', { name: 'Remove 250 ml at 10:00 AM' }).click();
  await tablet.getByRole('button', { name: 'Bottle 500 ml' }).click();
  await tablet.getByLabel('US fluid ounces (fl oz)').check();
  await uploaded;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(todaysDrinks(page)).toHaveText([/10:00\sAM\s*16.9 fl oz/]);
  await expect(page.locator('[data-goal]')).toHaveText('84.5 fl oz');
  await tablet.context().close();
});

test('a device whose clock is years ahead doesn’t delete the drinks', async ({
  page,
  browser,
  guard,
}) => {
  // Water lets go of drinks older than a year. A phone whose date is set two
  // years ahead must count back from the sync server's clock, not its own:
  // what it lets go is deleted on every device (audit F1-4). Real time here,
  // as the server's clock is real.
  guard.allowOrigin(hubURL);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
  const { key } = await createAccount(page);
  await page.goto('/');
  await seed(page, {
    drinks: [drink(addDays(today, -1), '09:00', 500), drink(addDays(today, -2), '09:00', 700)],
  });
  await turnOnSync(page, 'Water');

  const ahead = await (
    await browser.newContext({ locale: 'en-US', timezoneId: TIME_ZONE, serviceWorkers: 'block' })
  ).newPage();
  await ahead.clock.install({ time: Date.now() + 2 * 366 * 24 * 60 * 60 * 1000 });
  await signInWithKey(ahead, key);
  await ahead.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(ahead, 'Water');
  const drinksOn = async (device: Page) =>
    (await readStore<DrinksState>(device, 'water'))?.data.drinks.length;
  expect(await drinksOn(ahead)).toBe(2);
  // Water lets old drinks go as it opens: opened again, now that it has them.
  const reopened = await ahead.evaluate(() => Date.now());
  await ahead.reload();
  await syncedAfter(ahead, reopened);
  expect(await drinksOn(ahead)).toBe(2);
  await ahead.context().close();

  const since = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: 'Sync now' }).click();
  await syncedAfter(page, since);
  expect(await drinksOn(page)).toBe(2);
  await expect(history(page).nth(1)).toHaveText(/^Yesterday\s*500 ml/);
});
