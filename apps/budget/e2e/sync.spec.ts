// Budget's categories, entries and currency syncing between two devices
// through the account (packages/sync, docs/adr/0010). The connect flow itself
// is tested for every app in tests/e2e/sync.spec.ts.
import { createAccount, hubURL, signInWithKey, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addCategory, addEntry, categoryItem, NOW, TIME_ZONE, total } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('categories, entries and the currency sync between devices', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await addCategory(page, 'Groceries', '400');
  await addEntry(page, { amount: '84.30', category: 'Groceries' });
  await page.getByLabel('Currency', { exact: true }).selectOption('EUR');
  await turnOnSync(page, 'Budget');

  const tablet = await (
    await browser.newContext({ locale: 'en-US', timezoneId: TIME_ZONE, serviceWorkers: 'block' })
  ).newPage();
  await tablet.clock.setFixedTime(NOW);
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Budget');
  await expect(categoryItem(tablet, 'Groceries')).toContainText('€315.70 left of €400.00');
  await expect(tablet.getByLabel('Currency', { exact: true })).toHaveValue('EUR');

  // Added on the tablet; the phone sees it.
  const uploaded = tablet.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await addEntry(tablet, { kind: 'income', amount: '2000' });
  await uploaded;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(total(page, 'Income')).toHaveText('€2,000.00');
  await tablet.context().close();
});
