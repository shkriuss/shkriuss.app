// Search: finds tasks by words in their title, notes or steps.
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { addTask, doneTitles, seed, titles } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await seed(page, [
    { title: 'Café with Nino' },
    {
      title: 'Prepare for the trip',
      notes: 'Flight on Friday',
      steps: [{ id: 's', title: 'Renew the passport', done: false }],
    },
    { title: 'Buy bread' },
    { title: 'Old trip photos', done: 5 },
  ]);
});

test('finds tasks by their title, notes or steps', async ({ page }) => {
  const search = page.getByLabel('Search');
  await search.fill('trip');
  await expect(titles(page)).toHaveText(['Prepare for the trip']);
  await page.locator('[data-done-summary]').click();
  await expect(doneTitles(page)).toHaveText(['Old trip photos']);
  await expect(page.getByRole('status').filter({ hasText: '2 tasks found.' })).toBeAttached();

  // Notes and steps; any order of words, capitals and accents don't matter.
  await search.fill('PASSPORT friday');
  await expect(titles(page)).toHaveText(['Prepare for the trip']);
  await search.fill('cafe nino');
  await expect(titles(page)).toHaveText(['Café with Nino']);

  await search.fill('nothing like this');
  await expect(titles(page)).toHaveCount(0);
  await expect(page.getByText('No tasks match “nothing like this”.')).toBeVisible();
  await checkA11y(page, 'nothing found');

  // Escape clears it.
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(titles(page)).toHaveCount(3);
});

test('a task added while searching is shown', async ({ page }) => {
  await page.getByLabel('Search').fill('bread');
  await expect(titles(page)).toHaveText(['Buy bread']);
  // It matches: the search stays.
  await addTask(page, 'Bread for the soup');
  await expect(page.getByLabel('Search')).toHaveValue('bread');
  await expect(titles(page)).toHaveText(['Bread for the soup', 'Buy bread']);
  // It doesn't: the search is cleared, so it isn't hidden.
  await addTask(page, 'Call mum');
  await expect(page.getByLabel('Search')).toHaveValue('');
  await expect(titles(page)).toContainText(['Call mum']);
});
