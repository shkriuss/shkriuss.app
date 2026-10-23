/**
 * When the browser won't save (storage full, or blocked), every app says so:
 * in the notice at the top of the page, which is read out at once (audit
 * G-1). Each app makes one change here, after saving starts failing.
 */
import type { Page } from '@playwright/test';
import { checkA11y, expect, failSaving, test } from './fixtures.ts';

/** Types into a text field and presses Enter (which adds it, in these apps). */
async function enter(page: Page, label: string, text: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true }).first();
  await field.fill(text);
  await field.press('Enter');
}

/** Picks another currency (a setting that's saved straight away). */
async function otherCurrency(page: Page): Promise<void> {
  const select = page.getByLabel('Currency', { exact: true });
  const other = await select.evaluate(
    (element: HTMLSelectElement) =>
      [...element.options].find((option) => option.value !== element.value)?.value ?? '',
  );
  await select.selectOption(other);
}

/** One change per app (apps that keep nothing in this storage aren't here). */
const changes: Record<string, (page: Page) => Promise<void>> = {
  budget: otherCurrency,
  calendar: async (page) => {
    await page.getByRole('button', { name: 'New event' }).click();
    await enter(page, 'Title', 'Dentist');
  },
  grammar: (page) => page.getByLabel('British (UK)').check(),
  habits: (page) => enter(page, 'New habit', 'Read'),
  meals: (page) => enter(page, 'Add to the list', 'Milk'),
  notes: (page) => page.getByRole('button', { name: 'New note' }).click(),
  reminders: (page) => enter(page, 'Remind me to', 'Call the dentist'),
  repairs: otherCurrency,
  shelf: async (page) => {
    await page.getByRole('button', { name: 'Add item' }).click();
    await enter(page, 'Name', 'Green tea');
  },
  tally: (page) => enter(page, 'New counter', 'Cups'),
  tasks: (page) => enter(page, 'New task', 'Pay the rent'),
  trades: otherCurrency,
  water: (page) => page.getByRole('button', { name: /^Glass/ }).click(),
};

test('says so, on screen and out loud, when a change can’t be saved', async ({ page }) => {
  const change = changes[test.info().project.name];
  test.skip(!change, 'This site keeps nothing that a change here would save.');
  await page.goto('/');
  await failSaving(page);
  await change?.(page);

  const problem = page.getByRole('alert').filter({ hasText: 'Couldn’t save' });
  await expect(problem).toBeVisible();
  await expect(problem).toHaveText(
    'Couldn’t save: there’s no room left for this app’s data in this browser. Delete something you don’t need, then try again.',
  );
  // At the top of the page, outside any part of it that can be hidden.
  expect(
    await problem.evaluate((element) => {
      const notice = element.closest('[data-problem]');
      return notice?.parentElement?.parentElement?.id === 'main' && !notice.closest('[hidden]');
    }),
  ).toBe(true);

  // Readable in both themes, then out of the way once hidden.
  await page.keyboard.press('Escape');
  await expect(problem).toBeInViewport();
  await checkA11y(page, 'with the problem notice (light)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'with the problem notice (dark)');
  await page.getByRole('button', { name: 'Hide this message' }).click();
  await expect(problem).toHaveCount(0);
  await expect(page.locator('#main')).toBeFocused();
});
