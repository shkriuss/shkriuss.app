// Trades' own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { paste } from '../../../tests/e2e/clipboard.ts';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { LIMITS } from '../src/lib/trades.ts';
import {
  fillTrade,
  NOW,
  seed,
  tile,
  TIME_ZONE,
  trade,
  tradeDialog,
  tradeItem,
  yearDialog,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

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
  // Read out, as every result changed (audit 4 G-9).
  await expect(status(page, 'This month: 2 closed trades, net result +$150.00.')).toBeAttached();
  await page.getByLabel('Results for').selectOption({ label: 'Last month' });
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['EURUSD']);
  await expect(status(page, 'Last month: 1 closed trade, net result +$300.00.')).toBeAttached();

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
  await expect(confirm).toContainText(
    'The AAPL long trade will be removed from your journal. This can’t be undone.',
  );
  // Read out with the title, before "Cancel" (audit 5 G-3).
  await expect(confirm).toHaveAccessibleDescription(
    /^The AAPL long trade will be removed from your journal\. This\s+can’t be undone\.\s*$/,
  );
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
    // A byte-order mark first, for Excel (audit 3 F2-6).
    '\uFEFFSymbol,Side,Entry date,Entry price,Quantity,Stop loss,Exit date,Exit price,Fees,Net result,Return %,R,Setup,Notes',
    'AAPL,Long,2026-10-01,100,10,,2026-10-05,110,0,100,10,,,"Good, ""clean"" entry"',
  ]);

  // Downloaded again: read out again, as the same words with a no-break
  // space, which can't be heard, on the end (audit 5 G-8).
  const said = page
    .getByRole('status')
    .filter({ hasText: 'Downloaded your trades as a spreadsheet.' });
  expect(await said.textContent()).toBe('Downloaded your trades as a spreadsheet.');
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click();
  await again;
  await expect
    .poll(() => said.textContent())
    .toBe('Downloaded your trades as a spreadsheet.\u00A0');
});

test('closes part of a trade, then the rest', async ({ page }) => {
  await seed(page, [
    trade({
      symbol: 'AAPL',
      entryPrice: 150,
      quantity: 100,
      stop: 145,
      exitDate: null,
      exitPrice: null,
      fees: 1,
    }),
  ]);
  const dialog = tradeDialog(page);
  const exit = dialog.getByRole('group', { name: 'Exit' });
  const closed = page.locator('[data-closed-list]');

  // "Quantity closed" is only there while closing.
  await page.getByRole('button', { name: 'AAPL Long' }).click();
  await expect(exit.getByLabel('Quantity closed')).toBeHidden();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Close the AAPL trade' }).click();
  const quantity = exit.getByLabel('Quantity closed');
  await expect(quantity).toHaveValue('100');
  await expect(exit.getByLabel('Fees (optional)')).toHaveValue('1');
  await expect(quantity).toHaveAccessibleDescription('Less than all of it? The rest stays open.');
  await fillTrade(page, { closeQuantity: '101', exitPrice: '160', fees: '2' });
  await expect(dialog.getByText('Enter no more than the trade’s quantity.')).toBeVisible();
  await expect(quantity).toBeFocused();
  await checkA11y(page, 'closing part of a trade');

  await fillTrade(page, { closeQuantity: '40' });
  await expect(
    status(page, 'Closed 40 of the AAPL trade: +$398.00. 60 still open.'),
  ).toBeAttached();
  await expect(page.locator('[data-open-list] li')).toHaveText([/60 at 150, since Oct 1, 2026/]);
  await expect(closed.locator('li')).toHaveCount(1);
  await expect(closed.locator('[data-meta]')).toHaveText('40 · 150 → 160 · Oct 21, 2026');
  await expect(closed.locator('[data-profit]')).toHaveText('+$398.00');
  await expect(closed.locator('[data-extra]')).toHaveText('+6.63% · +2.0R');
  await expect(closed.getByRole('button', { name: 'AAPL Long' })).toBeFocused();

  // The rest, all of it (no fees left: they were the first part's). The
  // trade still says what was bought.
  await page.getByRole('button', { name: 'Close the AAPL trade' }).click();
  await expect(quantity).toHaveValue('60');
  await expect(dialog.getByRole('group', { name: 'Entry' }).getByLabel('Quantity')).toHaveValue(
    '100',
  );
  await expect(exit.getByLabel('Fees (optional)')).toHaveValue('');
  await fillTrade(page, { exitPrice: '155' });
  await expect(status(page, 'Closed the rest of the AAPL trade: +$300.00.')).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Open trades' })).toBeHidden();
  await expect(closed.locator('li')).toHaveCount(2);
  await expect(tile(page, 'Net result')).toHaveText('+$698.00');
  await expect(tile(page, 'Closed trades')).toHaveText('2');

  // Deleting a part: what it closed is open again.
  await closed.getByRole('button', { name: 'AAPL Long' }).first().click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this trade?' });
  await expect(confirm).toContainText('count as open again, in the AAPL trade.');
  // What becomes of the trade is read out with the title too (audit 5 G-3).
  await expect(confirm).toHaveAccessibleDescription(
    /can’t be undone\.\s+The 40 it closed count as open again, in the AAPL trade\.$/,
  );
  await confirm.getByRole('button', { name: 'Delete' }).click();
  // The 40 of the first part (audit 3 F2-11: any number passed).
  await expect(page.locator('[data-open-list] [data-meta]')).toHaveText(
    '40 at 150, since Oct 1, 2026',
  );
});

