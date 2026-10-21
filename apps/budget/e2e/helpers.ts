// Shared by Budget's browser tests: the day it is, finding things on the
// page, filling in the forms, and saving a budget straight into storage.
import type { Page } from '@playwright/test';
import type { Category, Entry } from '../src/lib/budget.ts';

/** Wednesday 21 October 2026, 10:00 in Tbilisi (the tests' time zone). */
export const NOW = new Date('2026-10-21T10:00:00+04:00');
export const TIME_ZONE = 'Asia/Tbilisi';

export const entryDialog = (page: Page) => page.locator('[data-entry-dialog]');
export const categoryDialog = (page: Page) => page.locator('[data-category-dialog]');
/** A category in the list, by its name. */
export const categoryItem = (page: Page, name: string) =>
  page.locator('[data-categories] li').filter({ hasText: name });
/** The button that opens a category, by its exact name. */
export const categoryButton = (page: Page, name: string) =>
  page.locator('[data-categories]').getByRole('button', { name, exact: true });
export const entryItems = (page: Page) => page.locator('[data-entries] li');
export const total = (page: Page, label: 'Spent' | 'Income' | 'Left') =>
  page
    .locator('.total')
    .filter({ has: page.getByRole('term').getByText(label, { exact: true }) })
    .locator('dd');

/** "Add expense" or "Add income", filled in and saved. */
export async function addEntry(
  page: Page,
  fields: {
    kind?: 'expense' | 'income';
    amount: string;
    date?: string;
    category?: string;
    note?: string;
  },
): Promise<void> {
  await page
    .getByRole('button', { name: fields.kind === 'income' ? 'Add income' : 'Add expense' })
    .click();
  await fillEntry(page, fields);
}

/** Fills in the open entry form (only the fields given) and saves. */
export async function fillEntry(
  page: Page,
  fields: { amount?: string; date?: string; category?: string; note?: string },
): Promise<void> {
  const dialog = entryDialog(page);
  if (fields.amount !== undefined) await dialog.getByLabel('Amount').fill(fields.amount);
  if (fields.date !== undefined) await dialog.getByLabel('Day').fill(fields.date);
  if (fields.category !== undefined) {
    await dialog.getByLabel('Category').selectOption({ label: fields.category });
  }
  if (fields.note !== undefined) await dialog.getByLabel('Note (optional)').fill(fields.note);
  await dialog.getByRole('button', { name: 'Save' }).click();
}

/** "New category", filled in and saved. */
export async function addCategory(page: Page, name: string, limit = ''): Promise<void> {
  await page.getByRole('button', { name: 'New category' }).click();
  await categoryDialog(page).getByLabel('Name').fill(name);
  await categoryDialog(page).getByLabel('Monthly limit (optional)').fill(limit);
  await categoryDialog(page).getByRole('button', { name: 'Save' }).click();
}

export const entry = (overrides: Partial<Entry>): Entry => ({
  id: crypto.randomUUID(),
  kind: 'expense',
  amount: 10,
  date: '2026-10-21',
  category: null,
  note: '',
  ...overrides,
});

/** Saves categories and entries straight into storage, then reloads. */
export async function seed(
  page: Page,
  data: { categories?: Category[]; entries?: Entry[] },
): Promise<void> {
  await page.evaluate(({ categories = [], entries = [] }) => {
    localStorage.setItem(
      'shkriuss:budget-categories',
      JSON.stringify({ v: 1, data: { categories } }),
    );
    localStorage.setItem('shkriuss:budget', JSON.stringify({ v: 1, data: { entries } }));
  }, data);
  await page.reload();
}
