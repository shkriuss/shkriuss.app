// Calendar's events syncing between two devices through the account
// (packages/sync, docs/adr/0010). The connect flow itself is tested for every
// app in tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import {
  createAccount,
  hubURL,
  otherDevice,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { dayList, editor, newEvent, save } from './helpers.ts';

test.use({ timezoneId: 'Europe/Berlin' });

const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

const event = (page: Page, title: string) =>
  dayList(page).getByRole('button', { name: new RegExp(title) });

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
