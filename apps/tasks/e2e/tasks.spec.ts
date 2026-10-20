// Tasks' own tests. Shared checks (accessibility, security headers, offline
// support, privacy, sync) already run for every app from tests/e2e/.
// The locale is en-US.
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  addTask,
  box,
  chip,
  doneTitles,
  editor,
  NOW,
  row,
  seed,
  TIME_ZONE,
  titles,
} from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

test('adds tasks, ticks them off and brings them back', async ({ page }) => {
  await expect(page.getByText('Nothing to do here. Add a task above.')).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Write what you need to do.')).toBeVisible();
  await expect(page.getByLabel('New task')).toBeFocused();

  await addTask(page, 'Buy bread');
  await expect(page.getByText('Write what you need to do.')).toBeHidden();
  // A minute later.
  await page.clock.setFixedTime(NOW.getTime() + 60_000);
  await page.getByLabel('New task').fill('Call mum');
  await page.getByLabel('New task').press('Enter');
  await expect(page.getByLabel('New task')).toHaveValue('');
  await expect(page.getByLabel('New task')).toBeFocused();
  await expect(page.locator('[data-group-title]')).toHaveText(['No date']);
  // The newest first.
  await expect(titles(page)).toHaveText(['Call mum', 'Buy bread']);
  await expect(chip(page, 'All')).toHaveText(/2$/);

  await box(page, 'Buy bread').click();
  await expect(titles(page)).toHaveText(['Call mum']);
  await expect(box(page, 'Call mum')).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Done: Buy bread.' })).toBeAttached();
  await expect(page.locator('[data-done-summary]')).toHaveText('Done (1)');
  await page.locator('[data-done-summary]').click();
  await expect(doneTitles(page)).toHaveText(['Buy bread']);
  await expect(box(page, 'Buy bread')).toBeChecked();

  await page.reload();
  await expect(titles(page)).toHaveText(['Call mum']);
  await page.locator('[data-done-summary]').click();
  await box(page, 'Buy bread').click();
  await expect(titles(page)).toHaveText(['Call mum', 'Buy bread']);
  await expect(box(page, 'Buy bread')).toBeFocused();
  await expect(page.locator('[data-done-section]')).toBeHidden();

  await box(page, 'Call mum').click();
  await box(page, 'Buy bread').click();
  await expect(page.getByText('All done here.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeFocused();
});

test('groups tasks by when they’re due', async ({ page }) => {
  await seed(page, [
    { title: 'Learn guitar' },
    { title: 'Dentist', date: '2026-11-03', time: '16:00' },
    { title: 'Gym', date: '2026-10-21', time: '07:30' },
    { title: 'Team call', date: '2026-10-20', time: '09:00' },
    { title: 'Send report', date: '2026-10-20', important: true },
    { title: 'Renew passport', date: '2026-10-15' },
  ]);
  await expect(page.locator('[data-group-title]')).toHaveText([
    'Overdue',
    'Today',
    'Tomorrow',
    'Later',
    'No date',
  ]);
  await expect(titles(page)).toHaveText([
    'Renew passport',
    'Send report',
    'Team call',
    'Gym',
    'Dentist',
    'Learn guitar',
  ]);
  const due = (title: string) => row(page, title).locator('[data-due]');
  await expect(due('Renew passport')).toHaveText('Thu, Oct 15');
  await expect(due('Renew passport')).toHaveClass(/task__due--overdue/);
  await expect(due('Team call')).toHaveText(/^Today, 9:00\sAM$/);
  await expect(due('Gym')).toHaveText(/^Tomorrow, 7:30\sAM$/);
  await expect(due('Dentist')).toHaveText(/^Tue, Nov 3, 4:00\sPM$/);
  await expect(row(page, 'Send report').locator('[data-star]')).toBeVisible();
  await expect(row(page, 'Learn guitar').locator('[data-meta]')).toBeHidden();

  // Only the important ones.
  await chip(page, 'Important').click();
  await expect(chip(page, 'Important')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'Important' })).toBeVisible();
  await expect(titles(page)).toHaveText(['Send report']);
  // Added here, it's important too.
  await addTask(page, 'Book flights');
  await expect(titles(page)).toHaveText(['Send report', 'Book flights']);
  await chip(page, 'All').click();
  await expect(titles(page)).toHaveCount(7);
});

