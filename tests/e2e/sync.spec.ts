/**
 * "Sync between your devices" in EVERY app that can sync (`sync: true` in
 * apps.json; docs/adr/0010): connecting through the hub, turning it off,
 * cancelling, deleting the online copy, and moving to a new account key. Each app's own tests check that
 * its data really syncs.
 */
import type { Page } from '@playwright/test';
import { getSite } from '../../packages/registry/src/index.ts';
import {
  createAccount,
  hubURL,
  otherDevice,
  replaceKey,
  signInWithKey,
  turnOnSync,
} from './account.ts';
import { checkA11y, expect, test } from './fixtures.ts';

test.beforeEach(({ guard }, testInfo) => {
  test.skip(!getSite(testInfo.project.name).sync, 'This site doesn’t sync');
  guard.allowOrigin(hubURL);
});

const status = (page: Page) => page.locator('[data-sync-status]');

test('turns on through the account, and off again', async ({ page }, testInfo) => {
  const { name } = getSite(testInfo.project.name);
  const { code } = await createAccount(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sync between your devices' })).toBeVisible();
  await checkA11y(page, 'sync: off');

  await turnOnSync(page, name);
  await expect(page.locator('[data-sync-code]')).toHaveText(code);
  await expect(
    page.locator('[data-sync-on]').getByText(`On, with the account ${code}.`),
  ).toBeVisible();
  expect(page.url(), 'the key is taken out of the address bar').not.toContain('#');
  await checkA11y(page, 'sync: on');

  // Still on after a reload.
  await page.reload();
  await expect(page.locator('[data-sync-on]')).toBeVisible();
  await expect(status(page)).toHaveText(/Synced just now/);

  await page.getByRole('button', { name: 'Turn off on this device' }).click();
  await expect(page.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
  await expect(status(page)).toHaveText(/^Sync is off on this device/);
  // The app's key is gone from this device.
  expect(await page.evaluate(() => localStorage.getItem('shkriuss-device:sync'))).toContain(
    '"secret":null',
  );
});

test('asks to sign in first; cancelling leaves sync off', async ({ page }, testInfo) => {
  const { name } = getSite(testInfo.project.name);
  await page.goto('/');
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(
    page.getByText(`To sync ${name}, sign in or create an account first.`),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: `Sync ${name} with your account?` }),
  ).toBeVisible();
  await checkA11y(page, 'hub: connect an app');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(status(page)).toHaveText('Sync wasn’t turned on.');
  await expect(page.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
});

test('deleting the online copy stops sync on every device, keeping their data', async ({
  page,
  browser,
}, testInfo) => {
  const { name } = getSite(testInfo.project.name);
  const { key } = await createAccount(page);
  await page.goto('/');
  await turnOnSync(page, name);

  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${new URL(page.url()).origin}/`);
  await turnOnSync(tablet, name);

  await page.getByRole('button', { name: 'Delete the online copy' }).click();
  await page
    .getByRole('dialog', { name: 'Delete the online copy?' })
    .getByRole('button', { name: 'Delete the online copy' })
    .click();
  await expect(status(page)).toHaveText(
    'The online copy is deleted, and sync is off on this device.',
  );

  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(status(tablet)).toHaveText(/^The online copy was deleted on another device/);
  await expect(tablet.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
  await tablet.context().close();
});

test('after the account key is replaced, sync moves to the new key', async ({
  page,
  browser,
}, testInfo) => {
  const { name } = getSite(testInfo.project.name);
  const { key } = await createAccount(page);
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await turnOnSync(page, name);

  const tablet = await (await otherDevice(browser)).newPage();
  await signInWithKey(tablet, key);
  await tablet.goto(`${appURL}/`);
  await turnOnSync(tablet, name);

  // On the phone: replace the key, then turn on sync again (what the Account
  // page's "Turn on sync in …" link opens).
  const code = await replaceKey(page);
  await page.goto(`${appURL}/#sync=connect`);
  await expect(
    page.getByRole('heading', { name: `Sync ${name} with your account?` }),
  ).toBeVisible();
  await expect(page.locator('[data-connect-code]')).toHaveText(code);
  await page.getByRole('button', { name: `Turn on sync for ${name}` }).click();
  await page.waitForURL(`${appURL}/`);
  await expect(page.locator('[data-sync-code]')).toHaveText(code);
  await expect(status(page)).toHaveText(/^(Sync is on|Synced just now)/);

  // The tablet's copy was moved: it stops syncing, and says why.
  await tablet.getByRole('button', { name: 'Sync now' }).click();
  await expect(status(tablet)).toHaveText(/^Your account key was replaced on another device/);
  await expect(tablet.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
  await tablet.context().close();
});
