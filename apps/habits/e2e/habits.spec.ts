// Habits: adding, marking done, streaks, editing days and past days, deleting,
// and a new day starting while the app is open. Shared checks (accessibility,
// security headers, offline, privacy) run for every app from tests/e2e/.
import type { Page } from '@playwright/test';
import { addDays } from '@shkriuss/dates';
import { checkA11y, expect, failSaving, test } from '../../../tests/e2e/fixtures.ts';
import { seedStores } from '../../../tests/e2e/storage.ts';
import {
  checkId,
  CHECKS_VERSION,
  EVERY_DAY,
  HABITS_VERSION,
  MAX_CHECKS,
  type Check,
  type Habit,
} from '../src/lib/habits.ts';

test.use({ timezoneId: 'Europe/Berlin' });

/** Saves habits and check marks straight into storage, then reloads. */
async function seed(page: Page, habits: Habit[], checks: Check[]): Promise<void> {
  await seedStores(page, {
    habits: { version: HABITS_VERSION, data: { habits } },
    'habit-checks': { version: CHECKS_VERSION, data: { checks } },
  });
}

/** Habits ticked every day back from yesterday, one after another: `count` check marks. */
function ticked(habits: readonly Habit[], count: number): Check[] {
  return Array.from({ length: count }, (_, index) => {
    const habit = habits[index % habits.length]?.id ?? '';
    const date = addDays('2026-10-18', -Math.floor(index / habits.length));
    return { id: checkId(habit, date), habit, date };
  });
}

const card = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
const doneToday = (page: Page, name: string) =>
  page.getByRole('button', { name: `${name}: done today` });
const streak = (page: Page, name: string) => card(page, name).locator('[data-streak]');
const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit habit' });

async function addHabit(page: Page, name: string): Promise<void> {
  await page.getByLabel('New habit').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card(page, name)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Monday 19 October 2026, mid-morning.
  await page.clock.install({ time: new Date('2026-10-19T10:00:00+02:00') });
  await page.goto('/');
});

test('adds a habit, marks today done, and remembers it', async ({ page }) => {
  await expect(page.getByText('No habits yet')).toBeVisible();
  await expect(page.locator('[data-today]')).toHaveText('Monday, October 19');
  await checkA11y(page, 'no habits');

  await addHabit(page, 'Drink water');
  await expect(card(page, 'Drink water')).toContainText('Every day');
  await expect(streak(page, 'Drink water')).toHaveText('No streak yet');
  const done = doneToday(page, 'Drink water');
  await expect(done).toHaveAttribute('aria-pressed', 'false');
  await done.click();
  await expect(done).toHaveAttribute('aria-pressed', 'true');
  await expect(done).toBeFocused();
  await expect(streak(page, 'Drink water')).toHaveText('1-day streak');
  await expect(card(page, 'Drink water').locator('[data-week-summary]')).toHaveText(
    'Last 7 days: done 1 time.',
  );
  // Only the day that's done shows a tick; the others are rings (audit G-5).
  const marks = card(page, 'Drink water').locator('[data-day-mark] svg');
  await expect(marks).toHaveCount(7);
  await expect(marks.filter({ visible: true })).toHaveCount(1);
  await expect(
    page.getByRole('status').filter({ hasText: 'Drink water: done today.' }),
  ).toBeAttached();

  await page.reload();
  await expect(doneToday(page, 'Drink water')).toHaveAttribute('aria-pressed', 'true');
  await checkA11y(page, 'with a habit');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'with a habit (dark)');

  // Tapping again takes it back.
  await doneToday(page, 'Drink water').click();
  await expect(streak(page, 'Drink water')).toHaveText('No streak yet');
});

test('in a Windows contrast theme, “Done today” still shows when it’s on', async ({ page }) => {
  // Contrast themes replace backgrounds with the theme's own colours (audit G-6).
  await addHabit(page, 'Drink water');
  await addHabit(page, 'Read');
  await doneToday(page, 'Read').click();
  await page.emulateMedia({ forcedColors: 'active' });
  const backgroundOf = (element: Element) => getComputedStyle(element).backgroundColor;
  const on = await doneToday(page, 'Read').evaluate(backgroundOf);
  const off = await doneToday(page, 'Drink water').evaluate(backgroundOf);
  expect(on).not.toBe(off);
});

test('explains problems with a name', async ({ page }) => {
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Enter a name for the habit.')).toBeVisible();
  await expect(page.getByLabel('New habit')).toHaveAttribute('aria-invalid', 'true');
  await addHabit(page, 'Read');
  await page.getByLabel('New habit').fill('read');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('You already have a habit with that name.')).toBeVisible();
});

