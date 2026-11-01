// Lists: add, show, rename and delete them; their tasks stay, move or go.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { addTask, chip, editor, row, seed, titles } from './helpers.ts';

const listForm = (page: Page) => page.getByRole('dialog', { name: /^(New|Edit) list$/ });
const deleteDialog = (page: Page) => page.getByRole('dialog', { name: 'Delete this list?' });
const heading = (page: Page) => page.locator('[data-view-heading]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('adds a list, shows its tasks, and renames it', async ({ page }) => {
  await addTask(page, 'Call mum');
  await page.getByRole('button', { name: 'New list' }).click();
  await expect(listForm(page)).toHaveAccessibleName('New list');
  await expect(listForm(page).getByRole('button', { name: 'Delete' })).toBeHidden();
  await listForm(page).getByLabel('Name').fill('Work');
  await listForm(page).getByRole('button', { name: 'Save' }).click();

  // A new list is shown straight away, ready for its tasks.
  await expect(heading(page)).toHaveText('Work');
  await expect(chip(page, 'Work')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, 'Work')).toBeFocused();
  await expect(page.getByText('Nothing to do here. Add a task above.')).toBeVisible();
  await addTask(page, 'Write report');
  await expect(titles(page)).toHaveText(['Write report']);
  // Its name isn't repeated on its tasks.
  await expect(row(page, 'Write report').locator('[data-list-tag]')).toBeHidden();

  // Names can't be used twice.
  await page.getByRole('button', { name: 'New list' }).click();
  await listForm(page).getByLabel('Name').fill('work ');
  await listForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(listForm(page).getByText('You already have a list called “Work”.')).toBeVisible();
  await listForm(page).getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Rename or delete this list' }).click();
  await expect(listForm(page)).toHaveAccessibleName('Edit list');
  await expect(listForm(page).getByLabel('Name')).toHaveValue('Work');
  await listForm(page).getByLabel('Name').fill('Office');
  await listForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(heading(page)).toHaveText('Office');

  await chip(page, 'All').click();
  await expect(page.getByRole('button', { name: 'Rename or delete this list' })).toBeHidden();
  await expect(titles(page)).toHaveText(['Write report', 'Call mum']);
  await expect(row(page, 'Write report').locator('[data-list-name]')).toHaveText('Office');

  // A task can go into a list from its form.
  await page.getByRole('button', { name: 'Edit Call mum' }).click();
  await expect(editor(page).getByLabel('List')).toHaveValue('');
  await editor(page).getByLabel('List').selectOption({ label: 'Office' });
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(chip(page, 'Office')).toHaveText(/2$/);

  await page.reload();
  await expect(chip(page, 'Office')).toBeVisible();
});

test('deleting a list keeps its tasks, moves them, or deletes them', async ({ page }) => {
  const lists = [
    { id: 'w', name: 'Work' },
    { id: 'h', name: 'Home' },
    { id: 's', name: 'Shopping' },
  ];
  await seed(
    page,
    [
      { title: 'Write report', list: 'w' },
      { title: 'Fix the sink', list: 'h' },
      { title: 'Milk', list: 's' },
      { title: 'Eggs', list: 's', done: 5 },
      { title: 'Call mum' },
    ],
    lists,
  );

  // Moved to another list.
  await chip(page, 'Work').click();
  await page.getByRole('button', { name: 'Rename or delete this list' }).click();
  await listForm(page).getByRole('button', { name: 'Delete' }).click();
  await expect(deleteDialog(page)).toContainText('“Work” will be removed. This can’t be undone.');
  // Read out with the title: the message, and that its tasks are asked about (audit 5 G-3).
  await expect(deleteDialog(page)).toHaveAccessibleDescription(
    /“Work” will be removed\. This can’t be undone\.\s+Its 1 task$/,
  );
  await checkA11y(page, 'deleting a list');
  await deleteDialog(page).getByLabel('Its 1 task').selectOption({ label: 'Move them to Home' });
  await deleteDialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(listForm(page)).toBeHidden();
  await expect(heading(page)).toHaveText('All tasks');
  await expect(heading(page)).toBeFocused();
  await expect(chip(page, 'Work')).toHaveCount(0);
  await expect(chip(page, 'Home')).toHaveText(/2$/);

  // Deleted with it, done ones too.
  await chip(page, 'Shopping').click();
  await page.getByRole('button', { name: 'Rename or delete this list' }).click();
  await listForm(page).getByRole('button', { name: 'Delete' }).click();
  await deleteDialog(page).getByLabel('Its 2 tasks').selectOption({ label: 'Delete them too' });
  await deleteDialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(titles(page)).toHaveText(['Call mum', 'Fix the sink', 'Write report']);
  await expect(page.locator('[data-done-section]')).toBeHidden();

  // Kept, without a list (the first choice).
  await chip(page, 'Home').click();
  await page.getByRole('button', { name: 'Rename or delete this list' }).click();
  await listForm(page).getByRole('button', { name: 'Delete' }).click();
  await expect(deleteDialog(page).getByLabel('Its 2 tasks')).toHaveValue('');
  await deleteDialog(page).getByRole('button', { name: 'Delete' }).click();
  await expect(titles(page)).toHaveText(['Call mum', 'Fix the sink', 'Write report']);
  await expect(page.locator('[data-list-tag]:visible')).toHaveCount(0);
  await expect(page.locator('[data-views] button')).toHaveCount(2);
});