// Audit 3 F2-10: a part kept the trade's entry price as it was when it was
// closed, so putting a typo right left its result wrong.
test('a trade’s entry price put right changes its parts closed already', async ({ page }) => {
  const lot = trade({ id: 'lot', entryPrice: 15, quantity: 100, exitDate: null, exitPrice: null });
  await seed(page, [
    lot,
    { ...lot, id: 'part', quantity: 40, exitDate: '2026-10-05', exitPrice: 160, parent: 'lot' },
  ]);
  // Parts count as closed trades: the page says so.
  await expect(page.locator('[data-parts-note]')).toHaveText(
    'A trade closed in parts counts as a closed trade for each part, here and below.',
  );
  const closed = page.locator('[data-closed-list]');
  await expect(closed.locator('[data-profit]')).toHaveText('+$5,800.00');
  await page.locator('[data-open-list]').getByRole('button', { name: 'AAPL Long' }).click();
  await fillTrade(page, { entryPrice: '150' });
  await expect(
    status(page, 'Saved the AAPL trade, still open. Its closed part changed with it.'),
  ).toBeAttached();
  await expect(closed.locator('[data-meta]')).toHaveText('40 · 150 → 160 · Oct 5, 2026');
  await expect(closed.locator('[data-profit]')).toHaveText('+$400.00');
  await expect(tile(page, 'Net result')).toHaveText('+$400.00');
});

// Audit F2-4: what two devices closed at once, before they synced, is never
// counted twice without a word.
test('says when more of a trade was closed than bought', async ({ page }) => {
  const lot = trade({
    id: 'aapl',
    entryPrice: 150,
    quantity: 100,
    exitDate: null,
    exitPrice: null,
  });
  await seed(page, [
    lot,
    trade({ id: 'p1', entryPrice: 150, quantity: 40, exitPrice: 160, parent: 'aapl' }),
    trade({ id: 'p2', entryPrice: 150, quantity: 60, exitPrice: 160, parent: 'aapl' }),
    trade({ id: 'p3', entryPrice: 150, quantity: 60, exitPrice: 158, parent: 'aapl' }),
  ]);
  const note =
    '160 closed of the 100 bought: two devices may have closed it at the same time. Delete the close that’s wrong.';
  const open = page.locator('[data-open-list] li');
  await expect(open.locator('[data-meta]')).toHaveText('100 at 150, since Oct 1, 2026');
  await expect(open.locator('[data-problem]')).toHaveText(note);
  // Nothing's left to close.
  await expect(page.getByRole('button', { name: 'Close the AAPL trade' })).toHaveCount(0);
  await expect(page.locator('[data-closed-list] [data-problem]')).toHaveText([note, note, note]);
  await checkA11y(page, 'closed more than bought');

  // Deleting the close that's wrong puts it right.
  await page.locator('li[data-id="p3"]').getByRole('button', { name: 'AAPL Long' }).click();
  await tradeDialog(page).getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this trade?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(status(page, 'Deleted the AAPL trade.')).toBeAttached();
  await expect(page.getByRole('heading', { name: 'Open trades' })).toBeHidden();
  await expect(page.locator('[data-problem]:not(:empty)')).toHaveCount(0);
});

