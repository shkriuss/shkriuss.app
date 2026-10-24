// Shelf's own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
// The locale is en-US.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import type { Item } from '../src/lib/items.ts';

const form = (page: Page) => page.getByRole('dialog', { name: /^(New|Edit) item$/ });
const cards = (page: Page) => page.locator('[data-items] > li');
const card = (page: Page, name: string) =>
  cards(page).filter({ has: page.getByRole('button', { name: `Edit ${name}`, exact: true }) });
const names = (page: Page) => page.locator('[data-items] [data-action="edit"]');
const filter = (page: Page, label: string) => page.locator('[data-filters]').getByLabel(label);
const save = (page: Page) => form(page).getByRole('button', { name: 'Save' }).click();

/** Items with every field filled in; tests change only what matters to them. */
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

/** Saves items straight into storage, then reloads. */
async function seed(page: Page, items: Partial<Item>[]): Promise<void> {
  await page.evaluate(
    (data) => {
      localStorage.setItem('shkriuss:shelf', JSON.stringify({ v: 1, data }));
    },
    { items: items.map(sample) },
  );
  await page.reload();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('adds an item with its brand, price, shop and link, and remembers it', async ({ page }) => {
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(form(page)).toHaveAccessibleName('New item');
  await expect(form(page).getByLabel('Name')).toBeFocused();
  await form(page).getByLabel('Name').fill('Greek yogurt');
  await form(page).getByLabel('Brand (optional)').fill('Fage');
  await form(page).getByLabel('Category').selectOption({ label: 'Food and drink' });
  await form(page).getByLabel('Love it').check();
  await form(page).getByLabel('Price (optional)').fill('4,50');
  await expect(form(page).getByLabel('Currency')).toHaveValue('GEL');
  await form(page).getByLabel('Where to buy (optional)').fill('Carrefour');
  await form(page).getByLabel('Size or variant (optional)').fill('2%, 500 g');
  await form(page).getByLabel('Link (optional)').fill('fage.com/products');
  await form(page).getByLabel('Last bought (optional)').fill('2026-10-12');
  await form(page).getByLabel('Notes (optional)').fill('Best for breakfast');
  await save(page);

  await expect(form(page)).toBeHidden();
  const yogurt = card(page, 'Greek yogurt');
  await expect(yogurt.getByRole('button', { name: 'Edit Greek yogurt' })).toBeFocused();
  await expect(yogurt).toContainText('Food and drink');
  await expect(yogurt).toContainText('Love it');
  await expect(yogurt.locator('[data-brand]')).toHaveText('Fage');
  await expect(yogurt.locator('[data-price]')).toHaveText(/^GEL\s4\.50$/);
  await expect(yogurt.locator('[data-details]').first()).toHaveText('2%, 500 g · Carrefour');
  await expect(yogurt.locator('[data-bought]')).toHaveText('Last bought Oct 12, 2026');
  await expect(yogurt.locator('[data-notes]')).toHaveText('Best for breakfast');
  // The link opens the shop's page in a new tab, telling it nothing about Shelf.
  const link = yogurt.getByRole('link', { name: 'Open fage.com for Greek yogurt, in a new tab' });
  await expect(link).toHaveAttribute('href', 'https://fage.com/products');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('[data-count]')).toHaveText('1 item');
  await expect(page.getByRole('status').filter({ hasText: 'Saved Greek yogurt.' })).toBeAttached();
  await expect(page.locator('[data-brands]')).toHaveText(/Fage\s*1 item, 1 loved/);

  await page.reload();
  await expect(names(page)).toHaveText(['Greek yogurt']);
  // The next item starts in the same currency.
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(form(page).getByLabel('Currency')).toHaveValue('GEL');
  await expect(form(page).getByLabel('Use it')).toBeChecked();
});

