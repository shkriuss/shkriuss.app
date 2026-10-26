// Budget's own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { LIMITS } from '../src/lib/budget.ts';
import {
  addCategory,
  addEntry,
  categoryButton,
  categoryDialog,
  categoryItem,
  entry,
  entryDialog,
  entryItems,
  fillEntry,
  NOW,
  savedEntries,
  seed,
  TIME_ZONE,
  total,
  yearDialog,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

test('categories with monthly limits, and spending against them', async ({ page }) => {
  await expect(page.locator('[data-month-heading]')).toHaveText('October 2026');
  await expect(page.getByText('Nothing this month yet.')).toBeVisible();
  await expect(page.getByText('No categories yet.', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Add suggested categories' }).click();
  await expect(status(page, 'Added 8 categories.')).toBeAttached();
  await expect(page.locator('[data-categories] .category__name')).toHaveText([
    'Groceries',
    'Eating out',
    'Home',
    'Bills',
    'Transport',
    'Health',
    'Fun',
    'Other',
  ]);
  await expect(categoryButton(page, 'Groceries')).toBeFocused();

  // A limit for one.
  await categoryButton(page, 'Groceries').click();
  await expect(
    categoryDialog(page).getByRole('heading', { name: 'Change category' }),
  ).toBeVisible();
  await categoryDialog(page).getByLabel('Monthly limit (optional)').fill('400');
  await categoryDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(status(page, 'Saved Groceries.')).toBeAttached();
  await expect(categoryItem(page, 'Groceries')).toContainText('$400.00 left of $400.00');

  // Checked before it's saved.
  await addCategory(page, '');
  await expect(categoryDialog(page).getByText('Enter a name for the category.')).toBeVisible();
  await categoryDialog(page).getByLabel('Name').fill('groceries');
  await categoryDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(
    categoryDialog(page).getByText('You already have a category with that name.'),
  ).toBeVisible();
  await checkA11y(page, 'category form');
  await categoryDialog(page).getByRole('button', { name: 'Cancel' }).click();

  // Spending and income.
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(entryDialog(page).getByLabel('Amount')).toBeFocused();
  await expect(entryDialog(page).getByLabel('Day')).toHaveValue('2026-10-21');
  await entryDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(entryDialog(page).getByText('Enter an amount.')).toBeVisible();
  await checkA11y(page, 'entry form');
  await fillEntry(page, { amount: '84.30', category: 'Groceries', note: 'Weekly shop' });
  await expect(status(page, 'Saved $84.30 on Groceries.')).toBeAttached();
  await expect(entryItems(page)).toHaveText([/Groceries\s*Wed, Oct 21 · Weekly shop\s*-\$84\.30/]);
  await expect(categoryItem(page, 'Groceries')).toContainText('$315.70 left of $400.00');
  await expect(total(page, 'Spent')).toHaveText('$84.30');

  await addEntry(page, { kind: 'income', amount: '2500', note: 'Salary' });
  await expect(status(page, 'Saved $2,500.00 income.')).toBeAttached();
  await expect(total(page, 'Income')).toHaveText('$2,500.00');
  await expect(total(page, 'Left')).toHaveText('+$2,415.70');
  await expect(page.locator('[data-budget-text]')).toHaveText(
    '$315.70 left of the $400.00 budgeted',
  );

  // Over the limit.
  await addEntry(page, { amount: '350', category: 'Groceries' });
  await expect(categoryItem(page, 'Groceries')).toContainText('$34.30 over the $400.00 limit');
  await expect(categoryItem(page, 'Groceries')).toHaveClass(/category--over/);
  await checkA11y(page, 'budget');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'budget (dark)');

  await page.reload();
  await expect(total(page, 'Spent')).toHaveText('$434.30');
});

test('changes and deletes entries and categories', async ({ page }) => {
  await seed(page, {
    categories: [
      { id: 'g', name: 'Groceries', limit: 400 },
      { id: 'f', name: 'Fun', limit: null },
    ],
    entries: [
      entry({ id: 'a', amount: 20, category: 'g', note: 'Bread' }),
      entry({ id: 'b', amount: 15, category: 'f', date: '2026-10-20' }),
    ],
  });

  await entryItems(page).first().getByRole('button').click();
  await expect(entryDialog(page).getByRole('heading', { name: 'Change entry' })).toBeVisible();
  await expect(entryDialog(page).getByLabel('Amount')).toHaveValue('20');
  await fillEntry(page, { amount: '22.5', category: 'Fun' });
  await expect(entryItems(page).first()).toContainText('Fun');
  await expect(entryItems(page).first()).toContainText('-$22.50');
  await expect(categoryItem(page, 'Fun')).toContainText('$37.50');

  // Deleting asks first.
  await entryItems(page).first().getByRole('button').click();
  await entryDialog(page).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this entry?' });
  await expect(confirm).toContainText('$22.50 (Fun, Wed, Oct 21) will be removed.');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(entryItems(page)).toHaveCount(1);

  // A deleted category's expenses stay, under "No category".
  await categoryButton(page, 'Fun').click();
  await categoryDialog(page).getByRole('button', { name: 'Delete' }).click();
  const confirmCategory = page.getByRole('dialog', { name: 'Delete this category?' });
  await expect(confirmCategory).toContainText('Its expenses stay, under “No category”.');
  await confirmCategory.getByRole('button', { name: 'Delete' }).click();
  await expect(status(page, 'Deleted Fun.')).toBeAttached();
  await expect(page.locator('[data-categories] .category__name')).toHaveText([
    'Groceries',
    'No category',
  ]);
  await expect(entryItems(page).first()).toContainText('No category');
});

// Audit 3 F2-1: the form saved every field as it was when it opened, so the
// other tab's (or another device's) change to the entry was put back.
test('a change made in another tab survives a form that was open here', async ({ page }) => {
  await seed(page, {
    categories: [{ id: 'g', name: 'Groceries', limit: null }],
    entries: [entry({ id: 'a', amount: 20, category: 'g', note: 'Bread' })],
  });
  const other = await page.context().newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto('/');

  // Here: the entry's form is opened (to change the note).
  await entryItems(page).first().getByRole('button').click();
  await expect(entryDialog(page).getByLabel('Amount')).toHaveValue('20');
  // In the other tab: the amount is corrected to 25. This tab has it too, behind the form.
  await entryItems(other).first().getByRole('button').click();
  await fillEntry(other, { amount: '25' });
  await expect(entryItems(page).first()).toContainText('-$25.00');

  // Here, the form is saved with a new note: the other tab's 25 stays.
  await fillEntry(page, { note: 'Bread and milk' });
  await expect(entryItems(page).first()).toContainText('Bread and milk');
  await expect(entryItems(page).first()).toContainText('-$25.00');
  await other.reload();
  await expect(entryItems(other).first()).toContainText('-$25.00');

  // A category's limit, changed there while its name is changed here, the same way.
  await categoryButton(page, 'Groceries').click();
  await categoryButton(other, 'Groceries').click();
  await categoryDialog(other).getByLabel('Monthly limit (optional)').fill('300');
  await categoryDialog(other).getByRole('button', { name: 'Save' }).click();
  await expect(categoryItem(page, 'Groceries')).toContainText('of $300.00');
  await categoryDialog(page).getByLabel('Name').fill('Food');
  await categoryDialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(categoryItem(page, 'Food')).toContainText('of $300.00');
});

// Audit 3 G-6: the form closed by itself, and what was typed was gone, without a word.
test('says so when the entry being changed is deleted in another tab', async ({ page }) => {
  await seed(page, { entries: [entry({ id: 'a', amount: 20, note: 'Bread' })] });
  const other = await page.context().newPage();
  await other.clock.setFixedTime(NOW);
  await other.goto('/');
  await entryItems(page).first().getByRole('button').click();
  await entryDialog(page).getByLabel('Note (optional)').fill('Bread and milk');

  await entryItems(other).first().getByRole('button').click();
  await entryDialog(other).getByRole('button', { name: 'Delete' }).click();
  await other
    .getByRole('dialog', { name: 'Delete this entry?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(entryDialog(page)).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText('That entry was deleted on another device.');
  await expect(entryItems(page)).toHaveCount(0);
});

test('moves between months', async ({ page }) => {
  await seed(page, {
    entries: [
      entry({ amount: 30, date: '2026-09-12', note: 'September thing' }),
      entry({ amount: 10, note: 'October thing' }),
    ],
  });
  await expect(entryItems(page)).toHaveText([/October thing/]);
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('[data-month-heading]')).toHaveText('September 2026');
  await expect(entryItems(page)).toHaveText([/September thing/]);
  await expect(total(page, 'Spent')).toHaveText('$30.00');

  // A new entry while looking at September starts on its first day.
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(entryDialog(page).getByLabel('Day')).toHaveValue('2026-09-01');
  // Saved in another month: that month is shown.
  await fillEntry(page, { amount: '5', date: '2026-11-02' });
  await expect(status(page, 'Saved $5.00 on No category, in November 2026.')).toBeAttached();
  await expect(page.locator('[data-month-heading]')).toHaveText('November 2026');

  await page.getByRole('button', { name: 'This month' }).click();
  await expect(page.locator('[data-month-heading]')).toHaveText('October 2026');
  await expect(page.locator('[data-month-heading]')).toBeFocused();
  await expect(page.getByRole('button', { name: 'This month' })).toBeHidden();
});

test('the currency, and a spreadsheet of the entries', async ({ page }) => {
  await seed(page, {
    categories: [{ id: 'g', name: 'Groceries', limit: null }],
    entries: [
      entry({ amount: 12.5, category: 'g', note: 'Milk, "fresh"' }),
      entry({ kind: 'income', amount: 100, date: '2026-10-22', note: 'Gift' }),
      entry({ kind: 'refund', amount: 2.5, category: 'g', date: '2026-10-23' }),
    ],
  });
  await page.getByLabel('Currency', { exact: true }).selectOption('GEL');
  await expect(status(page, 'Amounts are shown in GEL now.')).toBeAttached();
  await expect(total(page, 'Spent')).toHaveText(/^GEL\s10\.00$/);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('budget-2026-10-21.csv');
  const text = await readFile((await file.path()) ?? '', 'utf8');
  expect(text.split('\r\n')).toEqual([
    // A byte-order mark first, for Excel (audit 3 F2-6).
    '\uFEFFDate,Type,Amount,Category,Note',
    '2026-10-23,Refund,2.5,Groceries,',
    '2026-10-22,Income,100,,Gift',
    '2026-10-21,Expense,-12.5,Groceries,"Milk, ""fresh"""',
    '',
  ]);
});

test('a refund comes off its category’s spending', async ({ page }) => {
  // Saved by Budget before refunds (data version 1): still read.
  await seed(page, {
    version: 1,
    categories: [{ id: 'g', name: 'Groceries', limit: 100 }],
    entries: [entry({ amount: 120, category: 'g', date: '2026-10-02', note: 'Big shop' })],
  });
  await expect(categoryItem(page, 'Groceries')).toContainText('$20.00 over the $100.00 limit');

  await page.getByRole('button', { name: 'Add expense' }).click();
  const dialog = entryDialog(page);
  await dialog.getByLabel('Refund', { exact: true }).check();
  await expect(dialog.getByRole('heading', { name: 'Add refund' })).toBeVisible();
  await expect(dialog.getByLabel('Category')).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'Type' })).toHaveAccessibleDescription(
    'A refund is money back for something you bought: it comes off that category’s spending.',
  );
  await checkA11y(page, 'refund form');
  await fillEntry(page, { amount: '30', category: 'Groceries', note: 'Returned the melon' });
  await expect(status(page, 'Saved a $30.00 refund on Groceries.')).toBeAttached();

  await expect(entryItems(page).first()).toHaveText(
    /Refund · Groceries\s*Wed, Oct 21 · Returned the melon\s*\+\$30\.00/,
  );
  await expect(categoryItem(page, 'Groceries')).toContainText('$10.00 left of $100.00');
  await expect(categoryItem(page, 'Groceries')).not.toHaveClass(/category--over/);
  await expect(total(page, 'Spent')).toHaveText('$90.00');
  await expect(total(page, 'Left')).toHaveText('-$90.00');
  // Saved in the new version.
  expect(await savedEntries(page)).toEqual({ version: 2, count: 2 });

  // Changing it shows it's a refund, and deleting says so.
  await entryItems(page).first().getByRole('button').click();
  await expect(dialog.getByRole('heading', { name: 'Change entry' })).toBeVisible();
  await expect(dialog.getByLabel('Refund', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this entry?' })).toContainText(
    '$30.00 refund (Groceries, Wed, Oct 21) will be removed.',
  );
});

test('deletes a year, after saying what it deletes', async ({ page }) => {
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await expect(status(page, 'There are no entries to delete.')).toBeVisible();

  await seed(page, {
    entries: [
      entry({ date: '2024-03-02' }),
      entry({ date: '2024-12-31', kind: 'income' }),
      entry({ date: '2025-06-01' }),
      entry({ note: 'This month' }),
    ],
  });
  const deleteYear = page.getByRole('button', { name: 'Delete a year…' });
  await deleteYear.click();
  const dialog = yearDialog(page);
  const year = dialog.getByLabel('Year');
  await expect(year).toBeFocused();
  await expect(year.locator('option')).toHaveText([
    '2024 (2 entries)',
    '2025 (1 entry)',
    '2026 (1 entry)',
  ]);
  // The oldest year to begin with.
  await expect(year).toHaveValue('2024');
  await expect(dialog.locator('[data-year-text]')).toHaveText(
    'The 2 entries from 2024 will be deleted: expenses, income and refunds. With sync on, they’re deleted on your other devices too. This can’t be undone.',
  );
  await expect(dialog.getByRole('button', { name: 'Delete 2 entries' })).toBeVisible();
  await checkA11y(page, 'delete a year');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'delete a year (dark)');

  // The spreadsheet first, from the dialog.
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click();
  expect((await download).suggestedFilename()).toBe('budget-2026-10-21.csv');
  await expect(dialog.getByRole('status')).toHaveText('Downloaded your budget as a spreadsheet.');

  await year.selectOption('2025');
  await expect(dialog.getByRole('button', { name: 'Delete 1 entry' })).toBeVisible();
  // Cancel deletes nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  expect((await savedEntries(page)).count).toBe(4);

  await deleteYear.click();
  await dialog.getByRole('button', { name: 'Delete 2 entries' }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page, 'Deleted 2 entries from 2024.')).toBeAttached();
  await expect(deleteYear).toBeFocused();
  expect((await savedEntries(page)).count).toBe(2);
  await expect(entryItems(page)).toHaveText([/This month/]);
  await deleteYear.click();
  await expect(year.locator('option')).toHaveText(['2025 (1 entry)', '2026 (1 entry)']);
});