test('deletes a year of closed trades, never open ones', async ({ page }) => {
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await expect(status(page, 'There are no closed trades to delete.')).toBeVisible();

  await seed(page, [
    trade({ symbol: 'AAPL', entryDate: '2024-02-01', exitDate: '2024-03-02' }),
    trade({ symbol: 'MSFT', entryDate: '2024-11-01', exitDate: '2024-12-31' }),
    trade({ symbol: 'NVDA', entryDate: '2024-12-30', exitDate: '2025-01-02' }),
    trade({ symbol: 'TSLA', entryDate: '2024-05-05', exitDate: null, exitPrice: null }),
  ]);
  const deleteYear = page.getByRole('button', { name: 'Delete a year…' });
  await deleteYear.click();
  const dialog = yearDialog(page);
  const year = dialog.getByLabel('Year');
  await expect(year).toBeFocused();
  await expect(year).toHaveAccessibleDescription(/^The year the trades were closed in\./);
  await expect(year.locator('option')).toHaveText([
    '2024 (2 closed trades)',
    '2025 (1 closed trade)',
  ]);
  await expect(year).toHaveValue('2024');
  await expect(dialog.locator('[data-year-text]')).toHaveText(
    'The 2 closed trades from 2024 will be deleted. Open trades stay. With sync on, they’re deleted on your other devices too. This can’t be undone.',
  );
  // Read out with the title (audit 5 G-3).
  await expect(dialog).toHaveAccessibleDescription(
    /^The 2 closed trades from 2024 will be deleted/,
  );
  await checkA11y(page, 'delete a year');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'delete a year (dark)');

  // The spreadsheet first, from the dialog.
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click();
  expect((await download).suggestedFilename()).toBe('trades-2026-10-21.csv');
  await expect(dialog.getByRole('status')).toHaveText('Downloaded your trades as a spreadsheet.');

  await year.selectOption('2025');
  await expect(dialog.getByRole('button', { name: 'Delete 1 closed trade' })).toBeVisible();
  await year.selectOption('2024');
  await dialog.getByRole('button', { name: 'Delete 2 closed trades' }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page, 'Deleted 2 closed trades from 2024.')).toBeAttached();
  await expect(deleteYear).toBeFocused();
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['NVDA']);
  // The open trade, entered in 2024, stays.
  await expect(page.locator('[data-open-list] [data-symbol]')).toHaveText(['TSLA']);
  await page.reload();
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['NVDA']);
});

// Audit 3 F2-2: deleting a year made the open trade smaller, so a change to it
// on a device that hadn't synced brought back what was deleted, as open.
test('deleting a year keeps what was closed of a trade still open', async ({ page }) => {
  const lot = trade({
    id: 'lot',
    symbol: 'AMD',
    entryDate: '2024-04-01',
    quantity: 100,
    exitDate: null,
    exitPrice: null,
  });
  await seed(page, [
    lot,
    { ...lot, id: 'part', quantity: 40, exitDate: '2024-06-03', exitPrice: 110, parent: 'lot' },
    trade({ symbol: 'AAPL', entryDate: '2024-02-01', exitDate: '2024-03-02' }),
  ]);
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  const dialog = yearDialog(page);
  await expect(dialog.getByLabel('Year').locator('option')).toHaveText(['2024 (1 closed trade)']);
  await expect(dialog.locator('[data-year-text]')).toHaveText(
    'The 1 closed trade from 2024 will be deleted. Open trades stay, and so does 1 closed trade from 2024 that’s part of one still open, until all of it is closed. With sync on, they’re deleted on your other devices too. This can’t be undone.',
  );
  await dialog.getByRole('button', { name: 'Delete 1 closed trade' }).click();
  await expect(status(page, 'Deleted 1 closed trade from 2024.')).toBeAttached();
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['AMD']);
  await expect(page.locator('[data-open-list] [data-meta]')).toHaveText(
    '60 at 100, since Apr 1, 2024',
  );
  // Nothing else from 2024 to delete now.
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await expect(status(page, 'There are no closed trades to delete.')).toBeVisible();
});

