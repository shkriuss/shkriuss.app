// Budget's own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
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
  seed,
  TIME_ZONE,
  total,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

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
      entry({ kind: 'income', amount: 100, date: '2026-10-22', note: 'Refund' }),
    ],
  });
  await page.getByLabel('Currency', { exact: true }).selectOption('GEL');
  await expect(status(page, 'Amounts are shown in GEL now.')).toBeAttached();
  await expect(total(page, 'Spent')).toHaveText(/^GEL\s12\.50$/);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download as a spreadsheet (CSV)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('budget-2026-10-21.csv');
  const text = await readFile((await file.path()) ?? '', 'utf8');
  expect(text.split('\r\n')).toEqual([
    'Date,Type,Amount,Category,Note',
    '2026-10-22,Income,100,,Refund',
    '2026-10-21,Expense,-12.5,Groceries,"Milk, ""fresh"""',
    '',
  ]);
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
