// Shelf's own categories: rename, add and delete them (any of the starting
// ones too), and the items follow. Syncing them: e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { seedStores } from '../../../tests/e2e/storage.ts';
import { CATEGORIES_VERSION } from '../src/lib/categories.ts';
import { SHELF_VERSION, type Item } from '../src/lib/items.ts';

/** The ids of the categories Shelf starts with (lib/categories.ts). */
const STARTING = ['food', 'clothes', 'tech', 'care', 'personal', 'home', 'other'];

const itemForm = (page: Page) => page.getByRole('dialog', { name: /^(New|Edit) item$/ });
const categoryForm = (page: Page) => page.getByRole('dialog', { name: /^(New|Edit) category$/ });
const deleteDialog = (page: Page) => page.getByRole('dialog', { name: 'Delete this category?' });
const chips = (page: Page) => page.locator('[data-categories] button');
const chip = (page: Page, name: string) => chips(page).filter({ hasText: name });
const card = (page: Page, name: string) =>
  page
    .locator('[data-items] > li')
    .filter({ has: page.getByRole('button', { name: `Edit ${name}`, exact: true }) });
const badge = (page: Page, name: string) => card(page, name).locator('[data-category]');
const categoryFilter = (page: Page) => page.locator('[data-filters]').getByLabel('Category');

const sample = (item: Partial<Item>, index: number): Item => ({
  id: `seed-${index}`,
  name: 'Item',
  brand: '',
  category: 'food',
  opinion: 'use',
  price: null,
  currency: 'GEL',
  shop: '',
  link: '',
  variant: '',
  bought: null,
  notes: '',
  created: 1_000 + index,
  updated: 1_000 + index,
  ...item,
});

