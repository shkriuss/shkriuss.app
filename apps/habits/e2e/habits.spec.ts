// Habits: adding, marking done, streaks, editing days and past days, deleting,
// and a new day starting while the app is open. Shared checks (accessibility,
// security headers, offline, privacy) run for every app from tests/e2e/.
import type { Page } from '@playwright/test';
import { checkA11y, expect, failSaving, test } from '../../../tests/e2e/fixtures.ts';

test.use({ timezoneId: 'Europe/Berlin' });

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
  await expect(confirm).toContainText('“Remove me” and all its check marks will be removed.');
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
