// Trades and the currency syncing between two devices through the account
// (packages/sync, docs/adr/0010). The connect flow itself is tested for
// every app in tests/e2e/sync.spec.ts.
import { createAccount, hubURL, signInWithKey, turnOnSync } from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { fillTrade, NOW, tile, TIME_ZONE, tradeItem, yearDialog } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test('trades and the currency sync between devices', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  await page.clock.setFixedTime(NOW);
  const { key } = await createAccount(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New trade' }).click();
  await fillTrade(page, { symbol: 'AAPL', entryPrice: '150', quantity: '10' });
  await page.getByLabel('Currency', { exact: true }).selectOption('EUR');
  await turnOnSync(page, 'Trades');

  const tablet = await (
    await browser.newContext({ locale: 'en-US', timezoneId: TIME_ZONE, serviceWorkers: 'block' })
  ).newPage();
  await tablet.clock.setFixedTime(NOW);
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Trades');
  await expect(tradeItem(tablet, 'AAPL')).toContainText('10 at 150');
  await expect(tablet.getByLabel('Currency', { exact: true })).toHaveValue('EUR');

  // Closed on the tablet; the phone sees the result.
  const uploaded = tablet.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await tablet.getByRole('button', { name: 'Close the AAPL trade' }).click();
  await fillTrade(tablet, { exitPrice: '160' });
  await uploaded;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(tile(page, 'Net result')).toHaveText('+€100.00');
  await expect(page.getByRole('heading', { name: 'Open trades' })).toBeHidden();

  // A year deleted on the phone is deleted on the tablet too.
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await yearDialog(page).getByRole('button', { name: 'Delete 1 closed trade' }).click();
  await deleted;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(tablet.getByText('No closed trades yet.')).toBeVisible();
  await tablet.context().close();
});
