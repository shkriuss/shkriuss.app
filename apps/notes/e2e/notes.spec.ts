// Notes: writing, finding, pinning and deleting notes, and the back button.
// Shared checks (accessibility, security headers, offline, privacy) run for
// every app from tests/e2e/.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Note' });
const card = (page: Page, title: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) });
const titles = (page: Page) => page.locator('[data-notes] [data-open]').allTextContents();

/** Writes a new note and goes back to the list. */
async function writeNote(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(editor(page)).toBeFocused();
  await editor(page).fill(text);
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('writes a note, lists it, and keeps it after a reload', async ({ page }) => {
  await expect(page.getByText('No notes yet')).toBeVisible();
  await expect(page.getByLabel('Search notes')).toBeHidden();
  await checkA11y(page, 'no notes');

  await page.getByRole('button', { name: 'New note' }).click();
  await expect(editor(page)).toBeFocused();
  expect(page.url()).toMatch(/#note=[\w-]+$/);
  await checkA11y(page, 'editor (new note)');
  await editor(page).fill('Shopping list\nMilk\nEggs and bread');
  await expect(page.getByText(/^Edited /)).toBeVisible();
  await expect(page).toHaveTitle('Shopping list · Notes');

  await page.getByRole('button', { name: 'All notes' }).click();
  const shopping = card(page, 'Shopping list');
  await expect(shopping).toContainText('Milk Eggs and bread');
  await expect(shopping.getByRole('link')).toBeFocused();
  await expect(page.getByText('No notes yet')).toBeHidden();

  await page.reload();
  await expect(card(page, 'Shopping list')).toBeVisible();
  await card(page, 'Shopping list').getByRole('link').click();
  await expect(editor(page)).toHaveValue('Shopping list\nMilk\nEggs and bread');
  // Opening a note to read it doesn't jump into the text (no keyboard on phones).
  await expect(page.getByRole('heading', { name: 'Note', level: 2 })).toBeFocused();
});

test('the back button returns to the list, and empty notes are dropped', async ({ page }) => {
  await writeNote(page, 'First');
  await card(page, 'First').getByRole('link').click();
  await expect(editor(page)).toBeVisible();
  await page.goBack();
  await expect(card(page, 'First')).toBeVisible();
  await page.goForward();
  await expect(editor(page)).toHaveValue('First');
  await page.goBack();

  // A note left empty isn't kept.
  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('button', { name: 'All notes' }).click();
  expect(await titles(page)).toEqual(['First']);
  await expect(page.getByRole('button', { name: 'New note' })).toBeFocused();
});

test('saves typing straight away when leaving the page', async ({ page }) => {
  await page.getByRole('button', { name: 'New note' }).click();
  await editor(page).pressSequentially('Typed fast');
  await page.reload();
  await expect(editor(page)).toHaveValue('Typed fast');
});

test('finds notes, ignoring case and accents', async ({ page }) => {
  await writeNote(page, 'Café ideas\nOat milk latte');
  await writeNote(page, 'Packing\nPassport, charger');
  const searchBox = page.getByLabel('Search notes');
  await searchBox.fill('cafe');
  expect(await titles(page)).toEqual(['Café ideas']);
  await expect(page.getByRole('status').filter({ hasText: '1 note found.' })).toBeAttached();
  await searchBox.fill('tea');
  await expect(page.getByText('No notes match “tea”.')).toBeVisible();
  await searchBox.fill('');
  expect(await titles(page)).toEqual(['Packing', 'Café ideas']);
});

test('pinned notes come first', async ({ page }) => {
  await writeNote(page, 'Older');
  await writeNote(page, 'Newer');
  expect(await titles(page)).toEqual(['Newer', 'Older']);

  await card(page, 'Older').getByRole('link').click();
  const pin = page.getByRole('button', { name: 'Pin' });
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await pin.click();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'All notes' }).click();
  expect(await titles(page)).toEqual(['Older', 'Newer']);
  await expect(card(page, 'Older').getByText('Pinned')).toBeVisible();
  await checkA11y(page, 'with notes');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'with notes (dark)');
  await card(page, 'Older').getByRole('link').click();
  await checkA11y(page, 'editor (dark, pinned)');
});

test('deletes a note after asking', async ({ page }) => {
  await writeNote(page, 'Keep me');
  await writeNote(page, 'Delete me\nOld stuff');
  await card(page, 'Delete me').getByRole('link').click();

  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this note?' });
  await expect(dialog).toContainText('“Delete me” will be removed.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor(page)).toHaveValue('Delete me\nOld stuff');

  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(card(page, 'Delete me')).toBeHidden();
  expect(await titles(page)).toEqual(['Keep me']);
  await expect(page.getByRole('status').filter({ hasText: 'Note deleted.' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'New note' })).toBeFocused();
  expect(page.url()).not.toContain('#note=');
});

test('says when a note link is for a note that isn’t here', async ({ page }) => {
  await page.goto('/#note=not-here');
  await expect(page.getByText('That note isn’t on this device.')).toBeVisible();
  expect(page.url()).not.toContain('#note=');
});

test('opens a note from its address, and "All notes" stays in the app', async ({ page }) => {
  await writeNote(page, 'Linked');
  await card(page, 'Linked').getByRole('link').click();
  const address = page.url();
  await page.goto('about:blank');
  await page.goto(address);
  await expect(editor(page)).toHaveValue('Linked');
  await page.getByRole('button', { name: 'All notes' }).click();
  await expect(card(page, 'Linked')).toBeVisible();
  expect(page.url()).not.toContain('#note=');
});
