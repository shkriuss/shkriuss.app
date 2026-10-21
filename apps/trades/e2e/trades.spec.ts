// Trades' own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { fillTrade, NOW, seed, tile, TIME_ZONE, trade, tradeDialog, tradeItem } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('logs a trade, closes it, and shows the result', async ({ page }) => {
  await expect(page.getByText('No closed trades in this period yet.')).toBeVisible();
  await expect(page.getByText('No closed trades yet.')).toBeVisible();

  // Checked before it's saved.
  await page.getByRole('button', { name: 'New trade' }).click();
  const dialog = tradeDialog(page);
  await expect(dialog.getByRole('heading', { name: 'New trade' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Entry' }).getByLabel('Day')).toHaveValue(
    '2026-10-21',
  );
  await expect(dialog.getByLabel('Long', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter the symbol, like AAPL.')).toBeVisible();
  await expect(dialog.getByText('Enter the entry price.')).toBeVisible();
  await expect(dialog.getByText('Enter how many.')).toBeVisible();
  await expect(dialog.getByLabel('Symbol')).toBeFocused();
  await checkA11y(page, 'trade form problems');

  // Open: no result yet.
  await fillTrade(page, { symbol: 'aapl', entryPrice: '150.25', quantity: '100', stop: '147' });
  await expect(status(page, 'Saved the AAPL trade, still open.')).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Open trades' })).toBeVisible();
  await expect(tradeItem(page, 'AAPL')).toContainText('100 at 150.25, since Oct 21, 2026');
  await expect(page.getByRole('button', { name: 'AAPL Long' })).toBeFocused();

  // Closed: the result after fees, as a percentage and in R.
  await page.getByRole('button', { name: 'Close the AAPL trade' }).click();
  await expect(dialog.getByRole('heading', { name: 'Close trade' })).toBeVisible();
  const exit = dialog.getByRole('group', { name: 'Exit' });
  await expect(exit.getByLabel('Day')).toHaveValue('2026-10-21');
  await expect(exit.getByLabel('Price')).toBeFocused();
  await fillTrade(page, { exitPrice: '155.10', fees: '2' });
  await expect(status(page, 'Saved the AAPL trade: +$483.00.')).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Open trades' })).toBeHidden();
  await expect(tradeItem(page, 'AAPL').locator('[data-profit]')).toHaveText('+$483.00');
  await expect(tradeItem(page, 'AAPL').locator('[data-extra]')).toHaveText('+3.21% · +1.5R');
  await expect(tile(page, 'Net result')).toHaveText('+$483.00');
  await expect(tile(page, 'Closed trades')).toHaveText('1');
  await expect(tile(page, 'Win rate')).toHaveText('100%');
  await expect(page.locator('.tile').filter({ hasText: 'Profit factor' })).toContainText(
    'No losses yet',
  );
  await checkA11y(page, 'results');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'results (dark)');

  await page.reload();
  await expect(tile(page, 'Net result')).toHaveText('+$483.00');
});

test('checks the trade form', async ({ page }) => {
  await page.getByRole('button', { name: 'New trade' }).click();
  const dialog = tradeDialog(page);
  await fillTrade(page, {
    symbol: 'TSLA',
    side: 'Short',
    entryPrice: '260',
    quantity: '0',
    stop: '255',
  });
  await expect(dialog.getByText('Enter a number above 0.')).toBeVisible();
  await expect(
    dialog.getByText('For a short trade, the stop loss is above the entry price.'),
  ).toBeVisible();
  await fillTrade(page, { quantity: '20', stop: '265', exitPrice: '250' });
  await expect(dialog.getByText('Choose the day you exited, or leave both empty.')).toBeVisible();
  await fillTrade(page, { exitDate: '2026-10-20' });
  await expect(dialog.getByText('The exit can’t be before the entry.')).toBeVisible();
  await fillTrade(page, { entryDate: '2026-10-19' });
  await expect(dialog).toBeHidden();
  await expect(tradeItem(page, 'TSLA').locator('[data-profit]')).toHaveText('+$200.00');
  await expect(tradeItem(page, 'TSLA').locator('[data-side]')).toHaveText('Short');
});

test('results for a period, by setup and by month, and search', async ({ page }) => {
  await seed(page, [
    trade({ symbol: 'AAPL', exitPrice: 120, setup: 'Breakout', exitDate: '2026-10-05' }),
    trade({ symbol: 'MSFT', exitPrice: 95, setup: 'Breakout', exitDate: '2026-10-10' }),
    trade({
      symbol: 'EURUSD',
      exitPrice: 130,
      setup: 'Pullback',
      exitDate: '2026-09-20',
      notes: 'Waited for the retest',
    }),
    trade({ symbol: 'NVDA', exitPrice: 90, exitDate: '2025-12-30' }),
  ]);
  await expect(tile(page, 'Net result')).toHaveText('+$350.00');
  await expect(tile(page, 'Closed trades')).toHaveText('4');
  await expect(tile(page, 'Win rate')).toHaveText('50%');
  await expect(tile(page, 'Profit factor')).toHaveText('3.33');
  await expect(tile(page, 'Average loss')).toHaveText('-$75.00');
  await expect(page.locator('[data-setups] li')).toHaveText([
    /Pullback\s*\+\$300\.00\s*1 trade, 100% won/,
    /Breakout\s*\+\$150\.00\s*2 trades, 50% won/,
    /No setup\s*-\$100\.00\s*1 trade, 0% won/,
  ]);
  await expect(page.locator('[data-months] li [data-group-name]')).toHaveText([
    'October 2026',
    'September 2026',
    'December 2025',
  ]);
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText([
    'MSFT',
    'AAPL',
    'EURUSD',
    'NVDA',
  ]);

  await page.getByLabel('Results for').selectOption({ label: 'This month' });
  await expect(tile(page, 'Net result')).toHaveText('+$150.00');
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['MSFT', 'AAPL']);
  await page.getByLabel('Results for').selectOption({ label: 'Last month' });
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['EURUSD']);

  await page.getByLabel('Results for').selectOption({ label: 'All time' });
  await page.getByLabel('Search').fill('retest');
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['EURUSD']);
  await page.getByLabel('Search').fill('breakout');
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['MSFT', 'AAPL']);
  await page.getByLabel('Search').fill('gold');
  await expect(page.getByText('No closed trades match your search.')).toBeVisible();
  await checkA11y(page, 'search');
});