// Audit 4 F2-1: the dialog quietly moved to another year, and its red
// button then deleted that one, on every device.
test('“Delete a year…” closes, and says why, when its year changes in another tab', async ({
  page,
}) => {
  await seed(page, [
    trade({ symbol: 'AAPL', entryDate: '2024-02-01', exitDate: '2024-03-02' }),
    trade({ symbol: 'MSFT', entryDate: '2024-11-01', exitDate: '2024-12-31' }),
    trade({ symbol: 'NVDA', entryDate: '2026-01-02', exitDate: '2026-02-02' }),
    trade({ symbol: 'AMD', entryDate: '2026-03-02', exitDate: '2026-04-01' }),
  ]);
  const other = await page.context().newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto('/');
  const deleteYear = page.getByRole('button', { name: 'Delete a year…' });
  const dialog = yearDialog(page);

  // The year chosen is deleted there.
  await deleteYear.click();
  await expect(dialog.getByRole('button', { name: 'Delete 2 closed trades' })).toBeVisible();
  await other.getByRole('button', { name: 'Delete a year…' }).click();
  await yearDialog(other).getByRole('button', { name: 'Delete 2 closed trades' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText(
    'The closed trades from 2024 were deleted on another device.',
  );
  await expect(deleteYear).toBeFocused();
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveText(['AMD', 'NVDA']);

  // A trade is closed in the year chosen there: it would delete more than it said.
  await deleteYear.click();
  await expect(dialog.getByRole('button', { name: 'Delete 2 closed trades' })).toBeVisible();
  await other.getByRole('button', { name: 'New trade' }).click();
  await fillTrade(other, {
    symbol: 'TSLA',
    entryPrice: '200',
    quantity: '10',
    exitDate: '2026-10-21',
    exitPrice: '210',
  });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText(
    '2026 has 3 closed trades now, after changes on another device. Nothing was deleted.',
  );
  await expect(page.locator('[data-closed-list] [data-symbol]')).toHaveCount(3);
  await other.close();
});

test('says when Trades is nearly full, and how to make room', async ({ page }) => {
  // Just over 90% of the trades Trades keeps: one closed a day, back from 2026.
  const count = LIMITS.trades * 0.9 + 1;
  await seed(
    page,
    Array.from({ length: count }, (_, index) => {
      const day = new Date(Date.UTC(2026, 9, 21) - index * 86_400_000).toISOString();
      return trade({ id: `t${index}`, entryDate: day.slice(0, 10), exitDate: day.slice(0, 10) });
    }),
  );
  const note = page.locator('[data-room-note]');
  await expect(note).toHaveText(
    `Trades is nearly full: there’s room for ${LIMITS.trades - count} more trades (it keeps up to ${new Intl.NumberFormat('en-US').format(LIMITS.trades)}, open and closed). To make room, download the spreadsheet, then use “Delete a year…” under Currency and spreadsheet, below.`,
  );
  await checkA11y(page, 'nearly full');

  // Deleting the oldest year makes room.
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await yearDialog(page)
    .getByRole('button', { name: /^Delete \d+ closed trades$/ })
    .click();
  await expect(status(page, /^Deleted \d+ closed trades from \d{4}\.$/)).toBeAttached();
  await expect(note).toBeHidden();
});

// Audit 4 F2-7: the browser kept the start of a long paste without a word.
test('says when pasted notes don’t all fit', async ({ page }) => {
  await page.getByRole('button', { name: 'New trade' }).click();
  const dialog = tradeDialog(page);
  const notes = dialog.getByLabel('Notes (optional)');
  await expect(notes).toHaveAccessibleDescription('Up to 1,000 characters.');
  const text = `${'Entered on the retest of the range high. '.repeat(30)}LESSON: wait for the close.`;
  await paste(notes, text);
  await expect(notes).toHaveValue(text.slice(0, 1000));
  const cut =
    'Only part of that fit. This box takes up to 1,000 characters, so the rest wasn’t added.';
  await expect(dialog.getByText(cut, { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole('alert').filter({ hasText: `Notes (optional): ${cut}` }),
  ).toBeAttached();
  // Gone when the form opens again.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New trade' }).click();
  await expect(dialog.getByText(cut, { exact: true })).toBeHidden();
});