test('edits the name, the planned days and past days', async ({ page }) => {
  await addHabit(page, 'Run');
  await page.getByRole('button', { name: 'Edit Run' }).click();
  await expect(editor(page)).toBeVisible();
  await checkA11y(page, 'edit dialog');

  await editor(page).getByLabel('Name').fill('Morning run');
  for (const day of ['Saturday', 'Sunday']) {
    await editor(page).getByLabel(day, { exact: true }).uncheck();
  }
  // Done on Friday and Thursday (the weekend isn't planned, so the streak goes on).
  await editor(page).getByLabel('Friday, October 16').check();
  await editor(page).getByLabel('Thursday, October 15').check();
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page)).toBeHidden();

  await expect(card(page, 'Morning run')).toContainText('Weekdays');
  await expect(streak(page, 'Morning run')).toHaveText('2-day streak');
  await doneToday(page, 'Morning run').click();
  await expect(streak(page, 'Morning run')).toHaveText('3-day streak');

  // At least one day must be planned.
  await page.getByRole('button', { name: 'Edit Morning run' }).click();
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
    await editor(page).getByLabel(day, { exact: true }).uncheck();
  }
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page).getByText('Choose at least one day.')).toBeVisible();
  await editor(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(card(page, 'Morning run')).toContainText('Weekdays');
});

test('saving the editor keeps what changed elsewhere while it was open', async ({ page }) => {
  await addHabit(page, 'Run');
  await page.getByRole('button', { name: 'Edit Run' }).click();
  // Meanwhile, another tab (or a sync from another device) plans it for weekdays only.
  const other = await page.context().newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Edit Run' }).click();
  for (const day of ['Saturday', 'Sunday']) {
    await editor(other).getByLabel(day, { exact: true }).uncheck();
  }
  await editor(other).getByRole('button', { name: 'Save' }).click();
  await expect(card(other, 'Run')).toContainText('Weekdays');
  await other.close();

  // Only the name is changed here (audit F1-2).
  await editor(page).getByLabel('Name').fill('Morning run');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(card(page, 'Morning run')).toContainText('Weekdays');
});

test('says so when the habit being edited is deleted on another device', async ({ page }) => {
  // The form closed by itself, and what was typed went, without a word (audit 3 G-6).
  await addHabit(page, 'Read');
  const other = await page.context().newPage();
  await other.goto('/');
  await page.bringToFront();
  await page.getByRole('button', { name: 'Edit Read' }).click();
  await editor(page).getByLabel('Name').fill('Read a book every evening');

  // Deleted in another tab, as a sync from another device does.
  await other.getByRole('button', { name: 'Edit Read' }).click();
  await editor(other).getByRole('button', { name: 'Delete' }).click();
  await other
    .getByRole('dialog', { name: 'Delete this habit?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(editor(page)).toBeHidden();
  await expect(page.getByRole('alert')).toHaveText('That habit was deleted on another device.');
  await expect(card(page, 'Read')).toHaveCount(0);
});

test('says when a habit isn’t planned for today', async ({ page }) => {
  await addHabit(page, 'Long walk');
  await page.getByRole('button', { name: 'Edit Long walk' }).click();
  for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
    await editor(page).getByLabel(day, { exact: true }).uncheck();
  }
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(card(page, 'Long walk')).toContainText('Weekends');
  await expect(card(page, 'Long walk')).toContainText('Not planned for today');
});

test('deletes a habit after asking', async ({ page }) => {
  await addHabit(page, 'Keep');
  await addHabit(page, 'Remove me');
  await page.getByRole('button', { name: 'Edit Remove me' }).click();
  await editor(page).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this habit?' });
  await expect(confirm).toContainText(
    '“Remove me” and all its check marks will be removed. This can’t be undone.',
  );
  // Read out with the title, before "Cancel" (audit 5 G-3).
  await expect(confirm).toHaveAccessibleDescription(
    /“Remove me” and all its check marks will be removed\. This\s+can’t be undone\./,
  );
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(card(page, 'Remove me')).toHaveCount(0);
  await expect(card(page, 'Keep')).toBeVisible();
  await expect(page.getByLabel('New habit')).toBeFocused();
});

test('starts a new day while open, keeping the streak', async ({ page }) => {
  await addHabit(page, 'Stretch');
  await doneToday(page, 'Stretch').click();
  await page.clock.fastForward('24:00:00');
  await expect(page.locator('[data-today]')).toHaveText('Tuesday, October 20');
  await expect(doneToday(page, 'Stretch')).toHaveAttribute('aria-pressed', 'false');
  await expect(streak(page, 'Stretch')).toHaveText('1-day streak');
});

test('“Done today” just after midnight ticks the new day', async ({ page }) => {
  // The page looks for a new day once a minute: a tick at 00:00:10 went on
  // yesterday, and a minute later today showed as not done (audit 5 F1-7).
  await page.clock.setSystemTime(new Date('2026-10-19T23:59:40+02:00'));
  await page.reload();
  await addHabit(page, 'Stretch');
  await expect(page.locator('[data-today]')).toHaveText('Monday, October 19');
  await page.clock.pauseAt(new Date('2026-10-20T00:00:10+02:00'));
  await doneToday(page, 'Stretch').click();
  await expect(page.locator('[data-today]')).toHaveText('Tuesday, October 20');
  await expect(doneToday(page, 'Stretch')).toHaveAttribute('aria-pressed', 'true');
  await expect(streak(page, 'Stretch')).toHaveText('1-day streak');
  // Still so once the page notices the new day by itself.
  await page.clock.runFor('01:00');
  await expect(doneToday(page, 'Stretch')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'Stretch').locator('[data-week-summary]')).toHaveText(
    'Last 7 days: done 1 time.',
  );
});

