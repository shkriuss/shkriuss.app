// Reminders' own tests. Shared checks (accessibility, security headers,
// offline support, privacy, sync) already run for every app from tests/e2e/.
// The locale is en-US, so times read "6:30 PM".
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { addReminder, editDialog, group, NOW, reminder, row, seed, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
});

const status = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });
const meta = (page: Page, text: string) => row(page, text).locator('.reminder__meta');

test('sets reminders and lists them by when they come next', async ({ page }) => {
  const form = page.locator('[data-add-form]');
  await expect(page.getByText('No reminders yet.', { exact: false })).toBeVisible();
  // The next full hour is suggested.
  await expect(form.getByLabel('Day')).toHaveValue('2026-10-21');
  await expect(form.getByLabel('Time')).toHaveValue('11:00');

  // Checked before it's set.
  await form.getByRole('button', { name: 'Add reminder' }).click();
  await expect(form.getByText('Write what to be reminded of.')).toBeVisible();
  await expect(form.getByLabel('Remind me to')).toBeFocused();
  await addReminder(page, 'Call the dentist', { time: '09:00' });
  await expect(form.getByText('Choose a time that’s still to come.')).toBeVisible();
  await expect(form.getByLabel('Time')).toBeFocused();
  await checkA11y(page, 'reminder problem');

  await form.getByLabel('Time').fill('18:30');
  await form.getByRole('button', { name: 'Add reminder' }).click();
  await expect(status(page, /Reminder set: Call the dentist, today at 6:30\sPM\./)).toBeAttached();
  await expect(form.getByLabel('Remind me to')).toHaveValue('');
  await expect(form.getByLabel('Remind me to')).toBeFocused();
  await expect(meta(page, 'Call the dentist')).toHaveText(/^Today at 6:30\sPM$/);

  // Ones that repeat: from their next time on.
  await addReminder(page, 'Take my pills', { time: '09:00', repeat: 'Every day' });
  await expect(meta(page, 'Take my pills')).toHaveText(/^Tomorrow at 9:00\sAM\s*Every day$/);
  await addReminder(page, 'Pay rent', { date: '2026-10-28', repeat: 'Every month' });
  await expect(meta(page, 'Pay rent')).toHaveText(
    /^Wednesday, October 28 at 11:00\sAM\s*Every month on the 28th$/,
  );
  await addReminder(page, 'Stand-up', {
    time: '09:30',
    repeat: 'Every weekday (Monday to Friday)',
  });
  await expect(meta(page, 'Stand-up')).toHaveText(/^Tomorrow at 9:30\sAM\s*Every weekday$/);
  // No tick box for one that repeats: it moves on by itself.
  await expect(row(page, 'Take my pills').getByRole('checkbox')).toHaveCount(0);

  await expect(page.locator('[data-groups] h3')).toHaveText(['Today', 'Tomorrow', 'Later']);
  await expect(group(page, 'Tomorrow').locator('li .reminder__text')).toHaveText([
    'Take my pills',
    'Stand-up',
  ]);
  await checkA11y(page, 'reminders');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'reminders (dark)');

  await page.reload();
  await expect(page.locator('li[data-id]')).toHaveCount(4);
});

test('ticks reminders done, puts off overdue ones, and clears done ones', async ({ page }) => {
  await seed(page, [
    reminder('a', 'Call the dentist', '2026-10-21', '09:00'),
    reminder('b', 'Buy bread', '2026-10-21', '12:00'),
    reminder('c', 'Post the letter', '2026-10-20', '08:00'),
  ]);
  await expect(page.locator('[data-groups] h3')).toHaveText(['Overdue', 'Today']);
  await expect(meta(page, 'Post the letter')).toHaveText(/^Yesterday at 8:00\sAM$/);

  // Later: in an hour, or tomorrow at its own time.
  await page.getByRole('button', { name: 'Call the dentist: remind me in 1 hour' }).click();
  await expect(status(page, /Call the dentist: today at 11:00\sAM\./)).toBeAttached();
  await expect(group(page, 'Today').locator('li .reminder__text')).toHaveText([
    'Call the dentist',
    'Buy bread',
  ]);
  await expect(row(page, 'Call the dentist').getByRole('checkbox')).toBeFocused();
  await page.getByRole('button', { name: 'Post the letter: remind me tomorrow' }).click();
  await expect(meta(page, 'Post the letter')).toHaveText(/^Tomorrow at 8:00\sAM$/);
  await expect(page.locator('[data-groups] h3')).toHaveText(['Today', 'Tomorrow']);

  // Done, and back again.
  await page.getByRole('checkbox', { name: 'Buy bread: done' }).click();
  await expect(status(page, 'Buy bread: done.')).toBeAttached();
  await expect(group(page, 'Today').locator('li')).toHaveCount(1);
  // Focus moves to the reminder now in its place.
  await expect(page.getByRole('checkbox', { name: 'Post the letter: done' })).toBeFocused();
  const done = page.locator('[data-done-section]');
  await expect(done.locator('summary')).toHaveText('Done (1)');
  await done.locator('summary').click();
  await expect(meta(page, 'Buy bread')).toHaveText(/^Done today at 10:00\sAM$/);
  await checkA11y(page, 'done');
  await page.getByRole('checkbox', { name: 'Buy bread: done' }).click();
  await expect(group(page, 'Today').locator('li .reminder__text')).toHaveText([
    'Call the dentist',
    'Buy bread',
  ]);
  await expect(done).toBeHidden();

  // Done again: the list of done ones is still open.
  await page.getByRole('checkbox', { name: 'Buy bread: done' }).click();
  await page.getByRole('button', { name: 'Clear done' }).click();
  await expect(status(page, 'Cleared the done reminders.')).toBeAttached();
  await expect(done).toBeHidden();
  await expect(page.getByRole('button', { name: 'Buy bread' })).toHaveCount(0);
});

test('changes and deletes a reminder', async ({ page }) => {
  await seed(page, [reminder('a', 'Water the plants', '2026-10-21', '18:30')]);
  await page.getByRole('button', { name: 'Water the plants' }).click();
  const dialog = editDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Change reminder' })).toBeVisible();
  await expect(dialog.getByLabel('Remind me to')).toHaveValue('Water the plants');
  await expect(dialog.getByLabel('Time')).toHaveValue('18:30');

  await dialog.getByLabel('Remind me to').fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Write what to be reminded of.')).toBeVisible();
  await checkA11y(page, 'change reminder');
  await dialog.getByLabel('Remind me to').fill('Water the garden');
  await dialog.getByLabel('Repeats').selectOption({ label: 'Every week' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(meta(page, 'Water the garden')).toHaveText(/^Today at 6:30\sPM\s*Every Wednesday$/);
  await expect(page.getByRole('button', { name: 'Water the garden' })).toBeFocused();

  // Deleting asks first.
  await page.getByRole('button', { name: 'Water the garden' }).click();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this reminder?' });
  await expect(confirm).toContainText('“Water the garden” will be removed.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog).toBeHidden();
  await expect(status(page, 'Deleted Water the garden.')).toBeAttached();
  await expect(page.getByText('No reminders yet.', { exact: false })).toBeVisible();
});
