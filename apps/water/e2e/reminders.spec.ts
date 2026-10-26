// Reminders to drink: shown while Water is open and sent by Water's
// notification service while it's closed (packages/push, docs/adr/0009),
// until the day's goal is reached. Notifications and the push service are
// fakes that record what they get (tests/e2e/notifications.ts).
import type { Page } from '@playwright/test';
import { fromBase64Url } from '../../../packages/push/src/base64.ts';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  fakeNotifications,
  fakeSubscription,
  shownNotifications,
  startRig,
} from '../../../tests/e2e/notifications.ts';
import { REMINDER_BODY, REMINDER_TITLE } from '../src/lib/water.ts';
import { addOther, NOW, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

/** One reminder in the schedule uploaded to Water's notification service. */
interface Entry {
  id: string;
  start: string;
  repeat: string;
  offset: number;
  payload: string;
}

const remindMe = (page: Page) => page.getByRole('checkbox', { name: 'Remind me to drink' });

test('reminds to drink while Water is open, until the goal is reached', async ({ page }) => {
  await fakeNotifications(page, 'granted');
  await page.clock.install({ time: new Date('2026-10-21T10:58:00+04:00') });
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');

  await remindMe(page).check();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Reminders every 2 hours, from 9:00 AM until 9:00 PM.' }),
  ).toBeAttached();
  await page.getByLabel('How often').selectOption({ label: 'Every hour' });
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Reminders every hour, from 9:00 AM until 9:00 PM.' }),
  ).toBeAttached();

  await page.clock.fastForward('03:00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Reminder: time for some water.' }),
  ).toBeAttached();
  expect(await shownNotifications(page)).toEqual([
    // Each one rings again, though it replaces the last (audit 3 F1-1).
    {
      title: REMINDER_TITLE,
      body: REMINDER_BODY,
      tag: 'drink',
      renotify: true,
      icon: '/icon-192.png',
    },
  ]);

  // Goal reached: no more today.
  await addOther(page, '2000');
  await page.clock.fastForward('01:00:00');
  expect(await shownNotifications(page)).toHaveLength(1);

  // Kept after a reload; turned off again.
  await page.reload();
  await expect(remindMe(page)).toBeChecked();
  await expect(page.getByLabel('How often')).toHaveValue('60');
  await remindMe(page).uncheck();
  await expect(page.getByRole('status').filter({ hasText: 'Reminders are off.' })).toBeAttached();
});

test('checks the reminder times', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Until').fill('08:00');
  // Changed while in the field: the problem is read out there (audit G-3).
  await expect(page.getByRole('alert')).toHaveText(
    'Until: Choose an “Until” time after the “From” time.',
  );
  await page.getByLabel('Until').blur();
  const error = page.getByText('Choose an “Until” time after the “From” time.', { exact: true });
  await expect(error).toBeVisible();
  await expect(page.getByLabel('Until')).toHaveAttribute('aria-invalid', 'true');
  await checkA11y(page, 'reminder times problem');
  await page.getByLabel('From').fill('07:00');
  await page.getByLabel('From').blur();
  await expect(error).toBeHidden();
  await expect(page.getByLabel('Until')).not.toHaveAttribute('aria-invalid');
});

test('asks to show notifications when reminders are turned on', async ({ page }) => {
  await fakeNotifications(page, 'default');
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText(
    'Notifications are off. Turn them on to get reminders.',
  );
  await remindMe(page).check();
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeHidden();
});

test.describe('while Water is closed', () => {
  test.use({ serviceWorkers: 'allow' });

  test('uploads daily reminders, from tomorrow once the goal is reached', async ({ page }) => {
    const rig = await startRig();
    try {
      await page.clock.setFixedTime(NOW);
      await fakeSubscription(page, rig);
      await page.goto('/');
      await page.getByLabel('Also remind me when Water is closed').check();
      await expect(page.locator('[data-closed-status]')).toHaveText(
        'On: reminders arrive even when Water is closed.',
      );

      const upload = () =>
        page.waitForRequest(
          (request) => request.url().endsWith('/api/push/schedule') && request.method() === 'PUT',
        );
      const startsOf = async (request: Promise<{ postData(): string | null }>) =>
        (JSON.parse((await request).postData() ?? '') as { entries: Entry[] }).entries;

      let request = upload();
      await remindMe(page).check();
      const entries = await startsOf(request);
      // Soonest first: 09:00 has gone today, so it's next sent tomorrow.
      expect(entries.map((entry) => entry.start)).toEqual([
        '2026-10-21T11:00',
        '2026-10-21T13:00',
        '2026-10-21T15:00',
        '2026-10-21T17:00',
        '2026-10-21T19:00',
        '2026-10-21T21:00',
        '2026-10-21T09:00',
      ]);
      // Numbers, never the app's own ids (they stay on the device).
      expect(entries.map((entry) => entry.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
      expect(entries[0]).toMatchObject({ repeat: 'daily', offset: 0 });
      expect(await rig.open(fromBase64Url(entries[0]?.payload ?? ''))).toEqual({
        title: REMINDER_TITLE,
        body: REMINDER_BODY,
        tag: 'drink',
        url: '/',
      });

      request = upload();
      await addOther(page, '2000', '09:30');
      expect((await startsOf(request)).map((entry) => entry.start)).toEqual([
        '2026-10-22T09:00',
        '2026-10-22T11:00',
        '2026-10-22T13:00',
        '2026-10-22T15:00',
        '2026-10-22T17:00',
        '2026-10-22T19:00',
        '2026-10-22T21:00',
      ]);

      request = upload();
      await page.getByRole('button', { name: 'Remove 2,000 ml at 9:30 AM' }).click();
      expect((await startsOf(request))[0]?.start).toBe('2026-10-21T11:00');
    } finally {
      rig.server.close();
    }
  });
});