test('deletes the check marks from a year, to make room', async ({ page }) => {
  // Read every day since 20 December 2025, up to yesterday (audit F1-5).
  const read: Habit = { id: 'read', name: 'Read', days: [...EVERY_DAY] };
  const days = 303;
  await seed(page, [read], ticked([read], days));
  await expect(streak(page, 'Read')).toHaveText('303-day streak');
  const deleteYear = page.getByRole('button', { name: 'Delete check marks from a year…' });
  await deleteYear.click();
  const dialog = page.getByRole('dialog', { name: 'Delete check marks from a year' });
  const year = dialog.getByLabel('Year');
  await expect(year).toBeFocused();
  await expect(year.locator('option')).toHaveText([
    '2025 (12 check marks)',
    '2026 (291 check marks)',
  ]);
  // The oldest year to begin with.
  await expect(year).toHaveValue('2025');
  await expect(dialog.locator('[data-year-text]')).toHaveText(
    'The 12 check marks from 2025 will be deleted, for every habit. Streaks then count only the days that are kept. With sync on, they’re deleted on your other devices too. This can’t be undone.',
  );
  await checkA11y(page, 'delete check marks from a year');
  // Cancel deletes nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(streak(page, 'Read')).toHaveText('303-day streak');

  await deleteYear.click();
  await dialog.getByRole('button', { name: 'Delete 12 check marks' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Deleted 12 check marks from 2025.' }),
  ).toBeAttached();
  await expect(deleteYear).toBeFocused();
  // The streak counts the days kept: from 1 January.
  await expect(streak(page, 'Read')).toHaveText('291-day streak');
});

test('says when Habits is nearly full, and how to make room', async ({ page }) => {
  const habits = Array.from({ length: 10 }, (_, index): Habit => ({
    id: `h${index}`,
    name: `Habit ${index + 1}`,
    days: [...EVERY_DAY],
  }));
  // Just over 90% of the check marks Habits keeps.
  await seed(page, habits, ticked(habits, MAX_CHECKS * 0.9 + 1));
  const note = page.locator('[data-room-note]');
  const makeRoom = 'To make room, use “Delete check marks from a year…” under Check marks, below.';
  await expect(note).toHaveText(
    `Habits is nearly full: there’s room for 999 more check marks (it keeps up to 10,000). ${makeRoom}`,
  );
  await checkA11y(page, 'nearly full');

  // Full: a tick waits until there's room, and says how to make it.
  await seed(page, habits, ticked(habits, MAX_CHECKS));
  await expect(note).toHaveText(`Habits is full: it keeps up to 10,000 check marks. ${makeRoom}`);
  await doneToday(page, 'Habit 1').click();
  await expect(page.getByRole('alert')).toHaveText(
    /Habits keeps up to 10,000 check marks\. To make room, delete the check marks from a year \(under Check marks\)\./,
  );
  await expect(doneToday(page, 'Habit 1')).toHaveAttribute('aria-pressed', 'false');

  // Deleting the oldest year makes room, and the tick can be made.
  await page.getByRole('button', { name: 'Delete check marks from a year…' }).click();
  await page
    .getByRole('dialog', { name: 'Delete check marks from a year' })
    .getByRole('button', { name: /^Delete [\d,]+ check marks$/ })
    .click();
  await expect(note).toBeHidden();
  await expect(page.getByRole('alert')).toBeHidden();
  await doneToday(page, 'Habit 1').click();
  await expect(doneToday(page, 'Habit 1')).toHaveAttribute('aria-pressed', 'true');
});

test('reads out a name’s problem after Enter in the field, in the editor too', async ({ page }) => {
  await addHabit(page, 'Read');
  await addHabit(page, 'Walk');
  await page.getByLabel('New habit').fill('read');
  await page.getByLabel('New habit').press('Enter');
  await expect(page.getByRole('alert')).toHaveText(
    'New habit: You already have a habit with that name.',
  );

  await card(page, 'Walk').getByRole('button', { name: 'Edit Walk' }).click();
  const name = editor(page).getByLabel('Name');
  await name.fill('');
  await name.press('Enter');
  await expect(name).toBeFocused();
  await expect(editor(page).getByRole('alert')).toHaveText(/^Name: /);
});

test('says so when marking a habit done can’t be saved', async ({ page }) => {
  await addHabit(page, 'Read');
  await failSaving(page);
  await doneToday(page, 'Read').click();
  const problem = page.getByRole('alert');
  await expect(problem).toBeVisible();
  await expect(problem).toHaveText(/^Couldn’t save/);
  // Not told it's done, as if it were kept (audit G-1).
  await expect(page.getByRole('status').filter({ hasText: 'Read: done today.' })).toHaveCount(0);
});
