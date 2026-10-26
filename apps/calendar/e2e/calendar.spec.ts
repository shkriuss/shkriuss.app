// Calendar's own tests. Shared checks (accessibility, security headers, offline
// support, privacy) already run for every app from tests/e2e/.
//
// The browser's clock is fixed to Saturday 17 October 2026, and the locale is
// en-US, so weeks start on Sunday and times read like "2:30 PM".
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { day, dayList, editor, monthHeading, newEvent, save, seed, upcoming } from './helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00'));
  await page.goto('/');
});

test('shows this month with today selected', async ({ page }) => {
  await expect(monthHeading(page)).toHaveText('October 2026');
  const today = day(page, /^Saturday, October 17, 2026, today/);
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  // "Sun", "S" (shown instead with large text: audit G-4) and "Sunday" for screen readers.
  await expect(page.locator('[data-weekdays] th').first()).toHaveText(/^SunSSunday$/);
  await expect(page.getByRole('columnheader').first()).toHaveAccessibleName('Sunday');
  await expect(page.locator('[data-day-heading]')).toHaveText('Today, Saturday, October 17');
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
  await expect(page.getByText('Nothing planned in the next 7 days.')).toBeVisible();
});

test('moves “today” along at midnight while it stays open', async ({ page }) => {
  // Left open overnight, on a tablet or a desktop (audit F1-12).
  await seed(page, [
    { title: 'Tomorrow’s walk', startDate: '2026-10-18', endDate: '2026-10-18' },
    { title: 'Next week’s run', startDate: '2026-10-25', endDate: '2026-10-25' },
  ]);
  await expect(day(page, /^Saturday, October 17, 2026, today/)).toHaveAttribute(
    'aria-current',
    'date',
  );
  await expect(upcoming(page).getByRole('button')).toHaveText([/Tomorrow’s walk/]);

  await page.clock.setFixedTime(new Date('2026-10-18T00:00:30'));
  await page.clock.runFor('01:00');
  await expect(day(page, /^Sunday, October 18, 2026, today/)).toHaveAttribute(
    'aria-current',
    'date',
  );
  await expect(day(page, /^Saturday, October 17, 2026/)).not.toHaveAttribute('aria-current');
  await expect(page.locator('[data-day-heading]')).toHaveText('Today, Sunday, October 18');
  await expect(dayList(page).getByRole('button')).toHaveText([/Tomorrow’s walk/]);
  // The next 7 days start on Monday now.
  await expect(upcoming(page).getByRole('button')).toHaveText([/Next week’s run/]);
});

test('in a Windows contrast theme, the chosen day and event dots still show', async ({ page }) => {
  // Contrast themes replace backgrounds with the theme's own colours (audit G-6).
  await seed(page, [{ startDate: '2026-10-20', endDate: '2026-10-20' }]);
  await page.emulateMedia({ forcedColors: 'active' });
  const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const backgroundOf = (element: Element) => getComputedStyle(element).backgroundColor;
  const chosen = await day(page, /^Saturday, October 17, 2026/).evaluate(backgroundOf);
  expect(chosen).not.toBe(canvas);
  expect(chosen).not.toMatch(/^rgba\(.*, 0\)$|transparent/);
  const dot = day(page, /^Tuesday, October 20, 2026/).locator('.day-cell__dot');
  const dotColour = await dot.evaluate(backgroundOf);
  expect(dotColour).not.toBe(canvas);
  expect(dotColour).not.toMatch(/^rgba\(.*, 0\)$|transparent/);
});

