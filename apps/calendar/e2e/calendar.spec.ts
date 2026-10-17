// Calendar's own tests. Shared checks (accessibility, security headers, offline
// support, privacy) already run for every app from tests/e2e/.
//
// The browser's clock is fixed to Saturday 17 October 2026, and the locale is
// en-US, so weeks start on Sunday and times read like "2:30 PM".
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import type { CalendarEvent } from '../src/lib/events.ts';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00'));
  await page.goto('/');
});

/** Saves events straight into storage, then reloads the page. */
async function seed(page: Page, events: Partial<CalendarEvent>[]): Promise<void> {
  const full = events.map((event, index) => ({
    id: `seed-${index}`,
    title: 'Event',
    startDate: '2026-10-17',
    endDate: '2026-10-17',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    notes: '',
    ...event,
  }));
  await page.evaluate((data) => {
    localStorage.setItem('shkriuss:calendar', JSON.stringify({ v: 1, data: { events: data } }));
  }, full);
  await page.reload();
}

const editor = (page: Page) => page.getByRole('dialog', { name: /^(New|Edit) event$/ });
const dayList = (page: Page) => page.locator('[data-day-events]');
const upcoming = (page: Page) => page.locator('[data-upcoming]');
const day = (page: Page, label: string | RegExp) =>
  page.locator('[data-weeks]').getByRole('button', { name: label });
const monthHeading = (page: Page) => page.locator('#month-heading');

async function newEvent(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New event' }).click();
  await expect(editor(page)).toBeVisible();
  await editor(page).getByLabel('Title').fill(title);
}

const save = (page: Page) => editor(page).getByRole('button', { name: 'Save' }).click();

test('shows this month with today selected', async ({ page }) => {
  await expect(monthHeading(page)).toHaveText('October 2026');
  const today = day(page, /^Saturday, October 17, 2026, today/);
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-weekdays] th').first()).toHaveText(/^SunSunday$/);
  await expect(page.locator('[data-day-heading]')).toHaveText('Today, Saturday, October 17');
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
  await expect(page.getByText('Nothing planned in the next 7 days.')).toBeVisible();
});

test('adds an event and remembers it after a reload', async ({ page }) => {
  await newEvent(page, 'Dentist');
  await editor(page).getByLabel('Start time').fill('14:30');
  await editor(page).getByLabel('End time (optional)').fill('15:30');
  await editor(page).getByLabel('Notes (optional)').fill('Bring the card');
  await save(page);

  await expect(editor(page)).toBeHidden();
  const item = dayList(page).getByRole('button', { name: /Dentist/ });
  await expect(item).toHaveAccessibleName(/^2:30\sPM – 3:30\sPM, Dentist$/);
  await expect(item).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Dentist.' })).toBeAttached();
  await expect(day(page, /October 17, 2026, today, 1 event$/)).toBeVisible();

  await page.reload();
  await expect(dayList(page).getByRole('button', { name: /Dentist/ })).toBeVisible();
  await dayList(page)
    .getByRole('button', { name: /Dentist/ })
    .click();
  await expect(editor(page).getByLabel('Notes (optional)')).toHaveValue('Bring the card');
});

test('edits and deletes an event, with a confirmation', async ({ page }) => {
  await seed(page, [{ title: 'Dentist' }]);
  await dayList(page)
    .getByRole('button', { name: /Dentist/ })
    .click();
  await expect(editor(page)).toHaveAccessibleName('Edit event');
  await expect(editor(page).getByLabel('Title')).toHaveValue('Dentist');
  await editor(page).getByLabel('Title').fill('Dentist check-up');
  await save(page);
  await expect(dayList(page).getByRole('button', { name: /Dentist check-up/ })).toBeFocused();

  await dayList(page)
    .getByRole('button', { name: /Dentist check-up/ })
    .click();
  await editor(page).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete this event?' });
  await expect(confirm).toContainText('“Dentist check-up” will be removed.');
  await checkA11y(page, 'delete dialog');

  // Cancel goes back to editing.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(editor(page)).toBeVisible();

  await editor(page).getByRole('button', { name: 'Delete' }).click();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(editor(page)).toBeHidden();
  await expect(dayList(page).getByRole('button')).toHaveCount(0);
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New event' })).toBeFocused();

  await page.reload();
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
});