/** Saves items (and category changes) straight into storage, then reloads. */
async function seed(page: Page, items: Partial<Item>[], changes: unknown[] = []): Promise<void> {
  await seedStores(page, {
    shelf: { version: SHELF_VERSION, data: { items: items.map(sample) } },
    'shelf-categories': { version: CATEGORIES_VERSION, data: { changes } },
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('renames, adds and deletes categories, and the items follow', async ({ page }) => {
  await seed(page, [
    { name: 'Greek yogurt', category: 'food' },
    { name: 'Running shoes', category: 'clothes' },
    { name: 'Face cream', category: 'care' },
  ]);
  await expect(chips(page)).toHaveText([
    /^Clothes and shoes\s*1 item$/,
    /^Food and drink\s*1 item$/,
    /^Home\s*0 items$/,
    /^Other\s*0 items$/,
    /^Personal care\s*1 item$/,
    /^Personal items\s*0 items$/,
    /^Tech and appliances\s*0 items$/,
  ]);

  // Rename a starting one.
  await chip(page, 'Food and drink').click();
  await expect(categoryForm(page)).toHaveAccessibleName('Edit category');
  await expect(categoryForm(page).getByLabel('Name')).toBeFocused();
  await expect(categoryForm(page).getByLabel('Name')).toHaveValue('Food and drink');
  await categoryForm(page).getByLabel('Name').fill('Groceries');
  await categoryForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(categoryForm(page)).toBeHidden();
  await expect(chip(page, 'Groceries')).toBeFocused();
  await expect(badge(page, 'Greek yogurt')).toHaveText('Groceries');
  await expect(categoryFilter(page).locator('option', { hasText: 'Groceries' })).toHaveCount(1);
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved category Groceries.' }),
  ).toBeAttached();

  // Add one of your own; names can't be used twice.
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(categoryForm(page)).toHaveAccessibleName('New category');
  await expect(categoryForm(page).getByRole('button', { name: 'Delete' })).toBeHidden();
  await categoryForm(page).getByLabel('Name').fill('home ');
  await categoryForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(
    categoryForm(page).getByText('You already have a category called “Home”.'),
  ).toBeVisible();
  await expect(categoryForm(page).getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
  await categoryForm(page).getByLabel('Name').fill('Books');
  await expect(categoryForm(page).getByText('You already have')).toBeHidden();
  await categoryForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(chip(page, 'Books')).toHaveText(/^Books\s*0 items$/);
  // In alphabetical order with the others.
  await expect(chips(page).first()).toHaveText(/^Books/);

  // New items can go in it.
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(itemForm(page).getByLabel('Category')).toHaveValue('');
  await itemForm(page).getByLabel('Name').fill('A novel');
  await itemForm(page).getByLabel('Category').selectOption({ label: 'Books' });
  await itemForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(badge(page, 'A novel')).toHaveText('Books');
  await expect(chip(page, 'Books')).toHaveText(/^Books\s*1 item$/);

  // Delete a category, moving its items to another.
  await chip(page, 'Clothes and shoes').click();
  await categoryForm(page).getByRole('button', { name: 'Delete' }).click();
  await expect(deleteDialog(page)).toContainText(
    '“Clothes and shoes” will be removed. Its items stay. This can’t be undone.',
  );
  // Read out with its title, so a screen reader hears what goes (audit 5 G-3).
  await expect(deleteDialog(page)).toHaveAccessibleDescription(
    '“Clothes and shoes” will be removed. Its items stay. This can’t be undone.',
  );
  await deleteDialog(page).getByLabel('Move its 1 item to').selectOption({ label: 'Other' });
  await deleteDialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(categoryForm(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add category' })).toBeFocused();
  await expect(chip(page, 'Clothes and shoes')).toHaveCount(0);
  await expect(badge(page, 'Running shoes')).toHaveText('Other');
  await expect(
    page.getByRole('status').filter({ hasText: 'Its items are in Other now.' }),
  ).toBeAttached();

  // Or leave them without one, and find them with the filter.
  await chip(page, 'Personal care').click();
  await categoryForm(page).getByRole('button', { name: 'Delete' }).click();
  await expect(deleteDialog(page).getByLabel('Move its 1 item to')).toHaveValue('');
  await deleteDialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(badge(page, 'Face cream')).toBeHidden();
  await categoryFilter(page).selectOption({ label: 'No category' });
  await expect(page.locator('[data-items] [data-action="edit"]')).toHaveText(['Face cream']);

  // All of it is remembered.
  await page.reload();
  await expect(chips(page)).toHaveText([
    /^Books\s*1 item$/,
    /^Groceries\s*1 item$/,
    /^Home\s*0 items$/,
    /^Other\s*1 item$/,
    /^Personal items\s*0 items$/,
    /^Tech and appliances\s*0 items$/,
  ]);
  await expect(badge(page, 'Greek yogurt')).toHaveText('Groceries');
});

test('cancelling changes nothing', async ({ page }) => {
  await chip(page, 'Home').click();
  await categoryForm(page).getByLabel('Name').fill('House');
  await categoryForm(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(chip(page, 'Home')).toBeFocused();
  await chip(page, 'Home').click();
  await categoryForm(page).getByRole('button', { name: 'Delete' }).click();
  // No items in it: nothing to move.
  await expect(deleteDialog(page).getByLabel(/^Move its/)).toBeHidden();
  await deleteDialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(categoryForm(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chips(page)).toHaveCount(STARTING.length);
});

test('works with every starting category deleted', async ({ page }) => {
  const removed = STARTING.map((id) => ({ id, name: id, removed: true }));
  await seed(page, [{ name: 'Olive oil', category: 'food' }], removed);
  await expect(chips(page)).toHaveCount(0);
  await expect(page.getByText('No categories. Add one to sort your items.')).toBeVisible();
  await expect(badge(page, 'Olive oil')).toBeHidden();
  await page.getByRole('button', { name: 'Edit Olive oil' }).click();
  await expect(itemForm(page).getByLabel('Category').locator('option')).toHaveText(['No category']);
});

test('the category forms are accessible, in both themes', async ({ page }) => {
  await seed(page, [{ name: 'Olive oil', category: 'food' }]);
  await checkA11y(page, 'categories');
  await chip(page, 'Food and drink').click();
  await categoryForm(page).getByLabel('Name').fill('');
  await categoryForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(categoryForm(page).getByText('Give it a name.')).toBeVisible();
  await checkA11y(page, 'the category form');
  await page.emulateMedia({ colorScheme: 'dark' });
  await categoryForm(page).getByRole('button', { name: 'Delete' }).click();
  await checkA11y(page, 'deleting a category (dark)');
});

test.describe('another device deletes a category meanwhile (audit 4 F3-5)', () => {
  /** Deletes a category in another tab, as a sync from another device would. */
  async function deleteElsewhere(page: Page, name: string): Promise<void> {
    const other = await page.context().newPage();
    await other.goto('/');
    await chip(other, name).click();
    await categoryForm(other).getByRole('button', { name: 'Delete' }).click();
    await deleteDialog(other).getByRole('button', { name: 'Delete' }).click();
    await expect(chip(other, name)).toHaveCount(0);
    await other.close();
    await expect(chip(page, name)).toHaveCount(0);
  }

  test('Delete in its form says it was already deleted', async ({ page }) => {
    // Before, it did nothing, and said nothing.
    await seed(page, [], [{ id: 'gifts', name: 'Gifts', removed: false }]);
    await chip(page, 'Gifts').click();
    await deleteElsewhere(page, 'Gifts');
    await categoryForm(page).getByRole('button', { name: 'Delete' }).click();
    await expect(categoryForm(page)).toBeHidden();
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'That category was already deleted on another device.' }),
    ).toBeVisible();
  });

  test('the category its items were to go to: asked again, not moved to none', async ({ page }) => {
    // Before, the items lost their category without a word.
    await seed(
      page,
      [{ name: 'Socks', category: 'mine' }],
      [
        { id: 'mine', name: 'Mine', removed: false },
        { id: 'gifts', name: 'Gifts', removed: false },
      ],
    );
    await chip(page, 'Mine').click();
    await categoryForm(page).getByRole('button', { name: 'Delete' }).click();
    const move = deleteDialog(page).getByLabel(/^Move its/);
    await move.selectOption({ label: 'Gifts' });
    await deleteElsewhere(page, 'Gifts');
    await deleteDialog(page).getByRole('button', { name: 'Delete' }).click();

    // The question stays, with the categories there are now, and says why.
    await expect(deleteDialog(page)).toBeVisible();
    await expect(deleteDialog(page).getByRole('alert')).toHaveText(
      '“Gifts” was deleted on another device. Choose where the items go.',
    );
    await expect(move).toBeFocused();
    await expect(move.locator('option')).not.toContainText(['Gifts']);
    await checkA11y(page, 'deleting a category, asked again');
    await move.selectOption({ label: 'Personal items' });
    await deleteDialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect(deleteDialog(page)).toBeHidden();
    await expect(categoryForm(page)).toBeHidden();
    await expect(page.locator('[data-announcer]')).toHaveText(
      'Deleted category Mine. Its items are in Personal items now.',
    );
    await expect(badge(page, 'Socks')).toHaveText('Personal items');
  });
});
