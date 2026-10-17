// Tally's counters syncing between two devices through the account
// (packages/sync, docs/adr/0010). The connect flow itself is tested for every
// app in tests/e2e/sync.spec.ts.
import type { Page } from '@playwright/test';
import {
  createAccount,
  hubURL,
  otherDevice,
  replaceKey,
  signInWithKey,
  turnOnSync,
} from '../../../tests/e2e/account.ts';
import { expect, test } from '../../../tests/e2e/fixtures.ts';

async function addCounter(page: Page, name: string): Promise<void> {
  await page.getByLabel('New counter').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

const value = (page: Page, name: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .locator('[data-value]');

const uploaded = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy') && response.request().method() === 'PUT',
  );

test('counters from both devices are kept, and counts follow the latest change', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  const { key } = await createAccount(page);

  // Each device already has its own counter before turning on sync.
  await page.goto('/');
  await addCounter(page, 'Water');
  await turnOnSync(page, 'Tally');

  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await addCounter(tablet, 'Steps');
  await turnOnSync(tablet, 'Tally');
  await expect(value(tablet, 'Water')).toHaveText('0');
  await expect(value(tablet, 'Steps')).toHaveText('0');

  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(value(page, 'Steps')).toHaveText('0');

  // Counted on the phone, then on the tablet: the latest change wins.
  let upload = uploaded(page);
  await page.getByRole('button', { name: 'Add 1 to Water' }).click();
  await upload;
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(value(tablet, 'Water')).toHaveText('1');
  upload = uploaded(tablet);
  await tablet.getByRole('button', { name: 'Add 1 to Water' }).click();
  await tablet.getByRole('button', { name: 'Add 1 to Water' }).click();
  await upload;
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(value(page, 'Water')).toHaveText('3');

  // Names never reach the server readable.
  upload = uploaded(page);
  await addCounter(page, 'Secret habit');
  expect((await upload).request().postData() ?? '').not.toContain('Secret habit');
  await tablet.context().close();
});

test('counters move to the new key when the account key is replaced', async ({
  page,
  browser,
  guard,
}) => {
  guard.allowOrigin(hubURL);
  const { key } = await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await addCounter(page, 'Water');
  await turnOnSync(page, 'Tally');

  // The tablet adds a counter that only the old online copy has.
  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${appURL}/`);
  await turnOnSync(tablet, 'Tally');
  const upload = uploaded(tablet);
  await addCounter(tablet, 'Steps');
  await upload;

  // The phone replaces the key and turns on sync again: the tablet's counter comes along.
  await replaceKey(page);
  await page.goto(`${appURL}/#sync=connect`);
  await page.getByRole('button', { name: 'Turn on sync for Tally' }).click();
  await page.waitForURL(`${appURL}/`);
  await expect(value(page, 'Steps')).toHaveText('0');
  await expect(value(page, 'Water')).toHaveText('0');

  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(tablet.locator('[data-sync-status]')).toHaveText(/^Your account key was replaced/);
  await tablet.context().close();
});
