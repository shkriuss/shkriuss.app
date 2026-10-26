// Tasks syncing between two devices through the account (packages/sync,
// docs/adr/0010), reminders included. The connect flow itself is tested for
// every app in tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import {
  createAccount,
  expectSealed,
  hubURL,
  otherDevice,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { fakeSubscription, startRig } from '../../../tests/e2e/notifications.ts';
import { addTask, box, chip, editor, row, titles } from './helpers.ts';

const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

/** Two devices on one account, both syncing Tasks. */
async function twoDevices(page: Page, browser: Parameters<typeof otherDevice>[0]) {
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, 'Tasks');
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Tasks');
  return tablet;
}

test('tasks, lists and ticks reach the other device', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  const tablet = await twoDevices(page, browser);

  // A list and a task in it, on the phone.
  let upload = uploaded(page);
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByRole('dialog', { name: 'New list' }).getByLabel('Name').fill('Shopping');
  await page
    .getByRole('dialog', { name: 'New list' })
    .getByRole('button', { name: 'Save' })
    .click();
  await addTask(page, 'Secret gift');
  await expectSealed(page, 'tasks', await upload, 'Secret gift');
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(chip(tablet, 'Shopping')).toHaveText(/1$/);
  await expect(titles(tablet)).toHaveText(['Secret gift']);

  // Ticked off on the tablet: done on the phone too.
  upload = uploaded(tablet);
  await box(tablet, 'Secret gift').click();
  await upload;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(titles(page)).toHaveCount(0);
  await expect(page.locator('[data-done-summary]')).toHaveText('Done (1)');

  // Changed on the phone: the tablet gets it.
  upload = uploaded(page);
  await page.locator('[data-done-summary]').click();
  await page.getByRole('button', { name: 'Edit Secret gift' }).click();
  await editor(page).getByLabel('Title').fill('Flowers');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await tablet.locator('[data-done-summary]').click();
  await expect(tablet.locator('[data-done-list] [data-action="edit"]')).toHaveText(['Flowers']);
  await tablet.context().close();
});

test('a reminder set on one device reminds on the others too', async ({ page, browser, guard }) => {
  guard.allowOrigin(hubURL);
  const rig = await startRig();
  try {
    const { key } = await createAccount(page);
    await page.goto('/');
    const appURL = new URL(page.url()).origin;
    await addTask(page, 'Dentist');
    await turnOnSync(page, 'Tasks');

    // The tablet reminds even while Tasks is closed there.
    const tablet = await (
      await browser.newContext({ locale: 'en-US', serviceWorkers: 'allow' })
    ).newPage();
    await fakeSubscription(tablet, rig);
    await signInWithKey(tablet, key);
    await tablet.goto(`${appURL}/`);
    await tablet.getByLabel('Also remind me when Tasks is closed').check();
    await expect(tablet.locator('[data-closed-status]')).toHaveText(
      'On: reminders arrive even when Tasks is closed.',
    );
    await turnOnSync(tablet, 'Tasks');
    await expect(titles(tablet)).toHaveText(['Dentist']);

    // Set on the phone, well ahead so it's always still to come…
    const date = new Date(Date.now() + 60 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const upload = uploaded(page);
    await page.getByRole('button', { name: 'Edit Dentist' }).click();
    await editor(page).getByLabel('Date (optional)').fill(date);
    await editor(page).getByLabel('Time (optional)').fill('10:00');
    await editor(page).getByLabel('Remind me').selectOption({ label: '1 day before' });
    await editor(page).getByRole('button', { name: 'Save' }).click();
    await upload;

    // …and on the tablet: shown, and handed to its own notification service.
    const schedule = tablet.waitForRequest(
      (request) =>
        request.url().endsWith('/api/push/schedule') &&
        request.method() === 'PUT' &&
        (request.postData() ?? '').includes('"start"'),
    );
    await tablet.getByRole('button', { name: 'Sync now' }).click();
    await expect(row(tablet, 'Dentist').locator('[data-reminder-tag]')).toBeVisible();
    const { entries } = JSON.parse((await schedule).postData() ?? '{}') as {
      entries: unknown[];
    };
    expect(entries).toEqual([
      expect.objectContaining({ start: `${date}T10:00`, repeat: 'none', offset: 1440 }),
    ]);
    await tablet.context().close();
  } finally {
    rig.server.close();
  }
});