test('changes a task: its date, time, repeat, reminder and importance', async ({ page }) => {
  await addTask(page, 'Pay rent');
  await page.getByRole('button', { name: 'Edit Pay rent' }).click();
  await expect(editor(page).getByLabel('Title')).toBeFocused();
  await expect(editor(page).getByLabel('List')).toBeHidden();

  // A time needs a date.
  await editor(page).getByLabel('Time (optional)').fill('17:00');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(
    editor(page).getByText('Choose a date for the time, or clear the time.'),
  ).toBeVisible();
  await expect(editor(page).getByLabel('Date (optional)')).toBeFocused();
  await editor(page).getByLabel('Date (optional)').fill('2026-10-20');
  await expect(editor(page).getByText('Choose a date for the time')).toBeHidden();
  await editor(page).getByLabel('Title').fill('');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page).getByText('Give it a title.')).toBeVisible();
  await editor(page).getByLabel('Title').fill('Pay the rent');
  await editor(page).getByLabel('Notes (optional)').fill('Transfer to the landlord');
  await editor(page).getByLabel('Repeat', { exact: true }).selectOption({ label: 'Monthly' });
  await editor(page).getByLabel('Remind me').selectOption({ label: '1 hour before' });
  await editor(page).getByLabel('Important').check();
  await editor(page).getByRole('button', { name: 'Save' }).click();

  await expect(editor(page)).toBeHidden();
  // Once done, a copy is under "Done" too: look among those still to do.
  const rent = page
    .locator('[data-groups] [data-id]')
    .filter({ has: page.getByRole('button', { name: 'Edit Pay the rent' }) });
  await expect(rent.getByRole('button', { name: 'Edit Pay the rent' })).toBeFocused();
  await expect(page.locator('[data-group-title]')).toHaveText(['Today']);
  await expect(rent.locator('[data-due]')).toHaveText(/^Today, 5:00\sPM$/);
  await expect(rent.locator('[data-repeat]')).toHaveText('Every month');
  await expect(rent.locator('[data-reminder-tag]')).toBeVisible();
  await expect(rent.locator('[data-star]')).toBeVisible();
  await expect(rent.locator('[data-notes]')).toHaveText('Transfer to the landlord');
  await expect(chip(page, 'Important')).toHaveText(/1$/);

  // Done: it moves on to next month, and a done copy is kept.
  await box(page, 'Pay the rent').click();
  await expect(rent.locator('[data-due]')).toHaveText(/^Fri, Nov 20, 5:00\sPM$/);
  await expect(rent.getByRole('checkbox')).toBeFocused();
  await expect(rent.getByRole('checkbox')).not.toBeChecked();
  await expect(
    page.getByRole('status').filter({ hasText: 'Done: Pay the rent. Next: Fri, Nov 20.' }),
  ).toBeAttached();
  await page.locator('[data-done-summary]').click();
  await expect(doneTitles(page)).toHaveText(['Pay the rent']);

  // The form shows what was saved.
  await rent.getByRole('button', { name: 'Edit Pay the rent' }).click();
  await expect(editor(page).getByLabel('Date (optional)')).toHaveValue('2026-11-20');
  await expect(editor(page).getByLabel('Time (optional)')).toHaveValue('17:00');
  await expect(editor(page).getByLabel('Repeat', { exact: true })).toHaveValue('monthly');
  await expect(editor(page).getByLabel('Remind me')).toHaveValue('60');
  await expect(editor(page).getByLabel('Important')).toBeChecked();
});