test('closing the editor without saving changes nothing', async ({ page }) => {
  await newEvent(page, 'Not this one');
  await editor(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(editor(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'New event' })).toBeFocused();

  await newEvent(page, 'Nor this one');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toBeHidden();
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
});

test('repeats an event every week until a date', async ({ page }) => {
  await newEvent(page, 'Yoga');
  const repeat = editor(page).getByLabel('Repeats', { exact: true });
  const until = editor(page).getByLabel('Until (optional)');
  await expect(until).toBeHidden();
  await repeat.selectOption('weekly');
  await expect(until).toBeVisible();
  await until.fill('2026-10-31');
  await save(page);

  await expect(
    upcoming(page).getByRole('button', {
      name: /^Sat, Oct 24 · 9:00\sAM – 10:00\sAM, Yoga, repeats$/,
    }),
  ).toBeVisible();
  await expect(day(page, /October 31, 2026, 1 event$/)).toBeVisible();

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(monthHeading(page)).toHaveText('November 2026');
  await expect(day(page, 'Saturday, November 7, 2026')).toBeVisible();

  // Editing a repeating event explains that changes apply to every time.
  await page.getByRole('button', { name: 'Today' }).click();
  await dayList(page).getByRole('button', { name: /Yoga/ }).click();
  await expect(editor(page).getByText('This event repeats.')).toBeVisible();
  await editor(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete this event?' })).toContainText(
    'including every time it repeats',
  );
});

test('adds an all-day event that lasts several days', async ({ page }) => {
  await newEvent(page, 'Trip');
  await editor(page).getByLabel('All day').check();
  await expect(editor(page).getByLabel('Start time')).toBeHidden();
  await editor(page).getByLabel('Starts').fill('2026-10-20');
  await expect(editor(page).getByLabel('Ends')).toHaveValue('2026-10-20');
  await editor(page).getByLabel('Ends').fill('2026-10-23');
  await save(page);

  // After saving, the calendar shows the day the event starts.
  await expect(page.locator('[data-day-heading]')).toHaveText('Tuesday, October 20');
  await expect(dayList(page).getByRole('button', { name: 'All day, Trip' })).toBeVisible();
  for (const date of [20, 21, 22, 23]) {
    await expect(day(page, new RegExp(`October ${date}, 2026, 1 event$`))).toBeVisible();
  }
  await expect(day(page, 'Saturday, October 24, 2026')).toBeVisible();
  await expect(upcoming(page).getByRole('button', { name: /Trip/ })).toHaveCount(1);

  // Editing it from a later day stays on that day.
  await day(page, /^Thursday, October 22, 2026/).click();
  await dayList(page).getByRole('button', { name: 'All day, Trip' }).click();
  await editor(page).getByLabel('Title').fill('Trip to the sea');
  await save(page);
  await expect(page.locator('[data-day-heading]')).toHaveText('Thursday, October 22');
  await expect(
    dayList(page).getByRole('button', { name: 'All day, Trip to the sea' }),
  ).toBeFocused();
});

test('moving the start moves the end by the same amount', async ({ page }) => {
  await newEvent(page, 'Meeting');
  await editor(page).getByLabel('Ends').fill('2026-10-18');
  await editor(page).getByLabel('Starts').fill('2026-10-20');
  await expect(editor(page).getByLabel('Ends')).toHaveValue('2026-10-21');
  await editor(page).getByLabel('Start time').fill('13:30');
  await expect(editor(page).getByLabel('End time (optional)')).toHaveValue('14:30');
});