test('explains what to fix before saving', async ({ page }) => {
  await page.getByRole('button', { name: 'Add item' }).click();
  await save(page);
  await expect(form(page).getByText('Give it a name.')).toBeVisible();
  await expect(form(page).getByLabel('Name')).toBeFocused();
  await expect(form(page).getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');

  await form(page).getByLabel('Name').fill('Phone case');
  await form(page).getByLabel('Price (optional)').fill('12.345');
  await form(page).getByLabel('Link (optional)').fill('javascript:alert(1)');
  await save(page);
  await expect(form(page).getByText('Write a price like 12.50, or leave it empty.')).toBeVisible();
  await expect(
    form(page).getByText('Write a web address like https://example.com, or leave it empty.'),
  ).toBeVisible();
  await expect(form(page).getByLabel('Price (optional)')).toBeFocused();
  // Fixed: the message goes as soon as it's right.
  await form(page).getByLabel('Price (optional)').fill('12.35');
  await expect(form(page).getByText('Write a price like 12.50')).toBeHidden();
  await form(page).getByLabel('Link (optional)').fill('');
  await save(page);
  await expect(card(page, 'Phone case').locator('[data-price]')).toHaveText(/^GEL\s12\.35$/);
  await expect(card(page, 'Phone case').getByRole('link')).toBeHidden();
});

test('changes and deletes an item, with a confirmation', async ({ page }) => {
  await seed(page, [{ name: 'Running shoes', brand: 'ASICS', category: 'clothes', price: 250 }]);
  await page.getByRole('button', { name: 'Edit Running shoes' }).click();
  await expect(form(page)).toHaveAccessibleName('Edit item');
  await expect(form(page).getByLabel('Price (optional)')).toHaveValue('250');
  await expect(form(page).getByLabel('Category')).toHaveValue('clothes');
  await form(page).getByLabel('Price (optional)').fill('220');
  await form(page).getByLabel('Won’t buy again').check();
  await save(page);
  await expect(card(page, 'Running shoes')).toContainText('Won’t buy again');
  await expect(card(page, 'Running shoes').locator('[data-price]')).toHaveText(/^GEL\s220\.00$/);

  await page.getByRole('button', { name: 'Edit Running shoes' }).click();
  await form(page).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this item?' });
  await expect(confirm).toContainText('“Running shoes” will be removed.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(form(page)).toBeVisible();
  await form(page).getByRole('button', { name: 'Delete' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(form(page)).toBeHidden();
  await expect(names(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add item' })).toBeFocused();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
});

test('finds items by search, category, how you like them, and brand', async ({ page }) => {
  await seed(page, [
    { name: 'Greek yogurt', brand: 'Fage', opinion: 'love', price: 4.5 },
    { name: 'Running shoes', brand: 'ASICS', category: 'clothes', price: 250, variant: 'EU 43' },
    { name: 'Face cream', brand: 'La Roche-Posay', category: 'care', opinion: 'want', price: 39 },
    { name: 'Skyr', brand: 'Fage', opinion: 'love', price: 3 },
  ]);
  await expect(page.locator('[data-count]')).toHaveText('4 items');
  // Most recently changed first.
  await expect(names(page)).toHaveText(['Skyr', 'Face cream', 'Running shoes', 'Greek yogurt']);

  await filter(page, 'Search').fill('eu 43');
  await expect(names(page)).toHaveText(['Running shoes']);
  await expect(page.locator('[data-count]')).toHaveText('1 of 4 items');
  await filter(page, 'Search').fill('');

  await filter(page, 'Category').selectOption({ label: 'Personal care' });
  await expect(names(page)).toHaveText(['Face cream']);
  await expect(page.getByRole('status').filter({ hasText: '1 item shown.' })).toBeAttached();
  await filter(page, 'Category').selectOption({ label: 'All categories' });
  await filter(page, 'How you like it').selectOption({ label: 'Love it' });
  await expect(names(page)).toHaveText(['Skyr', 'Greek yogurt']);
  await filter(page, 'How you like it').selectOption({ label: 'Any' });
  await filter(page, 'Sort by').selectOption({ label: 'Price, low to high' });
  await expect(names(page)).toHaveText(['Skyr', 'Greek yogurt', 'Face cream', 'Running shoes']);

  // The brands you love most come first; tapping one shows its items.
  const brands = page.locator('[data-brands] button');
  await expect(brands).toHaveText([
    /^Fage\s*2 items, 2 loved$/,
    /^ASICS\s*1 item$/,
    /^La Roche-Posay\s*1 item$/,
  ]);
  await brands.first().click();
  await expect(page.locator('[data-brand-filter]')).toHaveText(/Brand: Fage/);
  await expect(page.locator('#items-heading')).toBeFocused();
  await expect(names(page)).toHaveText(['Skyr', 'Greek yogurt']);
  await expect(brands.first()).toHaveAttribute('aria-pressed', 'true');
  // Adding while looking at a brand: the brand is filled in.
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(form(page).getByLabel('Brand (optional)')).toHaveValue('Fage');
  await form(page).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'All brands' }).click();
  await expect(names(page)).toHaveCount(4);
  await expect(page.locator('[data-brand-filter]')).toBeHidden();

  await checkA11y(page, 'items');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'items (dark)');
  await page.getByRole('button', { name: 'Edit Greek yogurt' }).click();
  await checkA11y(page, 'the form (dark)');
});

test('saving a form keeps what changed elsewhere while it was open', async ({ page }) => {
  await seed(page, [{ name: 'Running shoes', price: 250 }]);
  await page.getByRole('button', { name: 'Edit Running shoes' }).click();
  // Meanwhile, another tab (or a sync from another device) changes the price.
  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Edit Running shoes' }).click();
  await form(other).getByLabel('Price (optional)').fill('220');
  await save(other);
  await expect(card(other, 'Running shoes').locator('[data-price]')).toHaveText(/220\.00$/);
  await other.close();

  await form(page).getByLabel('Notes (optional)').fill('Comfy');
  await save(page);
  await expect(card(page, 'Running shoes').locator('[data-price]')).toHaveText(/220\.00$/);
  await page.getByRole('button', { name: 'Edit Running shoes' }).click();
  await expect(form(page).getByLabel('Notes (optional)')).toHaveValue('Comfy');
  await expect(form(page).getByLabel('Price (optional)')).toHaveValue('220');
});

test('long lists show 100 items at a time', async ({ page }) => {
  await seed(
    page,
    Array.from({ length: 120 }, (_, index) => ({ name: `Item ${index + 1}` })),
  );
  await expect(page.locator('[data-count]')).toHaveText('120 items');
  await expect(names(page)).toHaveCount(100);
  const more = page.getByRole('button', { name: 'Show more items' });
  await more.click();
  await expect(names(page)).toHaveCount(120);
  // Focus goes to the first item just shown.
  await expect(names(page).nth(100)).toBeFocused();
  await expect(more).toBeHidden();

  // A new search starts at the first page again.
  await filter(page, 'Search').fill('item');
  await expect(names(page)).toHaveCount(100);
  await expect(more).toBeVisible();
  await expect(page.locator('[data-count]')).toHaveText('120 items');
});

test('ignores saved data it doesn’t understand', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('shkriuss:shelf', JSON.stringify({ v: 1, data: { items: [{ id: 1 }] } }));
  });
  await page.reload();
  await expect(page.getByText('Nothing here yet.')).toBeVisible();
});
