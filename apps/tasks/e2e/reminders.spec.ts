// Reminders: chosen in the task's form, shown while Tasks is open, and sent
// by Tasks' notification service while it's closed (packages/push,
// docs/adr/0009). Notifications and the push service are fakes that record
// what they get (tests/e2e/notifications.ts).
import { fromBase64Url } from '../../../packages/push/src/base64.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  fakeNotifications,
  fakeSubscription,
  shownNotifications,
  startRig,
} from '../../../tests/e2e/notifications.ts';
import { REMINDER_BODY } from '../src/lib/tasks.ts';
import { box, editor, NOW, seed, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

/** One reminder in the schedule uploaded to Tasks' notification service. */
interface Entry {
  id: string;
  start: string;
  repeat: string;
  offset: number;
  payload: string;
}

test('reminds while Tasks is open, unless it’s done', async ({ page }) => {
  await fakeNotifications(page, 'granted');
  await page.clock.install({ time: NOW });
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await seed(page, [
    { title: 'Call the bank', date: '2026-10-20', time: '10:35', reminder: 30 },
    { title: 'Already done', date: '2026-10-20', time: '10:05', reminder: 0, done: 1 },
    { title: 'Later today', date: '2026-10-20', time: '18:00', reminder: 0 },
  ]);

  await page.clock.fastForward('06:00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Reminder: Call the bank.' }),
  ).toBeAttached();
  await expect
    .poll(() => shownNotifications(page))
    .toEqual([
      {
        title: 'Call the bank',
        body: REMINDER_BODY,
        tag: expect.any(String),
        renotify: true,
        icon: '/icon-192.png',
      },
    ]);
  // Once only.
  await page.clock.fastForward('02:00');
  expect(await shownNotifications(page)).toHaveLength(1);
});

test('asks to show notifications when a reminder is chosen', async ({ page }) => {
  await fakeNotifications(page, 'default');
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText(
    'Notifications are off. Turn them on to get reminders.',
  );
  await seed(page, [{ title: 'Stretch', date: '2026-10-21' }]);
  await page.getByRole('button', { name: 'Edit Stretch' }).click();
  await editor(page).getByLabel('Remind me').selectOption({ label: 'At the time' });
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeHidden();
});

test.describe('while Tasks is closed', () => {
  test.use({ serviceWorkers: 'allow' });

  test('uploads reminders encrypted, and drops a task’s once it’s done', async ({ page }) => {
    const rig = await startRig();
    try {
      await page.clock.setFixedTime(NOW);
      await fakeSubscription(page, rig);
      await page.goto('/');
      await page.getByLabel('Also remind me when Tasks is closed').check();
      await expect(page.locator('[data-closed-status]')).toHaveText(
        'On: reminders arrive even when Tasks is closed.',
      );
      await seed(page, [{ title: 'Secret meeting', date: '2026-10-22' }]);

      const upload = () =>
        page.waitForRequest(
          (request) => request.url().endsWith('/api/push/schedule') && request.method() === 'PUT',
        );
      const entriesOf = async (request: Promise<{ postData(): string | null }>) => {
        const text = (await request).postData() ?? '';
        expect(text).not.toContain('Secret');
        return (JSON.parse(text) as { entries: Entry[] }).entries;
      };

      let request = upload();
      await page.getByRole('button', { name: 'Edit Secret meeting' }).click();
      await editor(page).getByLabel('Remind me').selectOption({ label: '1 day before' });
      await editor(page).getByRole('button', { name: 'Save' }).click();
      let entries = await entriesOf(request);
      // No time: at 9:00, a day before.
      expect(entries).toEqual([
        expect.objectContaining({ start: '2026-10-22T09:00', repeat: 'none', offset: 1440 }),
      ]);
      expect(await rig.open(fromBase64Url(entries[0]?.payload ?? ''))).toEqual({
        title: 'Secret meeting',
        body: REMINDER_BODY,
        tag: expect.any(String),
        url: '/',
      });

      request = upload();
      await box(page, 'Secret meeting').click();
      entries = await entriesOf(request);
      expect(entries).toEqual([]);
    } finally {
      rig.server.close();
    }
  });
});
