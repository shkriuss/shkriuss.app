// Notifications: shown while Reminders is open, and sent by Reminders'
// notification service while it's closed (packages/push, docs/adr/0009).
// Notifications and the push service are fakes that record what they get
// (tests/e2e/notifications.ts).
import { fromBase64Url } from '../../../packages/push/src/base64.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import {
  fakeNotifications,
  fakeSubscription,
  shownNotifications,
  startRig,
} from '../../../tests/e2e/notifications.ts';
import { REMINDER_BODY } from '../src/lib/reminders.ts';
import { addReminder, editDialog, NOW, reminder, seed, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

/** One reminder in the schedule uploaded to Reminders' notification service. */
interface Entry {
  id: string;
  start: string;
  repeat: string;
  offset: number;
  payload: string;
}

test('reminds at the time while Reminders is open', async ({ page }) => {
  await fakeNotifications(page, 'granted');
  await page.clock.install({ time: NOW });
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await seed(page, [
    reminder('a', 'Stretch', '2026-10-21', '10:04'),
    reminder('b', 'Take my pills', '2026-10-01', '10:04', 'daily'),
    reminder('c', 'Done already', '2026-10-21', '10:04', 'none', '2026-10-21T09:00'),
    reminder('d', 'Later on', '2026-10-21', '10:30'),
  ]);

  await page.clock.fastForward('05:00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Reminder: Stretch, Take my pills.' }),
  ).toBeAttached();
  expect(await shownNotifications(page)).toEqual([
    { title: 'Stretch', body: REMINDER_BODY, tag: 'a', icon: '/icon-192.png' },
    { title: 'Take my pills', body: REMINDER_BODY, tag: 'b', icon: '/icon-192.png' },
  ]);
  // Once only; the one that doesn't repeat is now overdue.
  await page.clock.fastForward('02:00');
  expect(await shownNotifications(page)).toHaveLength(2);
  await expect(page.locator('[data-groups] h3').first()).toHaveText('Overdue');
});

test('asks to show notifications when a reminder is set', async ({ page }) => {
  await fakeNotifications(page, 'default');
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText(
    'Notifications are off. Turn them on to get reminders.',
  );
  await addReminder(page, 'Call Mum');
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeHidden();
});

test.describe('while Reminders is closed', () => {
  test.use({ serviceWorkers: 'allow' });

  test('uploads reminders encrypted, and drops them once done', async ({ page }) => {
    const rig = await startRig();
    try {
      await page.clock.setFixedTime(NOW);
      await fakeSubscription(page, rig);
      await page.goto('/');
      await page.getByLabel('Also remind me when Reminders is closed').check();
      await expect(page.locator('[data-closed-status]')).toHaveText(
        'On: reminders arrive even when Reminders is closed.',
      );

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
      await addReminder(page, 'Secret dentist visit', { time: '18:00' });
      let entries = await entriesOf(request);
      // A number, never the app's own id (it stays on the device, in the sealed message).
      expect(entries).toEqual([
        expect.objectContaining({ id: '1', start: '2026-10-21T18:00', repeat: 'none', offset: 0 }),
      ]);
      expect(await rig.open(fromBase64Url(entries[0]?.payload ?? ''))).toEqual({
        title: 'Secret dentist visit',
        body: REMINDER_BODY,
        tag: expect.stringMatching(/^[\w-]{36}$/),
        url: '/',
      });

      // Every weekday: one weekly reminder for each day, soonest first.
      request = upload();
      await page.getByRole('button', { name: 'Secret dentist visit' }).click();
      await editDialog(page).getByLabel('Repeats').selectOption({
        label: 'Every weekday (Monday to Friday)',
      });
      await editDialog(page).getByRole('button', { name: 'Save' }).click();
      entries = await entriesOf(request);
      expect(entries.map((entry) => [entry.id, entry.start, entry.repeat])).toEqual([
        ['1', '2026-10-21T18:00', 'weekly'],
        ['2', '2026-10-22T18:00', 'weekly'],
        ['3', '2026-10-23T18:00', 'weekly'],
        ['4', '2026-10-26T18:00', 'weekly'],
        ['5', '2026-10-27T18:00', 'weekly'],
      ]);

      // Back to once, then done: nothing left to send.
      request = upload();
      await page.getByRole('button', { name: 'Secret dentist visit' }).click();
      await editDialog(page).getByLabel('Repeats').selectOption({ label: 'Doesn’t repeat' });
      await editDialog(page).getByRole('button', { name: 'Save' }).click();
      await request;
      request = upload();
      await page.getByRole('checkbox', { name: 'Secret dentist visit: done' }).click();
      expect(await entriesOf(request)).toEqual([]);
    } finally {
      rig.server.close();
    }
  });
});
