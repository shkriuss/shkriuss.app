// Importing .ics files. The browser runs in Tbilisi time (UTC+4), so times
// written in UTC (as Google Calendar does) must move by 4 hours.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { dayList, upcoming } from './helpers.ts';

test.use({ timezoneId: 'Asia/Tbilisi' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00+04:00'));
  await page.goto('/');
});

const WORK_FILE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:call-1@google.com',
  'DTSTART:20261017T103000Z',
  'DTEND:20261017T113000Z',
  'SUMMARY:Team call',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT10M',
  'END:VALARM',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:holiday-1@google.com',
  'DTSTART;VALUE=DATE:20261020',
  'DTEND;VALUE=DATE:20261021',
  'SUMMARY:Day off',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:biweekly@google.com',
  'DTSTART:20261021T090000',
  'RRULE:FREQ=WEEKLY;INTERVAL=2',
  'SUMMARY:Every other Wednesday',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

/** Picks a file with the "Import .ics file" button. */
async function importFile(page: Page, name: string, text: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .ics file' }).click();
  await (await chooser).setFiles({ name, mimeType: 'text/calendar', buffer: Buffer.from(text) });
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Import events' });

test('imports events after showing what will be added', async ({ page }) => {
  await importFile(page, 'work.ics', WORK_FILE);
  await expect(dialog(page)).toContainText('Found 3 events in “work.ics”.');
  await expect(dialog(page).getByRole('listitem')).toHaveText([
    'Every other Wednesday: It repeats in a way Calendar can’t show yet (for example every 2 weeks).',
  ]);
  await checkA11y(page, 'import dialog');

  await dialog(page).getByRole('button', { name: 'Add 2 events' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: 'Added 2 events from the file.' }),
  ).toBeAttached();
  // 10:30 UTC is 2:30 PM in Tbilisi; the reminder came along.
  await expect(dayList(page).getByRole('button')).toHaveAccessibleName(
    /^2:30\sPM – 3:30\sPM, Team call, with a reminder$/,
  );
  await expect(
    upcoming(page).getByRole('button', { name: 'Tue, Oct 20 · All day, Day off' }),
  ).toBeVisible();

  // Saved on the device.
  await page.reload();
  await expect(dayList(page).getByRole('button', { name: /Team call/ })).toBeVisible();

  // The same file again adds nothing.
  await importFile(page, 'work.ics', WORK_FILE);
  await expect(dialog(page)).toContainText('2 events are already in your calendar.');
  await expect(dialog(page)).toContainText('There’s nothing new to add.');
  await expect(dialog(page).getByRole('button', { name: /^Add/ })).toBeHidden();
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  await expect(dayList(page).getByRole('button')).toHaveCount(1);
});

test('cancelling adds nothing', async ({ page }) => {
  await importFile(page, 'work.ics', WORK_FILE);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Import .ics file' })).toBeFocused();
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();
});

test('says when repeating times may be an hour off', async ({ page }) => {
  // 09:00 in London is 12:00 in Tbilisi in summer, but 13:00 in winter.
  const file = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:weekly-call@example.com',
    'DTSTART;TZID=Europe/London:20261017T090000',
    'RRULE:FREQ=WEEKLY',
    'SUMMARY:Weekly call',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  await importFile(page, 'london.ics', file);
  await expect(dialog(page)).toContainText(
    '1 repeating event is from a time zone that doesn’t change its clocks on the same dates as yours, so some of its times may be an hour off.',
  );
  await dialog(page).getByRole('button', { name: 'Add 1 event' }).click();
  await expect(dayList(page).getByRole('button')).toHaveAccessibleName(
    /^12:00\sPM, Weekly call, repeats$/,
  );
});

test('an event that lasts too long is listed, and the rest still imported', async ({ page }) => {
  // Such a duration used to stop the whole import without a word (audit F1-8).
  const file = WORK_FILE.replace(
    'END:VCALENDAR',
    [
      'BEGIN:VEVENT',
      'UID:forever@example.com',
      'DTSTART;VALUE=DATE:20261017',
      'DURATION:P100000000D',
      'SUMMARY:For ever',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  );
  await importFile(page, 'work.ics', file);
  await expect(dialog(page)).toContainText('Found 4 events in “work.ics”.');
  await expect(dialog(page).getByRole('listitem')).toHaveText([
    'Every other Wednesday: It repeats in a way Calendar can’t show yet (for example every 2 weeks).',
    'For ever: An event can last up to 366 days.',
  ]);
  await dialog(page).getByRole('button', { name: 'Add 2 events' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Added 2 events from the file.' }),
  ).toBeAttached();
});

test('explains files it can’t use', async ({ page }) => {
  await importFile(page, 'notes.txt', 'Buy milk');
  await expect(dialog(page)).toContainText('This doesn’t look like a calendar (.ics) file.');
  await dialog(page).getByRole('button', { name: 'Close' }).click();

  await importFile(page, 'empty.ics', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');
  await expect(dialog(page)).toContainText('There are no events in this file.');
});

test('imports what Calendar exports', async ({ page }) => {
  // Make an event, download it, delete everything, and import the file.
  await page.evaluate(() => {
    const event = {
      id: 'mine',
      title: 'Dentist; bring card',
      startDate: '2026-10-17',
      endDate: '2026-10-17',
      startTime: '16:00',
      endTime: null,
      repeat: 'monthly',
      repeatUntil: null,
      reminder: 30,
      notes: 'Line 1\nLine 2',
    };
    localStorage.setItem('shkriuss:calendar', JSON.stringify({ v: 2, data: { events: [event] } }));
  });
  await page.reload();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .ics file' }).click();
  const file = await (await download).path();
  await page.evaluate(() => localStorage.removeItem('shkriuss:calendar'));
  await page.reload();
  await expect(page.getByText('Nothing planned on this day.')).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .ics file' }).click();
  await (await chooser).setFiles(file);
  await dialog(page).getByRole('button', { name: 'Add 1 event' }).click();
  const item = dayList(page).getByRole('button');
  await expect(item).toHaveAccessibleName(
    /^4:00\sPM, Dentist; bring card, repeats, with a reminder$/,
  );
  await item.click();
  await expect(page.getByLabel('Notes (optional)')).toHaveValue('Line 1\nLine 2');
});