test('explains problems next to each field', async ({ page }) => {
  await page.getByRole('button', { name: 'New event' }).click();
  await save(page);
  const title = editor(page).getByLabel('Title');
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toHaveAccessibleDescription('Enter a title.');
  await expect(title).toBeFocused();

  await title.fill('Party');
  await expect(title).not.toHaveAttribute('aria-invalid');
  await editor(page).getByLabel('End time (optional)').fill('08:00');
  await save(page);
  const endTime = editor(page).getByLabel('End time (optional)');
  await expect(endTime).toHaveAccessibleDescription('The end time must be after the start time.');
  await expect(endTime).toBeFocused();
  await checkA11y(page, 'editor with problems');

  await editor(page).getByLabel('Ends').fill('2026-10-16');
  await save(page);
  await expect(editor(page).getByLabel('Ends')).toHaveAccessibleDescription(
    'The end date must be on or after the start date.',
  );
  await expect(editor(page)).toBeVisible();
});

test('moves between days and months', async ({ page }) => {
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(monthHeading(page)).toHaveText('September 2026');
  await expect(page.locator('[data-day-heading]')).toHaveText('Tuesday, September 1');
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(monthHeading(page)).toHaveText('October 2026');

  await day(page, /^Thursday, October 22, 2026/).click();
  await expect(day(page, /^Thursday, October 22, 2026/)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-day-heading]')).toHaveText('Thursday, October 22');
});

test('moves between days with the keyboard', async ({ page }) => {
  // Only one day in the grid is in the Tab order.
  await expect(page.locator('[data-weeks] button[tabindex="0"]')).toHaveCount(1);
  const selected = page.locator('[data-weeks] [aria-pressed="true"]');
  await day(page, /^Saturday, October 17, 2026/).focus();

  const steps: [string, RegExp][] = [
    ['ArrowRight', /^Sunday, October 18, 2026/],
    ['ArrowDown', /^Sunday, October 25, 2026/],
    ['ArrowLeft', /^Saturday, October 24, 2026/],
    ['ArrowUp', /^Saturday, October 17, 2026/],
    ['Home', /^Sunday, October 11, 2026/],
    ['End', /^Saturday, October 17, 2026/],
    ['PageDown', /^Tuesday, November 17, 2026/],
    ['Shift+PageUp', /^Monday, November 17, 2025/],
  ];
  for (const [key, label] of steps) {
    await page.keyboard.press(key);
    await expect(selected).toHaveAccessibleName(label);
    await expect(selected).toBeFocused();
  }
  await expect(monthHeading(page)).toHaveText('November 2025');
});

test('downloads events as an .ics file', async ({ page }) => {
  await page.getByRole('button', { name: 'Download .ics file' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'There are no events to download yet.' }),
  ).toBeAttached();

  await seed(page, [{ title: 'Dentist', startTime: '14:30', endTime: '15:30' }]);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .ics file' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('calendar-2026-10-17.ics');
  const ics = await readFile(await download.path(), 'utf8');
  expect(ics).toContain('BEGIN:VEVENT\r\n');
  expect(ics).toContain('SUMMARY:Dentist\r\n');
  expect(ics).toContain('DTSTART:20261017T143000\r\n');
});

test('passes accessibility checks with events, in both themes', async ({ page }) => {
  await seed(page, [
    { title: 'Dentist' },
    { title: 'Birthday', startTime: null, endTime: null, repeat: 'yearly' },
    {
      title: 'Trip',
      startDate: '2026-10-19',
      endDate: '2026-10-21',
      startTime: null,
      endTime: null,
    },
  ]);
  await checkA11y(page, 'with events (light)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await checkA11y(page, 'with events (dark)');
  await dayList(page)
    .getByRole('button', { name: /Dentist/ })
    .click();
  await checkA11y(page, 'editor (dark)');
});

test('ignores saved data it does not understand', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('shkriuss:calendar', JSON.stringify({ v: 1, data: { events: 'oops' } }));
  });
  await page.reload();
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
});
