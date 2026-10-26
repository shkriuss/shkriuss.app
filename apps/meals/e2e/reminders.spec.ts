// Reminders: a time for each meal of the day, shown while Meals is open and
// sent by Meals' notification service while it's closed (packages/push,
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
import { REMINDER_BODY } from '../src/lib/meals.ts';
import { NOW, planDialog, seed, TIME_ZONE } from './helpers.ts';

test.use({ timezoneId: TIME_ZONE });

/** One reminder in the schedule uploaded to Meals' notification service. */
interface Entry {
  id: string;
  start: string;
  repeat: string;
  offset: number;
  payload: string;
}

const PLAN = [
  { id: 'a', date: '2026-10-21', slot: 'dinner' as const, name: 'Lentil soup' },
  { id: 'b', date: '2026-10-21', slot: 'dinner' as const, name: 'Salad' },
  { id: 'c', date: '2026-10-22', slot: 'breakfast' as const, name: 'Porridge' },
];

test('reminds of what’s planned while Meals is open', async ({ page }) => {
  await fakeNotifications(page, 'granted');
  await page.clock.install({ time: NOW });
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await seed(page, { planned: PLAN });

  // Turned on: the suggested time, which can be changed.
  const dinner = page.getByRole('checkbox', { name: 'Dinner' });
  await dinner.check();
  await expect(page.getByLabel('Dinner reminder time')).toHaveValue('18:00');
  await page.getByLabel('Dinner reminder time').fill('10:04');
  await expect(
    page.getByRole('status').filter({ hasText: 'Dinner reminder at 10:04.' }),
  ).toBeAttached();
  // Breakfast: nothing planned today, so no reminder today.
  await page.getByLabel('Breakfast reminder time').fill('10:03');
  await expect(page.getByRole('checkbox', { name: 'Breakfast' })).toBeChecked();

  await page.clock.fastForward('05:00');
  await expect(
    page.getByRole('status').filter({ hasText: 'Reminder: Dinner: Lentil soup, Salad.' }),
  ).toBeAttached();
  expect(await shownNotifications(page)).toEqual([
    {
      title: 'Dinner: Lentil soup, Salad',
      body: REMINDER_BODY,
      tag: '2026-10-21~dinner',
      icon: '/icon-192.png',
      renotify: true,
    },
  ]);
  // Once only.
  await page.clock.fastForward('02:00');
  expect(await shownNotifications(page)).toHaveLength(1);

  // Kept after a reload; turned off again.
  await page.reload();
  await expect(dinner).toBeChecked();
  await expect(page.getByLabel('Dinner reminder time')).toHaveValue('10:04');
  await dinner.uncheck();
  await expect(page.getByRole('status').filter({ hasText: 'No dinner reminder.' })).toBeAttached();
});

test('asks to show notifications when a reminder is turned on', async ({ page }) => {
  await fakeNotifications(page, 'default');
  await page.goto('/');
  await expect(page.locator('[data-notify-status]')).toHaveText(
    'Notifications are off. Turn them on to get reminders.',
  );
  await page.getByRole('checkbox', { name: 'Lunch' }).check();
  await expect(page.locator('[data-notify-status]')).toHaveText('Notifications are on.');
  await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeHidden();
});

test.describe('while Meals is closed', () => {
  test.use({ serviceWorkers: 'allow' });

  test('uploads reminders encrypted, and drops one when its meal is removed', async ({ page }) => {
    const rig = await startRig();
    try {
      await page.clock.setFixedTime(NOW);
      await fakeSubscription(page, rig);
      await page.goto('/');
      await page.getByLabel('Also remind me when Meals is closed').check();
      await expect(page.locator('[data-closed-status]')).toHaveText(
        'On: reminders arrive even when Meals is closed.',
      );
      await seed(page, {
        planned: [{ id: 's', date: '2026-10-22', slot: 'dinner', name: 'Secret soup' }],
      });

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
      await page.getByRole('checkbox', { name: 'Dinner' }).check();
      let entries = await entriesOf(request);
      expect(entries).toEqual([
        expect.objectContaining({ start: '2026-10-22T18:00', repeat: 'none', offset: 0 }),
      ]);
      expect(await rig.open(fromBase64Url(entries[0]?.payload ?? ''))).toEqual({
        title: 'Dinner: Secret soup',
        body: REMINDER_BODY,
        tag: '2026-10-22~dinner',
        url: '/',
      });

      request = upload();
      await page.getByRole('button', { name: 'Secret soup' }).click();
      await planDialog(page).getByRole('button', { name: 'Remove' }).click();
      entries = await entriesOf(request);
      expect(entries).toEqual([]);
    } finally {
      rig.server.close();
    }
  });
});