test('repeats every 2 weeks, or however often', async ({ page }) => {
  await seed(page, [{ title: 'Clean the gutters', date: '2026-10-20' }]);
  await page.getByRole('button', { name: 'Edit Clean the gutters' }).click();
  const repeat = editor(page).getByLabel('Repeat', { exact: true });
  const every = editor(page).getByLabel('Repeat every');
  await expect(every).toBeHidden();
  await repeat.selectOption({ label: 'Weekly' });
  await expect(every).toBeVisible();
  await expect(every).toHaveValue('1');
  await expect(editor(page).locator('[data-every-unit]')).toHaveText('week');
  await every.fill('0');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page).getByText('Write a number from 1 to 99.')).toBeVisible();
  await expect(every).toBeFocused();
  await every.fill('2');
  await expect(editor(page).locator('[data-every-unit]')).toHaveText('weeks');
  await expect(editor(page).getByText('Write a number from 1 to 99.')).toBeHidden();
  // Every weekday has nothing to count.
  await repeat.selectOption({ label: 'Every weekday (Monday to Friday)' });
  await expect(every).toBeHidden();
  await repeat.selectOption({ label: 'Weekly' });
  await expect(every).toHaveValue('2');
  await editor(page).getByRole('button', { name: 'Save' }).click();

  const gutters = page
    .locator('[data-groups] [data-id]')
    .filter({ has: page.getByRole('button', { name: 'Edit Clean the gutters' }) });
  await expect(gutters.locator('[data-repeat]')).toHaveText('Every 2 weeks');
  await box(page, 'Clean the gutters').click();
  await expect(gutters.locator('[data-due]')).toHaveText('Tue, Nov 3');
  await gutters.getByRole('button', { name: 'Edit Clean the gutters' }).click();
  await expect(every).toHaveValue('2');
});

test('deletes a task, and done ones, with a confirmation', async ({ page }) => {
  await seed(page, [
    { title: 'Old receipt', done: 5 },
    { title: 'Old ticket', done: 6 },
    { title: 'Wrong task' },
    { title: 'Keep me' },
  ]);
  await page.getByRole('button', { name: 'Edit Wrong task' }).click();
  await editor(page).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this task?' });
  await expect(confirm).toContainText('“Wrong task” will be removed.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).getByRole('button', { name: 'Delete' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(editor(page)).toBeHidden();
  await expect(titles(page)).toHaveText(['Keep me']);
  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeFocused();

  await page.locator('[data-done-summary]').click();
  await page.getByRole('button', { name: 'Delete done tasks' }).click();
  const clear = page.getByRole('dialog', { name: 'Delete done tasks?' });
  await expect(clear).toContainText('The 2 done tasks shown here will be removed.');
  await clear.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('[data-done-section]')).toBeHidden();
  await expect(titles(page)).toHaveText(['Keep me']);
});

test('is accessible, in both themes', async ({ page }) => {
  await seed(
    page,
    [
      { title: 'Renew passport', date: '2026-10-15', important: true },
      { title: 'Water plants', date: '2026-10-20', repeat: 'weekly', reminder: 0, list: 'h' },
      { title: 'Buy bread', done: 5 },
    ],
    [{ id: 'h', name: 'Home' }],
  );
  await page.locator('[data-done-summary]').click();
  await checkA11y(page, 'tasks');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'tasks (dark)');
  await page.getByRole('button', { name: 'Edit Water plants' }).click();
  await editor(page).getByLabel('Title').fill('');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await checkA11y(page, 'the form with a problem (dark)');
});

test('ignores saved data it doesn’t understand', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('shkriuss:tasks', JSON.stringify({ v: 1, data: { tasks: [{ id: 1 }] } }));
  });
  await page.reload();
  await expect(page.getByText('Nothing to do here. Add a task above.')).toBeVisible();
});