test('changes and deletes a trade', async ({ page }) => {
  await seed(page, [trade({ symbol: 'AAPL', exitPrice: 110 })]);
  await page.getByRole('button', { name: 'AAPL Long' }).click();
  const dialog = tradeDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Change trade' })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Exit' }).getByLabel('Price')).toHaveValue('110');
  await fillTrade(page, { exitPrice: '120', setup: 'Gap up' });
  await expect(tradeItem(page, 'AAPL').locator('[data-profit]')).toHaveText('+$200.00');
  await expect(tradeItem(page, 'AAPL').locator('[data-setup]')).toHaveText('Setup: Gap up');

  // The setups used so far are suggested.
  await expect(page.locator('[data-setup-names] option')).toHaveText(['Gap up']);

  // Deleting asks first.
  await page.getByRole('button', { name: 'AAPL Long' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this trade?' });
  await expect(confirm).toContainText('The AAPL long trade will be removed from your journal.');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(status(page, 'Deleted the AAPL trade.')).toBeAttached();
  await expect(page.getByText('No closed trades yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New trade' })).toBeFocused();
});

test('the currency, and a spreadsheet of the trades', async ({ page }) => {
  await seed(page, [trade({ symbol: 'AAPL', exitPrice: 110, notes: 'Good, "clean" entry' })]);
  await page.getByLabel('Currency', { exact: true }).selectOption('EUR');
  await expect(status(page, 'Amounts are shown in EUR now.')).toBeAttached();
  await expect(tile(page, 'Net result')).toHaveText('+€100.00');
  await page.reload();
  await expect(page.getByLabel('Currency', { exact: true })).toHaveValue('EUR');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('trades-2026-10-21.csv');
  const text = await readFile((await file.path()) ?? '', 'utf8');
  expect(text.split('\r\n').slice(0, 2)).toEqual([
    'Symbol,Side,Entry date,Entry price,Quantity,Stop loss,Exit date,Exit price,Fees,Net result,Return %,R,Setup,Notes',
    'AAPL,Long,2026-10-01,100,10,,2026-10-05,110,0,100,10,,,"Good, ""clean"" entry"',
  ]);
});
