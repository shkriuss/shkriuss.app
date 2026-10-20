// Calendar's events syncing between two devices through the account
// (packages/sync, docs/adr/0010), reminders included. The connect flow itself
// is tested for every app in tests/e2e/sync.spec.ts.
import type { Page, Request } from '@playwright/test';
import { fromBase64Url } from '../../../packages/push/src/base64.ts';
import {
  createAccount,
  hubURL,
  otherDevice,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { fakeSubscription, startRig } from '../../../tests/e2e/notifications.ts';
import { dayList, editor, newEvent, save } from './helpers.ts';

test.use({ timezoneId: 'Europe/Berlin' });

const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

const event = (page: Page, title: string) =>
  dayList(page).getByRole('button', { name: new RegExp(title) });

/** The reminders a device handed to its notification service. */
const entriesOf = async (request: Promise<Request>) =>
  (
    JSON.parse((await request).postData() ?? '{}') as {
      entries: { start: string; repeat: string; offset: number; payload: string }[];
    }
  ).entries;

test('events sync between devices: added, changed and deleted', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Calendar');

  // Added on the phone. What goes to the server is sealed: no titles or notes.
  let upload = uploaded(page);
  await newEvent(page, 'Secret dentist visit');
  await editor(page).getByLabel('Notes').fill('Bring the forms');
  await save(page);
  const response = await upload;
  expect(response.status()).toBe(200);
  const body = response.request().postData() ?? '';
  for (const text of ['Secret', 'dentist', 'forms']) expect(body).not.toContain(text);

  // The tablet gets it when it turns on sync.
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Calendar');
  await expect(event(tablet, 'Secret dentist visit')).toBeVisible();

  // Changed on the tablet, seen on the phone.
  upload = uploaded(tablet);
  await event(tablet, 'Secret dentist visit').click();
  await editor(tablet).getByLabel('Title').fill('Dentist, moved');
  await save(tablet);
  await upload;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(event(page, 'Dentist, moved')).toBeVisible();
  await expect(event(page, 'Secret dentist visit')).toHaveCount(0);

  // Deleted on the phone, gone from the tablet.
  upload = uploaded(page);
  await event(page, 'Dentist, moved').click();
  await editor(page).getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this event?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(event(tablet, 'Dentist, moved')).toHaveCount(0);
  await expect(tablet.locator('[data-sync-status]')).toHaveText('Synced just now.');
  await tablet.context().close();
});

test('keeps both versions of an event changed on two devices at once', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  guard.allowConsole('ERR_INTERNET_DISCONNECTED');
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Calendar');
  let upload = uploaded(page);
  await newEvent(page, 'Team lunch');
  await save(page);
  await upload;

  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Calendar');
  await expect(event(tablet, 'Team lunch')).toBeVisible();

  // The phone changes it while offline; the tablet changes it too.
  await page.context().setOffline(true);
  await event(page, 'Team lunch').click();
  await editor(page).getByLabel('Notes').fill('Bring cake');
  await save(page);
  upload = uploaded(tablet);
  await event(tablet, 'Team lunch').click();
  await editor(tablet).getByLabel('Notes').fill('Bring drinks');
  await save(tablet);
  await upload;

  // Back online, the phone keeps its version as a second event.
  await page.context().setOffline(false);
  await expect(page.locator('[data-sync-status]')).toHaveText(/both versions are kept/);
  await expect(event(page, 'Team lunch \\(second version\\)')).toBeVisible();
  await event(page, 'Team lunch \\(second version\\)').click();
  await expect(editor(page).getByLabel('Notes')).toHaveValue('Bring cake');
  await editor(page).getByRole('button', { name: 'Cancel' }).click();

  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(event(tablet, 'Team lunch \\(second version\\)')).toBeVisible();
  await expect(event(tablet, 'Team lunch')).toHaveCount(2);
  await tablet.context().close();
});

test('a reminder set on one device reminds on the others too', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  const rig = await startRig();
  try {
    const { key } = await createAccount(page);
    await page.goto('/');
    await turnOnSync(page, 'Calendar');

    // The tablet reminds even while Calendar is closed there.
    const tablet = await (
      await browser.newContext({
        locale: 'en-US',
        timezoneId: 'Europe/Berlin',
        serviceWorkers: 'allow',
      })
    ).newPage();
    await fakeSubscription(tablet, rig);
    await signInWithKey(tablet, key);
    await tablet.goto(`${new URL(page.url()).origin}/`);
    await tablet.getByLabel('Also remind me when Calendar is closed').check();
    await expect(tablet.locator('[data-closed-status]')).toHaveText(/^On:/);
    await turnOnSync(tablet, 'Calendar');

    // Set on the phone: every week, so it's always still to come…
    let upload = uploaded(page);
    await newEvent(page, 'Piano lesson');
    const date = await editor(page).getByLabel('Starts', { exact: true }).inputValue();
    await editor(page).getByLabel('Start time').fill('17:00');
    await editor(page).getByLabel('Repeats', { exact: true }).selectOption('weekly');
    await editor(page)
      .getByLabel('Reminder', { exact: true })
      .selectOption({ label: '15 minutes before' });
    await save(page);
    await upload;

    // …and on the tablet: shown, and handed to its own notification service.
    const schedule = (match: string) =>
      tablet.waitForRequest(
        (request) =>
          request.url().endsWith('/api/push/schedule') &&
          request.method() === 'PUT' &&
          (request.postData() ?? '').includes(match),
      );
    let request = schedule('"start"');
    await tablet.getByRole('button', { name: 'Sync now' }).click();
    await expect(event(tablet, 'Piano lesson, repeats, with a reminder')).toBeVisible();
    const entries = await entriesOf(request);
    expect(entries).toEqual([
      expect.objectContaining({ start: `${date}T17:00`, repeat: 'weekly', offset: 15 }),
    ]);
    expect(await rig.open(fromBase64Url(entries[0]?.payload ?? ''))).toMatchObject({
      title: 'Piano lesson',
    });

    // Turned off on the phone: off on the tablet too.
    upload = uploaded(page);
    await event(page, 'Piano lesson').click();
    await editor(page)
      .getByLabel('Reminder', { exact: true })
      .selectOption({ label: 'No reminder' });
    await save(page);
    await upload;
    request = schedule('"entries":[]');
    await tablet.getByRole('button', { name: 'Sync now' }).click();
    await expect(event(tablet, 'Piano lesson, repeats$')).toBeVisible();
    expect(await entriesOf(request)).toEqual([]);
    await tablet.context().close();
  } finally {
    rig.server.close();
  }
});
