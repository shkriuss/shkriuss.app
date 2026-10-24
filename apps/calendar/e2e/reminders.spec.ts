// Reminders: on the page, as notifications, and in the event editor.
//
// Notifications are replaced by a fake that records them
// (tests/e2e/notifications.ts), and the clock starts at 10:00 on Saturday 17
// October 2026.
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { fakeNotifications, shownNotifications } from '../../../tests/e2e/notifications.ts';
import { dayList, editor, newEvent, save, seed } from './helpers.ts';

const reminders = (page: Page) => page.getByRole('region', { name: 'Reminders' });
const status = (page: Page) => page.locator('[data-notify-status]');

test('reminds on the page and with a notification when the time comes', async ({ page }) => {
  await fakeNotifications(page, 'granted');
  await page.clock.install({ time: new Date('2026-10-17T10:00:00') });
  await page.goto('/');
  await seed(page, [{ title: 'Dentist', startTime: '10:20', endTime: '11:20', reminder: 15 }]);
  await expect(status(page)).toHaveText(/^Notifications are on\./);
  await expect(reminders(page)).toBeHidden();

  // 10:05 is 15 minutes before.
  await page.clock.fastForward('05:30');
  await expect(reminders(page).getByRole('button', { name: /Dentist/ })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: /^Reminder: Dentist, Today · 10:20\sAM/ }),
  ).toBeAttached();
  expect(await shownNotifications(page)).toEqual([
    {
      title: 'Dentist',
      body: expect.stringMatching(/^Today · 10:20\sAM – 11:20\sAM$/),
      tag: 'seed-0/2026-10-17',
      icon: '/icon-192.png',
    },
  ]);
  await checkA11y(page, 'with a reminder showing');

  await reminders(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(reminders(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'New event' })).toBeFocused();

  // Each reminder shows once.
  await page.clock.fastForward('05:00');
  await expect(reminders(page)).toBeHidden();
  expect(await shownNotifications(page)).toHaveLength(1);
});

test('shows reminders missed while Calendar was closed', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00'));
  await page.goto('/');
  await seed(
    page,
    [
      { title: 'Still to come', startTime: '10:30', endTime: '11:30', reminder: 60 },
      { title: 'Already over', startTime: '08:00', endTime: '08:30', reminder: 15 },
    ],
    // Calendar was last open at 8:00.
    { 'shkriuss:calendar-reminders': { v: 1, data: { checkedUntil: '2026-10-17T08:00' } } },
  );
  await expect(reminders(page).locator('[data-action="edit"]')).toHaveCount(1);
  await expect(reminders(page).getByRole('button', { name: /Still to come/ })).toBeVisible();

  // Tapping a reminder opens the event.
  await reminders(page)
    .getByRole('button', { name: /Still to come/ })
    .click();
  await expect(editor(page).getByLabel('Title')).toHaveValue('Still to come');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.keyboard.press('Escape');
  await checkA11y(page, 'with a reminder showing (dark)');
});

test('asks to show notifications after saving an event with a reminder', async ({ page }) => {
  await fakeNotifications(page, 'default');
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00'));
  await page.goto('/');
  await expect(status(page)).toHaveText(/^Notifications are off\./);

  await newEvent(page, 'Dentist');
  await editor(page).getByLabel('Reminder', { exact: true }).selectOption({
    label: '15 minutes before',
  });
  await save(page);
  await expect(dayList(page).getByRole('button')).toHaveAccessibleName(
    /^9:00\sAM – 10:00\sAM, Dentist, with a reminder$/,
  );
  await expect(status(page)).toHaveText(/^Notifications are on\./);
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>)['permissionAsked']),
  ).toBe(true);

  // The reminder is saved and shows when editing.
  await page.reload();
  await dayList(page)
    .getByRole('button', { name: /Dentist/ })
    .click();
  await expect(editor(page).getByLabel('Reminder', { exact: true })).toHaveValue('15');
});

// Turning notifications on, and blocked or missing notifications: tests/e2e/notifications.spec.ts.

test('offers reminder choices that fit timed and all-day events', async ({ page }) => {
  await page.goto('/');
  await newEvent(page, 'Trip');
  const reminder = editor(page).getByLabel('Reminder', { exact: true });
  await expect(reminder.locator('option')).toHaveText([
    'No reminder',
    'At the start time',
    '5 minutes before',
    '10 minutes before',
    '15 minutes before',
    '30 minutes before',
    '1 hour before',
    '2 hours before',
    '1 day before',
    '1 week before',
  ]);
  await reminder.selectOption({ label: '1 hour before' });
  await editor(page).getByLabel('All day').check();
  await expect(reminder.locator('option')).toHaveText([
    'No reminder',
    /^On the day at 9:00\sAM$/,
    /^1 day before at 9:00\sAM$/,
    /^2 days before at 9:00\sAM$/,
    /^1 week before at 9:00\sAM$/,
  ]);
  await expect(reminder).toHaveValue('-540');
  await editor(page).getByLabel('All day').uncheck();
  await expect(reminder).toHaveValue('15');
  await reminder.selectOption({ label: 'No reminder' });
  await editor(page).getByLabel('All day').check();
  await expect(reminder).toHaveValue('');
});

test('keeps events saved before reminders existed', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00'));
  await page.goto('/');
  // Version 1 data has no reminder field.
  const { reminder: _, ...old } = {
    id: 'old',
    title: 'From before',
    startDate: '2026-10-17',
    endDate: '2026-10-17',
    startTime: '09:00',
    endTime: '10:00',
    repeat: 'none',
    repeatUntil: null,
    reminder: null,
    notes: '',
  };
  await page.evaluate((event) => {
    localStorage.setItem('shkriuss:calendar', JSON.stringify({ v: 1, data: { events: [event] } }));
  }, old);
  await page.reload();
  await expect(dayList(page).getByRole('button', { name: /From before/ })).toBeVisible();
});
