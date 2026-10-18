// Habits syncing between two devices through the account (packages/sync,
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

const card = (page: Page, name: string) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
const doneToday = (page: Page, name: string) =>
  page.getByRole('button', { name: `${name}: done today` });
const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

test('habits and check marks sync, and the same day ticked twice stays one', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  guard.allowConsole('ERR_INTERNET_DISCONNECTED');
  const { key } = await createAccount(page);
  await page.goto('/');
  await page.getByLabel('New habit').fill('Read');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await turnOnSync(page, 'Habits');

  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, 'Habits');
  await expect(card(tablet, 'Read')).toBeVisible();

  // Both tick today, one of them offline: still one habit, done, and no second version.
  const status = page.locator('[data-sync-status]');
  await page.context().setOffline(true);
  await doneToday(page, 'Read').click();
  await expect(status).toHaveText(/no connection/);
  let upload = uploaded(tablet);
  await doneToday(tablet, 'Read').click();
  await upload;
  await page.context().setOffline(false);
  // The problem goes once a sync has worked; the "Sync is on" note stays until then.
  await expect(status).toHaveText(/^Sync is on/);
  await expect(page.getByRole('listitem').filter({ has: page.locator('[data-name]') })).toHaveCount(
    1,
  );
  await expect(doneToday(page, 'Read')).toHaveAttribute('aria-pressed', 'true');

  // The tablet ticks yesterday too: the phone's streak grows.
  await tablet.getByRole('button', { name: 'Edit Read' }).click();
  await tablet.getByRole('dialog', { name: 'Edit habit' }).getByLabel('Yesterday').check();
  upload = uploaded(tablet);
  await tablet.getByRole('button', { name: 'Save' }).click();
  await upload;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(card(page, 'Read').locator('[data-streak]')).toHaveText('2-day streak');

  // Names never reach the server readable.
  upload = uploaded(page);
  await page.getByLabel('New habit').fill('Secret habit');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await upload).request().postData() ?? '').not.toContain('Secret habit');
  await tablet.context().close();
});
