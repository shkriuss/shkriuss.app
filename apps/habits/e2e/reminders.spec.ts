// Reminders: set in the edit dialog, shown while Habits is open, and sent by
// Habits' notification service while it's closed (packages/push,
// docs/adr/0009). Notifications and the push service are fakes that record
// what they get (tests/e2e/notifications.ts).
import type { Page } from '@playwright/test';
import { fromBase64Url } from '../../../packages/push/src/base64.ts';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  fakeNotifications,
  fakeSubscription,
  shownNotifications,
  startRig,
} from '../../../tests/e2e/notifications.ts';
import { REMINDER_BODY } from '../src/lib/habits.ts';

test.use({ timezoneId: 'Europe/Berlin' });

const card = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit habit' });

/** One reminder in the schedule uploaded to Habits' notification service. */
interface Entry {
  id: string;
  start: string;
  repeat: string;
  offset: number;
  payload: string;
}

async function addHabit(page: Page, name: string): Promise<void> {
  await page.getByLabel('New habit').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(card(page, name)).toBeVisible();
}

async function setReminder(page: Page, name: string, time: string): Promise<void> {
  await page.getByRole('button', { name: `Edit ${name}` }).click();
  await editor(page).getByLabel('Remind me').check();
  await editor(page).getByLabel('Reminder time').fill(time);
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(editor(page)).toBeHidden();
}

test('reminds while Habits is open, unless it’s done already', async ({ page }) => {
  await fakeNotifications(page, 'granted');
  // Monday 19 October 2026, 10:00.
  await page.clock.install({ time: new Date('2026-10-19T10:00:00+02:00') });
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await addHabit(page, 'Drink water');
  await addHabit(page, 'Read');

  // A new reminder starts at 20:00, and can be turned off again.
  await page.getByRole('button', { name: 'Edit Drink water' }).click();
  await expect(editor(page).getByLabel('Reminder time')).toBeHidden();
  await editor(page).getByLabel('Remind me').check();
  await expect(editor(page).getByLabel('Reminder time')).toHaveValue('20:00');
  await checkA11y(page, 'edit dialog with a reminder');
  await editor(page).getByLabel('Reminder time').fill('10:05');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(card(page, 'Drink water')).toContainText(/Reminder at 10:05\sAM/);
  await setReminder(page, 'Read', '10:05');
  await page.getByRole('button', { name: 'Read: done today' }).click();
  await checkA11y(page, 'habits with reminders');

  await page.clock.fastForward('06:00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Reminder: Drink water.' }),
  ).toBeAttached();
  expect(await shownNotifications(page)).toEqual([
    { title: 'Drink water', body: REMINDER_BODY, tag: expect.any(String), icon: '/icon-192.png' },
  ]);

  // Once only.
  await page.clock.fastForward('02:00');
  expect(await shownNotifications(page)).toHaveLength(1);

  await page.getByRole('button', { name: 'Edit Drink water' }).click();
  await expect(editor(page).getByLabel('Reminder time')).toHaveValue('10:05');
  await editor(page).getByLabel('Remind me').uncheck();
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(card(page, 'Drink water').locator('[data-reminder]')).toBeHidden();
});

test('asks to show notifications when a reminder is set', async ({ page }) => {
  await fakeNotifications(page, 'default');
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText(
    'Notifications are off. Turn them on to get reminders.',
  );
  await addHabit(page, 'Stretch');
  await setReminder(page, 'Stretch', '07:00');
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeHidden();
});

test.describe('while Habits is closed', () => {
  test.use({ serviceWorkers: 'allow' });

  test('uploads reminders encrypted, and skips today’s once done', async ({ page }) => {
    const rig = await startRig();
    try {
      await page.clock.setFixedTime(new Date('2026-10-19T10:00:00+02:00'));
      await fakeSubscription(page, rig);
      await page.goto('/');
      await expect(page.locator('[data-push-controls]')).toContainText(
        'and your time zone. More about this.',
      );
      await page.getByLabel('Also remind me when Habits is closed').check();
      await expect(page.locator('[data-closed-status]')).toHaveText(
        'On: reminders arrive even when Habits is closed.',
      );
      await addHabit(page, 'Secret walk');

      const upload = () =>
        page.waitForRequest(
          (request) => request.url().endsWith('/api/push/schedule') && request.method() === 'PUT',
        );
      const entriesOf = async (request: Promise<{ postData(): string | null }>) => {
        const text = (await request).postData() ?? '';
        expect(text).not.toContain('Secret');
        return (JSON.parse(text) as { entries: Entry[] }).entries;
      };
      const on = (entries: Entry[], day: string) =>
        entries.find((entry) => entry.start.startsWith(day));

      let request = upload();
      await setReminder(page, 'Secret walk', '20:00');
      let entries = await entriesOf(request);
      // Every day: one a week for each day, numbered (the app's ids stay on the device).
      expect(entries.map((entry) => entry.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
      expect(on(entries, '2026-10-19')).toMatchObject({
        start: '2026-10-19T20:00',
        repeat: 'weekly',
        offset: 0,
      });
      expect(await rig.open(fromBase64Url(on(entries, '2026-10-19')?.payload ?? ''))).toEqual({
        title: 'Secret walk',
        body: REMINDER_BODY,
        tag: expect.any(String),
        url: '/',
      });

      // Done today: today's reminder moves to next week.
      request = upload();
      await page.getByRole('button', { name: 'Secret walk: done today' }).click();
      entries = await entriesOf(request);
      expect(on(entries, '2026-10-19')).toBeUndefined();
      expect(on(entries, '2026-10-26')?.start).toBe('2026-10-26T20:00');
      expect(on(entries, '2026-10-20')?.start).toBe('2026-10-20T20:00');
    } finally {
      rig.server.close();
    }
  });
});
