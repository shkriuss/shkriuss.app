// Meals' plan, meals, shopping ticks and reminder times syncing between two devices through
// the account (packages/sync, docs/adr/0010). The connect flow itself is
// tested for every app in tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import { addDays } from '@shkriuss/dates';
import {
  createAccount,
  hubURL,
  otherDevice,
  signInWithKey,
  syncedSince,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { readStore } from '../../../tests/e2e/storage.ts';
import { weekStartOf, type PlanState, type ShoppingState } from '../src/lib/meals.ts';
import { dayMeals, newMeal, NOW, plan, seed, shoppingNames, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('the plan, your meals, the shopping list and reminder times sync', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await newMeal(page, 'Lentil soup', ['Red lentils', 'Carrots']);
  await plan(page, '2026-10-21', 'Lentil soup', 'Dinner');
  await page.getByLabel('Dinner reminder time').fill('18:30');
  await turnOnSync(page, 'Meals');

  const tablet = await (await otherDevice(browser)).newPage();
  await tablet.clock.setFixedTime(NOW);
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Meals');
  await expect(dayMeals(tablet, '2026-10-21')).toHaveText([/Dinner\s*Lentil soup/]);
  await expect(tablet.locator('[data-meals] li')).toHaveText([/Lentil soup\s*2 ingredients/]);
  await expect(shoppingNames(tablet)).toHaveText(['Carrots', 'Red lentils']);
  // Reminder times too.
  await expect(tablet.getByRole('checkbox', { name: 'Dinner' })).toBeChecked();
  await expect(tablet.getByLabel('Dinner reminder time')).toHaveValue('18:30');

  // Bought on the tablet; the phone sees it ticked off.
  const uploaded = tablet.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await tablet.getByRole('checkbox', { name: /Carrots/ }).click();
  await uploaded;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByRole('checkbox', { name: /Carrots/ })).toBeChecked();
  await expect(shoppingNames(page)).toHaveText(['Red lentils', 'Carrots']);
  await tablet.context().close();
});

test('a device whose clock is years ahead doesn’t delete the plan or the shopping list', async ({
  page,
  browser,
  guard,
}) => {
  // Meals lets go of planned meals after a year and shopping lists after 8
  // weeks. A phone whose date is set two years ahead must count back from
  // the sync server's clock, not its own: what it lets go is deleted on
  // every device (audit F1-4, as in Water). Real time here, as the server's
  // clock is real.
  guard.allowOrigin(hubURL);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
  const { key } = await createAccount(page);
  await page.goto('/');
  await seed(page, {
    planned: [{ id: 'soup', date: addDays(today, -1), slot: 'dinner', name: 'Lentil soup' }],
    items: [{ id: 'bread', week: weekStartOf(today, 1), name: 'Bread', extra: true, done: false }],
  });
  await turnOnSync(page, 'Meals');

  const ahead = await (
    await browser.newContext({ locale: 'en-US', timezoneId: TIME_ZONE, serviceWorkers: 'block' })
  ).newPage();
  await ahead.clock.install({ time: Date.now() + 2 * 366 * 24 * 60 * 60 * 1000 });
  await signInWithKey(ahead, key);
  await ahead.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(ahead, 'Meals');
  const kept = async (device: Page) => [
    (await readStore<PlanState>(device, 'meal-plan'))?.data.planned.length,
    (await readStore<ShoppingState>(device, 'meal-shopping'))?.data.items.length,
  ];
  expect(await kept(ahead)).toEqual([1, 1]);
  // Meals lets old plans and lists go as it opens: opened again, now that it has them.
  const reopened = await ahead.evaluate(() => Date.now());
  await ahead.reload();
  await syncedSince(ahead, reopened);
  expect(await kept(ahead)).toEqual([1, 1]);
  await ahead.context().close();

  const since = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: 'Sync now' }).click();
  await syncedSince(page, since);
  expect(await kept(page)).toEqual([1, 1]);
});