test('says when Budget is nearly full, and how to make room', async ({ page }) => {
  // Just over 90% of the entries Budget keeps: one a day, back from 2026.
  const count = LIMITS.entries * 0.9 + 1;
  await page.evaluate((count) => {
    const day = Date.UTC(2026, 9, 21);
    const entries = Array.from({ length: count }, (_, index) => ({
      id: `e${index}`,
      kind: 'expense',
      amount: 10,
      date: new Date(day - index * 86_400_000).toISOString().slice(0, 10),
      category: null,
      note: '',
    }));
    localStorage.setItem('shkriuss:budget', JSON.stringify({ v: 2, data: { entries } }));
  }, count);
  await page.reload();
  const note = page.locator('[data-room-note]');
  await expect(note).toHaveText(
    `Budget is nearly full: there’s room for ${LIMITS.entries - count} more entries (it keeps up to ${new Intl.NumberFormat('en-US').format(LIMITS.entries)}). To make room, download the spreadsheet, then use “Delete a year…” under Currency and spreadsheet, below.`,
  );
  await checkA11y(page, 'nearly full');

  // Deleting the oldest year makes room.
  await page.getByRole('button', { name: 'Delete a year…' }).click();
  await yearDialog(page)
    .getByRole('button', { name: /^Delete \d+ entr/ })
    .click();
  await expect(status(page, /^Deleted \d+ entries from \d{4}\.$/)).toBeAttached();
  await expect(note).toBeHidden();
});

test('shows a note in Hebrew or Arabic the right way round', async ({ page }) => {
  await seed(page, {
    categories: [{ id: 'g', name: 'מכולת', limit: null }],
    entries: [entry({ id: 'a', amount: 20, category: 'g', note: 'לחם וחלב!' })],
  });
  const item = entryItems(page).first();
  await expect(item).toContainText('לחם וחלב!');
  const rightToLeft = (selector: string) =>
    item.locator(selector).evaluate((element) => element.matches(':dir(rtl)'));
  // The note keeps its own direction inside a line that's otherwise English.
  expect(await rightToLeft('[data-meta] bdi')).toBe(true);
  expect(await rightToLeft('[data-meta]')).toBe(false);
  expect(await rightToLeft('[data-title]')).toBe(true);
  await item.getByRole('button').click();
  await expect(entryDialog(page).getByLabel('Note (optional)')).toHaveValue('לחם וחלב!');
  expect(
    await entryDialog(page)
      .getByLabel('Note (optional)')
      .evaluate((element) => element.matches(':dir(rtl)')),
  ).toBe(true);
});