test('in a Windows contrast theme, today stands out from the other days', async ({ page }) => {
  // Every day's border was drawn there, so today was only bold (audit 4 G-10).
  await page.emulateMedia({ forcedColors: 'active' });
  await day(page, /^Tuesday, October 20, 2026/).click();
  const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const borderOf = (element: Element) => getComputedStyle(element).borderTopColor;
  const today = await day(page, /^Saturday, October 17, 2026, today/).evaluate(borderOf);
  const other = await day(page, /^Friday, October 23, 2026/).evaluate(borderOf);
  expect(other).toBe(canvas);
  expect(today).not.toBe(canvas);
  // With focus, today shows the focus ring, not its thinner frame (audit 4 G-10).
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowLeft');
  const focused = day(page, /^Saturday, October 17, 2026, today/);
  await expect(focused).toBeFocused();
  const outline = await focused.evaluate((element) => {
    const { outlineStyle, outlineWidth, outlineOffset } = getComputedStyle(element);
    return { outlineStyle, outlineWidth, outlineOffset };
  });
  expect(outline).toEqual({ outlineStyle: 'solid', outlineWidth: '3px', outlineOffset: '2px' });
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

test('loads the event editor only when it first opens', async ({ page }) => {
  // So the page starts with less to load (audit 3 J-11).
  const loaded: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/_astro/event-editor.')) loaded.push(request.url());
  });
  await page.reload();
  await expect(monthHeading(page)).toHaveText('October 2026');
  await expect(page.locator('[data-weeks] button').first()).toBeVisible();
  expect(loaded).toEqual([]);

  await newEvent(page, 'Dentist');
  expect(loaded).toHaveLength(1);
  await save(page);
  await expect(dayList(page).getByRole('button', { name: /Dentist/ })).toBeFocused();
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

test('saving keeps what changed elsewhere while the editor was open', async ({ page }) => {
  await seed(page, [{ title: 'Dentist', reminder: 15 }]);
  await dayList(page)
    .getByRole('button', { name: /Dentist/ })
    .click();
  // Meanwhile, another tab (or a sync from another device) moves it to the
  // afternoon and changes its reminder.
  const other = await page.context().newPage();
  await other.goto('/');
  await dayList(other)
    .getByRole('button', { name: /Dentist/ })
    .click();
  await editor(other).getByLabel('Start time').fill('14:00');
  await editor(other).getByLabel('End time (optional)').fill('15:00');
  await editor(other).getByLabel('Reminder').selectOption({ label: '1 hour before' });
  await save(other);
  await other.close();

  // Only the notes are changed here (audit F1-2).
  await editor(page).getByLabel('Notes (optional)').fill('Bring the X-ray');
  await save(page);
  const item = dayList(page).getByRole('button', { name: /Dentist/ });
  await expect(item).toHaveAccessibleName(/^2:00\sPM – 3:00\sPM, Dentist, with a reminder$/);
  await item.click();
  await expect(editor(page).getByLabel('Notes (optional)')).toHaveValue('Bring the X-ray');
  await expect(editor(page).getByLabel('Reminder')).toHaveValue('60');
});

/** Deletes Dentist in another tab (as a sync from another device would). */
async function deleteElsewhere(page: Page): Promise<void> {
  const other = await page.context().newPage();
  await other.goto('/');
  await dayList(other)
    .getByRole('button', { name: /Dentist/ })
    .click();
  await editor(other).getByRole('button', { name: 'Delete' }).click();
  await other
    .getByRole('dialog', { name: 'Delete this event?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(other.getByText('Nothing planned on this day.')).toBeVisible();
  await other.close();
}

const GONE =
  'This event was deleted on another device or in another tab. Saving a change brings it back.';

test('saving an event deleted elsewhere meanwhile keeps it, with the change', async ({ page }) => {
  await seed(page, [{ title: 'Dentist' }]);
  await dayList(page)
    .getByRole('button', { name: /Dentist/ })
    .click();
  await deleteElsewhere(page);
  // Said in the editor, and read out there (audit 4 F1-3, G-2).
  await expect(editor(page).locator('[data-gone-note]')).toHaveText(GONE);
  await expect(editor(page).locator('[data-dialog-messages]')).toHaveText(GONE);
  await checkA11y(page, 'editor of an event deleted elsewhere');

  // A change wins over a deletion, as with sync (audit F1-3).
  await editor(page).getByLabel('Notes (optional)').fill('Bring the X-ray');
  await save(page);
  await expect(page.getByRole('status').filter({ hasText: 'Saved Dentist.' })).toBeAttached();
  await expect(dayList(page).getByRole('button', { name: /Dentist/ })).toBeFocused();
  await page.reload();
  await dayList(page)
    .getByRole('button', { name: /Dentist/ })
    .click();
  await expect(editor(page).getByLabel('Notes (optional)')).toHaveValue('Bring the X-ray');
  await expect(editor(page).locator('[data-gone-note]')).toBeHidden();
});

test('an event deleted elsewhere stays deleted after Save with no change, or Delete', async ({
  page,
}) => {
  // Save put it back everywhere, and Delete did nothing (audit 4 F1-3).
  await seed(page, [{ title: 'Dentist' }]);
  const open = () =>
    dayList(page)
      .getByRole('button', { name: /Dentist/ })
      .click();
  await open();
  await deleteElsewhere(page);
  await expect(editor(page).locator('[data-gone-note]')).toHaveText(GONE);
  await save(page);
  await expect(editor(page)).toBeHidden();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Dentist stays deleted: nothing in it was changed.' }),
  ).toBeAttached();
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New event' })).toBeFocused();

  await seed(page, [{ title: 'Dentist' }]);
  await open();
  await deleteElsewhere(page);
  await editor(page).getByRole('button', { name: 'Delete' }).click();
  await expect(editor(page)).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Dentist was already deleted.' }),
  ).toBeAttached();
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

test('keeps focus on the same day’s copy of a repeating event when the list is drawn again', async ({
  page,
}) => {
  // Every day's "Gym" was the same item, so focus jumped to the first (audit 4 G-3).
  await seed(page, [{ title: 'Gym', repeat: 'daily' }]);
  const gyms = upcoming(page).getByRole('button', { name: /Gym/ });
  await expect(gyms).toHaveCount(7);
  const fourth = gyms.nth(3);
  const name = await fourth.getAttribute('aria-label');
  await fourth.focus();
  // Another tab adds an event: this one draws its lists again.
  const other = await page.context().newPage();
  await other.clock.setFixedTime(new Date('2026-10-17T10:00:00'));
  await other.goto('/');
  await newEvent(other, 'Dentist');
  await save(other);
  await expect(dayList(page).getByRole('button')).toHaveCount(2);
  await expect(page.locator(':focus')).toHaveAttribute('aria-label', name ?? '');
  await other.close();
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

test('says the month again only when it changes', async ({ page }) => {
  // The heading is a live region: its text was set again at every arrow key,
  // save and sync, so screen readers could repeat "October 2026" (audit 3 G-10).
  await page.evaluate(() => {
    const said: string[] = [];
    (window as unknown as { said: string[] }).said = said;
    const heading = document.querySelector('[data-month-title]');
    if (!heading) return;
    new MutationObserver(() => said.push(heading.textContent ?? '')).observe(heading, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  const said = () => page.evaluate(() => (window as unknown as { said: string[] }).said);
  await day(page, /^Saturday, October 17, 2026/).focus();
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft']) await page.keyboard.press(key);
  await newEvent(page, 'Dentist');
  await save(page);
  await expect(dayList(page).getByRole('button', { name: /Dentist/ })).toBeVisible();
  expect(await said()).toEqual([]);

  await day(page, /^Saturday, October 24, 2026/).focus();
  await page.keyboard.press('PageDown');
  await expect(monthHeading(page)).toHaveText('November 2026');
  expect(await said()).toEqual(['November 2026']);
});

test('reads out a missing title after Enter in the title box', async ({ page }) => {
  await newEvent(page, '');
  const title = editor(page).getByLabel('Title');
  await title.press('Enter');
  await expect(title).toBeFocused();
  // Focus is there already, so the problem is read out instead (audit G-3).
  await expect(editor(page).getByRole('alert').filter({ hasText: 'Title:' })).toHaveText(
    'Title: Enter a title.',
  );
});

test('downloads events as an .ics file', async ({ page }) => {
  await page.getByRole('button', { name: 'Download .ics file' }).click();
  // Shown under the button too, not only read out (audit G-1).
  await expect(
    page.getByRole('status').filter({ hasText: 'There are no events to download yet.' }),
  ).toBeVisible();

  await seed(page, [{ title: 'Dentist', startTime: '14:30', endTime: '15:30', reminder: 15 }]);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .ics file' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('calendar-2026-10-17.ics');
  const ics = await readFile(await download.path(), 'utf8');
  expect(ics).toContain('BEGIN:VEVENT\r\n');
  expect(ics).toContain('SUMMARY:Dentist\r\n');
  expect(ics).toContain('DTSTART:20261017T143000\r\n');
  expect(ics).toContain('TRIGGER:-PT15M\r\n');
});

test('says so when the file can’t be made', async ({ page, guard }) => {
  // What writes the file loads only when it's needed; here it can't.
  guard.allowConsole('net::ERR_FAILED');
  await seed(page, [{ title: 'Dentist' }]);
  await page.route('**/_astro/ics.*.js', (route) => route.abort());
  await page.getByRole('button', { name: 'Download .ics file' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Calendar couldn’t make the file. Please try again.' }),
  ).toBeVisible();
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
