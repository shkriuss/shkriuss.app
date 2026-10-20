// Tasks syncing between two devices through the account (packages/sync,
// docs/adr/0010). The connect flow itself is tested for every app in
// tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import {
  createAccount,
  hubURL,
  otherDevice,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';
import { addTask, box, chip, editor, titles } from './helpers.ts';

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
  const request = (await upload).request();
  expect(request.postData() ?? '').not.toContain('Secret gift');
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
