// The monthly reminder: shown while Budget is open and sent by Budget's
// notification service while it's closed (packages/push, docs/adr/0009).
// Notifications and the push service are fakes that record what they get
// (tests/e2e/notifications.ts).
import type { Page } from '@playwright/test';
import { fromBase64Url } from '../../../packages/push/src/base64.ts';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  fakeNotifications,
  fakeSubscription,
  shownNotifications,
  startRig,
} from '../../../tests/e2e/notifications.ts';
import { REMINDER_BODY, REMINDER_TITLE } from '../src/lib/budget.ts';
import { NOW, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

/** The reminder in the schedule uploaded to Budget's notification service. */
interface Entry {
  id: string;
  start: string;
  repeat: string;
  offset: number;
  payload: string;
}

const remindMe = (page: Page) =>
  page.getByRole('checkbox', { name: 'Remind me to check my budget' });
const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('reminds once a month while Budget is open', async ({ page }) => {
  await fakeNotifications(page, 'granted');
  // Saturday 31 October, the last day of the month.
  await page.clock.install({ time: new Date('2026-10-31T19:58:00+04:00') });
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await expect(page.locator('[data-reminder-next]')).toBeHidden();

  await remindMe(page).check();
  await expect(status(page, 'Reminder on the 1st of every month, at 9:00 AM.')).toBeAttached();
  await expect(page.locator('[data-reminder-next]')).toHaveText(
    'Next reminder: Sunday, November 1, at 9:00 AM.',
  );
  await page.getByLabel('Day of the month').selectOption({ label: 'Last day' });
  await page.getByLabel('Time', { exact: true }).fill('20:00');
  await page.getByLabel('Time', { exact: true }).blur();
  await expect(status(page, 'Reminder on the last day of every month, at 8:00 PM.')).toBeAttached();
  await expect(page.locator('[data-reminder-next]')).toHaveText(
    'Next reminder: Saturday, October 31, at 8:00 PM.',
  );
  await checkA11y(page, 'monthly reminder');

  await page.clock.fastForward('03:00');
  await expect(status(page, 'Reminder: check your budget.')).toBeAttached();
  expect(await shownNotifications(page)).toEqual([
    { title: REMINDER_TITLE, body: REMINDER_BODY, tag: 'budget', icon: '/icon-192.png' },
  ]);

  // Kept after a reload; turned off again.
  await page.reload();
  await expect(remindMe(page)).toBeChecked();
  await expect(page.getByLabel('Day of the month')).toHaveValue('last');
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue('20:00');
  await remindMe(page).uncheck();
  await expect(status(page, 'The monthly reminder is off.')).toBeAttached();
  await expect(page.locator('[data-reminder-next]')).toBeHidden();
});

test('checks the reminder time', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Time', { exact: true }).fill('');
  await page.getByLabel('Time', { exact: true }).blur();
  await expect(page.getByText('Choose a time for the reminder.')).toBeVisible();
  await expect(page.getByLabel('Time', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await checkA11y(page, 'reminder time problem');
  await page.getByLabel('Time', { exact: true }).fill('18:00');
  await page.getByLabel('Time', { exact: true }).blur();
  await expect(page.getByText('Choose a time for the reminder.')).toBeHidden();
  await expect(page.getByLabel('Time', { exact: true })).not.toHaveAttribute('aria-invalid');
});

test('asks to show notifications when the reminder is turned on', async ({ page }) => {
  await fakeNotifications(page, 'default');
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText(
    'Notifications are off. Turn them on to get the reminder.',
  );
  await remindMe(page).check();
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeHidden();
});

test.describe('while Budget is closed', () => {
  test.use({ serviceWorkers: 'allow' });

  test('uploads the monthly reminder', async ({ page }) => {
    const rig = await startRig();
    try {
      await page.clock.setFixedTime(NOW);
      await fakeSubscription(page, rig);
      await page.goto('/');
      await page.getByLabel('Also remind me when Budget is closed').check();
      await expect(page.locator('[data-closed-status]')).toHaveText(
        'On: reminders arrive even when Budget is closed.',
      );

      const upload = () =>
        page.waitForRequest(
          (request) => request.url().endsWith('/api/push/schedule') && request.method() === 'PUT',
        );
      const entriesOf = async (request: Promise<{ postData(): string | null }>) =>
        (JSON.parse((await request).postData() ?? '') as { entries: Entry[] }).entries;

      let request = upload();
      await remindMe(page).check();
      const entries = await entriesOf(request);
      expect(entries).toHaveLength(1);
      // A number, never the app's own id (it stays on the device).
      expect(entries[0]).toMatchObject({
        id: '1',
        start: '2026-10-01T09:00',
        repeat: 'monthly',
        offset: 0,
      });
      expect(await rig.open(fromBase64Url(entries[0]?.payload ?? ''))).toEqual({
        title: REMINDER_TITLE,
        body: REMINDER_BODY,
        tag: 'budget',
        url: '/',
      });

      // The last day: a day before each 1st.
      request = upload();
      await page.getByLabel('Day of the month').selectOption({ label: 'Last day' });
      expect((await entriesOf(request))[0]).toMatchObject({
        start: '2026-11-01T09:00',
        repeat: 'monthly',
        offset: 1440,
      });

      request = upload();
      await remindMe(page).uncheck();
      expect(await entriesOf(request)).toEqual([]);
    } finally {
      rig.server.close();
    }
  });
});
