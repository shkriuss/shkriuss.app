// Water's drinks and settings syncing between two devices through the
// account (packages/sync, docs/adr/0010). The connect flow itself is tested
// for every app in tests/e2e/sync.spec.ts.
import { createAccount, hubURL, signInWithKey, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { NOW, TIME_ZONE, todaysDrinks, total } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

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