test('a list deleted elsewhere while its form is open', async ({ page }) => {
  // The form said nothing: Delete did nothing, closing it left focus on the
  // page itself, and Save brought the list back without a word (audit 6 G-3).
  const gone =
    'This list was deleted on another device or in another tab. Saving a change brings it back.';
  const lists = [
    { id: 'w', name: 'Work' },
    { id: 'h', name: 'Home' },
    { id: 's', name: 'Shopping' },
    { id: 'g', name: 'Garden' },
  ];
  await seed(page, [{ title: 'Call mum' }], lists);
  const edit = async (name: string) => {
    await chip(page, name).click();
    await page.getByRole('button', { name: 'Rename or delete this list' }).click();
    await expect(listForm(page)).toHaveAccessibleName('Edit list');
  };
  const deleteElsewhere = async (name: string) => {
    const other = await page.context().newPage();
    await other.goto('/');
    await chip(other, name).click();
    await other.getByRole('button', { name: 'Rename or delete this list' }).click();
    await listForm(other).getByRole('button', { name: 'Delete' }).click();
    await deleteDialog(other).getByRole('button', { name: 'Delete' }).click();
    await expect(listForm(other)).toBeHidden();
    await other.close();
    await expect(heading(page)).toHaveText('All tasks');
  };

  // The form says so; Cancel puts focus on the heading, not the page itself.
  await edit('Work');
  await deleteElsewhere('Work');
  await expect(listForm(page).locator('[data-list-gone-note]')).toHaveText(gone);
  await expect(listForm(page).locator('[data-dialog-messages]')).toHaveText(gone);
  await checkA11y(page, 'form of a list deleted elsewhere');
  await listForm(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(listForm(page)).toBeHidden();
  await expect(heading(page)).toBeFocused();

  // Delete: it was already deleted.
  await edit('Home');
  await deleteElsewhere('Home');
  await listForm(page).getByRole('button', { name: 'Delete' }).click();
  await expect(listForm(page)).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Home was already deleted.' }),
  ).toBeAttached();
  await expect(heading(page)).toBeFocused();

  // Save with no change: it stays deleted.
  await edit('Shopping');
  await deleteElsewhere('Shopping');
  await listForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(listForm(page)).toBeHidden();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Shopping stays deleted: nothing in it was changed.' }),
  ).toBeAttached();
  await expect(chip(page, 'Shopping')).toHaveCount(0);
  await expect(heading(page)).toBeFocused();

  // A change brings it back, as with sync.
  await edit('Garden');
  await deleteElsewhere('Garden');
  await listForm(page).getByLabel('Name').fill('Garden jobs');
  await listForm(page).getByRole('button', { name: 'Save' }).click();
  await expect(listForm(page)).toBeHidden();
  await expect(chip(page, 'Garden jobs')).toBeVisible();
  await expect(page.locator('[data-views] button')).toHaveCount(3);
});
