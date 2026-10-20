// Meals' plan, meals and shopping ticks syncing between two devices through
// the account (packages/sync, docs/adr/0010). The connect flow itself is
// tested for every app in tests/e2e/sync.spec.ts.
import {
  createAccount,
  hubURL,
  otherDevice,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { dayMeals, newMeal, NOW, plan, shoppingNames, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('the plan, your meals and the shopping list sync', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await newMeal(page, 'Lentil soup', ['Red lentils', 'Carrots']);
  await plan(page, '2026-10-21', 'Lentil soup', 'Dinner');
  await turnOnSync(page, 'Meals');

  const tablet = await (await otherDevice(browser)).newPage();
  await tablet.clock.setFixedTime(NOW);
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Meals');
  await expect(dayMeals(tablet, '2026-10-21')).toHaveText([/Dinner\s*Lentil soup/]);
  await expect(tablet.locator('[data-meals] li')).toHaveText([/Lentil soup\s*2 ingredients/]);
  await expect(shoppingNames(tablet)).toHaveText(['Carrots', 'Red lentils']);

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
