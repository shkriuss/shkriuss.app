// "Also remind me when Calendar is closed" (packages/push, docs/adr/0009),
// with the pretend push service in tests/e2e/notifications.ts.
import type { Page, Route } from '@playwright/test';
import { fromBase64Url } from '../../../packages/push/src/base64.ts';
import { checkA11y, expect, test } from '../../../tests/e2e/fixtures.ts';
import { fakeSubscription, startRig, type PushRig } from '../../../tests/e2e/notifications.ts';
import { dayList, editor, newEvent, save, seed } from './helpers.ts';

test.use({ serviceWorkers: 'allow', timezoneId: 'Europe/Berlin' });

const closedSwitch = (page: Page) => page.getByLabel('Also remind me when Calendar is closed');
const closedStatus = (page: Page) => page.locator('[data-closed-status]');

let rig: PushRig;
test.beforeEach(async () => {
  rig = await startRig();
});
test.afterEach(() => {
  rig.server.close();
});

test('sends a test notification that only this device can read', async ({ page }) => {
  await fakeSubscription(page, rig);
  await page.goto('/');
  await expect(closedStatus(page)).toHaveText(/^Off:/);
  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On: reminders arrive even when Calendar is closed/);
  await checkA11y(page, 'reminders while closed: on');

  await page.getByRole('button', { name: 'Send a test notification' }).click();
  await expect(closedStatus(page)).toHaveText('Test sent. It should appear in a few seconds.');
  await expect.poll(() => rig.received.length).toBe(1);
  const [push] = rig.received;
  if (!push) throw new Error('No push received');
  expect(push.headers).toMatchObject({
    'content-encoding': 'aes128gcm',
    urgency: 'high',
    ttl: '21600',
  });
  // Signed with this app's own key, the one browsers subscribe with.
  const { publicKey } = (await (await page.request.get('/api/push/key')).json()) as {
    publicKey: string;
  };
  expect(push.headers.authorization).toMatch(
    new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${publicKey}$`),
  );
  expect(new TextDecoder().decode(push.body)).not.toContain('Notifications are working');
  expect(await rig.open(push.body)).toEqual({
    title: 'Calendar',
    body: 'Notifications are working.',
    tag: 'test',
    url: '/',
  });
});

test('uploads reminders encrypted, never in plain text', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00+02:00'));
  await fakeSubscription(page, rig);
  await page.goto('/');
  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On:/);

  const upload = page.waitForRequest(
    (request) => request.url().endsWith('/api/push/schedule') && request.method() === 'PUT',
  );
  await newEvent(page, 'Secret dentist visit');
  await editor(page).getByLabel('Start time').fill('14:30');
  await editor(page)
    .getByLabel('Reminder', { exact: true })
    .selectOption({ label: '15 minutes before' });
  await save(page);
  await expect(dayList(page).getByRole('button', { name: /Secret dentist visit/ })).toBeVisible();

  const request = await upload;
  const text = request.postData() ?? '';
  expect(text).not.toContain('Secret');
  expect(text).not.toContain('dentist');
  const body = JSON.parse(text) as {
    endpoint: string;
    timeZone: string;
    entries: {
      id: string;
      start: string;
      repeat: string;
      until: null;
      offset: number;
      payload: string;
    }[];
  };
  expect(body.endpoint).toBe(rig.endpoint);
  expect(body.timeZone).toBe('Europe/Berlin');
  expect(body.entries).toHaveLength(1);
  const [entry] = body.entries;
  expect(entry).toMatchObject({
    start: '2026-10-17T14:30',
    repeat: 'none',
    until: null,
    offset: 15,
  });
  expect(await rig.open(fromBase64Url(entry?.payload ?? ''))).toMatchObject({
    title: 'Secret dentist visit',
    body: expect.stringMatching(/^Sat, Oct 17 · 2:30\sPM – 3:30\sPM$/),
  });
  expect(request.headers()['authorization']).toMatch(/^Bearer [\w-]{43}$/);
});

test('an imported event’s calendar id stays on the device, even a long one', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-17T10:00:00+02:00'));
  await fakeSubscription(page, rig);
  await page.goto('/');
  // Outlook gives events 112-character ids, kept as the event's id when imported.
  const uid = `040000008200E00074C5B7101A82E008${'0'.repeat(80)}`;
  await seed(page, [
    { id: uid, title: 'Booked', startDate: '2026-10-20', endDate: '2026-10-20', reminder: 15 },
  ]);
  const upload = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/push/schedule') && response.request().method() === 'PUT',
  );
  await closedSwitch(page).check();
  const response = await upload;
  expect(response.status()).toBe(200);
  const text = response.request().postData() ?? '';
  expect(text).not.toContain(uid);
  const body = JSON.parse(text) as { entries: { id: string }[] };
  expect(body.entries.map((entry) => entry.id)).toEqual(['1']);
  await expect(closedStatus(page)).toHaveText(/^On:/);
});

test('turning it off, or deleting all data, removes it from the server', async ({ page }) => {
  await fakeSubscription(page, rig);
  await page.goto('/');
  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On:/);

  let deleted = page.waitForRequest(
    (request) => request.url().endsWith('/api/push/schedule') && request.method() === 'DELETE',
  );
  await closedSwitch(page).uncheck();
  await deleted;
  await expect(closedStatus(page)).toHaveText(/^Off:/);
  expect(await page.evaluate(() => localStorage.getItem('shkriuss-device:push'))).toBeNull();
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>)['unsubscribed']),
  ).toBe(true);

  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On:/);
  deleted = page.waitForRequest(
    (request) => request.url().endsWith('/api/push/schedule') && request.method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Delete all data' }).click();
  await page
    .getByRole('dialog', { name: 'Delete all data?' })
    .getByRole('button', { name: 'Delete everything' })
    .click();
  await deleted;
  await page.waitForLoadState('load');
  await expect(closedSwitch(page)).not.toBeChecked();
});

test('says so when turning it off can’t reach the server, and finishes later', async ({
  page,
  guard,
}) => {
  // The browser logs the deletion this test stops.
  guard.allowConsole('net::ERR_FAILED');
  await fakeSubscription(page, rig);
  await page.goto('/');
  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On:/);

  // The deletion can't get through (offline, say).
  await page.route('**/api/push/schedule', (route) =>
    route.request().method() === 'DELETE' ? route.abort() : route.continue(),
  );
  await closedSwitch(page).uncheck();
  await expect(closedStatus(page)).toHaveText(
    "Off, but your reminders couldn’t be removed from Calendar's server yet. Calendar will try again when it’s open and online.",
  );
  await checkA11y(page, 'reminders while closed: deletion pending');

  // Next time Calendar is open, it tries again.
  await page.unroute('**/api/push/schedule');
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/push/schedule') && response.request().method() === 'DELETE',
  );
  await page.reload();
  expect((await deleted).status()).toBe(204);
  await expect(closedStatus(page)).toHaveText(/^Off:/);
  expect(await page.evaluate(() => localStorage.getItem('shkriuss-device:push-delete'))).toBeNull();
});

test('“Delete all data” deletes here at once, even while the network hangs', async ({
  page,
  guard,
}) => {
  // The browser logs the requests that hung, when they're dropped below.
  guard.allowConsole('net::ERR_FAILED');
  await fakeSubscription(page, rig);
  await page.goto('/');
  await seed(page, [
    { title: 'Private appointment', startDate: '2099-01-01', endDate: '2099-01-01' },
  ]);
  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On:/);

  // From now on the server never answers (a VPN with no connection, say).
  const hanging: Route[] = [];
  await page.route('**/api/**', (route) => {
    hanging.push(route); // Never answers.
  });
  await page.getByRole('button', { name: 'Delete all data' }).click();
  const reloaded = page.waitForEvent('load', { timeout: 10_000 });
  await page
    .getByRole('dialog', { name: 'Delete all data?' })
    .getByRole('button', { name: 'Delete everything' })
    .click();
  // Deleted on this device without waiting for the server, which can't answer.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('shkriuss:calendar')))
    .toBeNull();
  await reloaded;
  const device = await page.evaluate(() => ({
    calendar: localStorage.getItem('shkriuss:calendar') ?? '',
    push: localStorage.getItem('shkriuss-device:push'),
    pending: localStorage.getItem('shkriuss-device:push-delete'),
    subscribed: sessionStorage.getItem('fake-push'),
  }));
  expect(device.calendar).not.toContain('Private appointment');
  expect(device).toMatchObject({ push: null, subscribed: null });
  // The server's copy is remembered, to be deleted later.
  expect(device.pending).not.toBeNull();
  await expect(closedSwitch(page)).not.toBeChecked();
  await expect(closedStatus(page)).toHaveText(/^Off, but your reminders couldn’t be removed/);

  // Back online. The requests that hung are dropped, as a dead connection's
  // are: only unrouting would let them through late, and one could then
  // finish the deletion before the reload below has anything to do.
  await Promise.all(hanging.map((route) => route.abort().catch(() => undefined)));
  await page.unroute('**/api/**');
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/push/schedule') && response.request().method() === 'DELETE',
  );
  await page.reload();
  expect((await deleted).status()).toBe(204);
  await expect(closedStatus(page)).toHaveText(/^Off:/);
});

test('turning it off while the network hangs gives up after a while', async ({ page }) => {
  await page.clock.install();
  await fakeSubscription(page, rig);
  await page.goto('/');
  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On:/);

  await page.route('**/api/**', () => {
    // Never answers.
  });
  // With the keyboard: focus stays on the switch while it waits.
  await closedSwitch(page).focus();
  await page.keyboard.press('Space');
  await expect(closedStatus(page)).toHaveText('Turning off…');
  await expect(closedSwitch(page)).not.toBeChecked();
  await expect(closedSwitch(page)).toBeDisabled();
  await expect(closedSwitch(page)).toBeFocused();
  // Pressing it again meanwhile does nothing.
  await page.keyboard.press('Space');
  await expect(closedSwitch(page)).not.toBeChecked();
  await page.clock.runFor('00:21');
  await expect(closedStatus(page)).toHaveText(
    "Off, but your reminders couldn’t be removed from Calendar's server yet. Calendar will try again when it’s open and online.",
  );
  await expect(closedSwitch(page)).toBeEnabled();
  await expect(closedSwitch(page)).toBeFocused();
});

test('after a trip, coming back to Calendar sends the new time zone', async ({ page }) => {
  await fakeSubscription(page, rig);
  await page.goto('/');
  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On:/);
  const timeZones: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/push/schedule') && request.method() === 'PUT') {
      timeZones.push(
        (JSON.parse(request.postData() ?? '{}') as { timeZone?: string }).timeZone ?? '',
      );
    }
  });

  // Back on screen with nothing changed: nothing is sent.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // Flown to London, and back on screen (the page stayed in memory).
  await page.evaluate(() => {
    const Original = Intl.DateTimeFormat;
    const InLondon = function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      const format = new Original(...args);
      const resolved = format.resolvedOptions.bind(format);
      format.resolvedOptions = () => ({ ...resolved(), timeZone: 'Europe/London' });
      return format;
    } as unknown as typeof Intl.DateTimeFormat;
    Intl.DateTimeFormat = InLondon;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => timeZones).toEqual(['Europe/London']);
});

test('device settings stay out of backups', async ({ page }) => {
  await fakeSubscription(page, rig);
  await page.goto('/');
  await closedSwitch(page).check();
  await expect(closedStatus(page)).toHaveText(/^On:/);
  await page.getByRole('button', { name: 'Back up' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download without a passphrase' }).click();
  const file = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of file) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  expect(text).toContain('"app": "calendar"');
  expect(text).not.toContain('shkriuss-device');
  expect(text).not.toContain(rig.endpoint);
});

test('explains when this browser can’t get push', async ({ page }) => {
  await fakeSubscription(page, rig, { fail: true });
  await page.goto('/');
  // click(), not check(): the switch turns itself back off.
  await closedSwitch(page).click();
  await expect(closedStatus(page)).toHaveText(/couldn’t connect to a push service.*IronFox/);
  await expect(closedSwitch(page)).not.toBeChecked();
  expect(rig.received).toHaveLength(0);
});

test('says so when the browser has no push at all', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)['PushManager'];
  });
  await page.goto('/');
  await expect(closedSwitch(page)).toBeDisabled();
  await expect(closedStatus(page)).toHaveText(
    'This browser can’t get notifications while Calendar is closed.',
  );
});
