/**
 * "Sync between your devices" in EVERY app that can sync (`sync: true` in
 * apps.json; docs/adr/0010): connecting through the hub, turning it off
 * (in the app, and from the hub's Account page), cancelling, deleting the
 * online copy, and moving to a new account key. Each app's own tests check
 * that its data really syncs.
 */
import type { Page } from '@playwright/test';
import { getSite } from '../../packages/registry/src/index.ts';
import {
  createAccount,
  hubURL,
  oldCopyMoved,
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
  await expect(page.locator('[data-sync-off]')).toContainText('with a free shkriuss account.');
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

test('the Account page turns sync off where it turned it on', async ({ page }, testInfo) => {
  const { name } = getSite(testInfo.project.name);
  const link = (turn: 'on' | 'off') =>
    page.getByRole('link', { name: `Turn ${turn} sync in ${name}` });
  await createAccount(page);
  await expect(link('on')).toBeVisible();
  await page.goto('/');
  const appURL = new URL(page.url()).origin;
  await turnOnSync(page, name);

  await page.goto(`${hubURL}/account/`);
  const href = (await link('off').getAttribute('href')) ?? '';
  expect(href.startsWith(`${appURL}/#sync=off&proof=`), href).toBe(true);

  // A link like it from someone else (another account) leaves sync on.
  await page.goto(`${appURL}/#sync=off&proof=${'A'.repeat(43)}`);
  await expect(status(page)).toHaveText(/^Sync is still on\. That link to turn it off came from/);
  await expect(page.locator('[data-sync-on]')).toBeVisible();
  expect(page.url()).not.toContain('#');

  await page.goto(`${hubURL}/account/`);
  await link('off').click();
  await page.waitForURL(`${appURL}/`);
  await expect(status(page)).toHaveText(/^Sync is off on this device/);
  await expect(status(page)).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
  await page.goto(`${hubURL}/account/`);
  await expect(link('on')).toBeVisible();
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
  guard,
}, testInfo) => {
  // The tablet learns the copy is gone from the server's answer, 410 Gone.
  guard.allowConsole('status of 410');
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

  // Back on screen, the tablet syncs. It may have already (Photos checks its
  // online library by itself), so the "Sync now" button may be gone.
  await tablet.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(status(tablet)).toHaveText(/^The online copy was deleted on another device/);
  await expect(tablet.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
  await tablet.context().close();
});

test('after the account key is replaced, sync moves to the new key', async ({
  page,
  browser,
  guard,
}, testInfo) => {
  // The tablet learns the copy moved from the server's answer, 410 Gone.
  guard.allowConsole('status of 410');
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
  const { code } = await replaceKey(page);
  // The Account page says this app here is still on the old key.
  await expect(
    page.getByRole('link', { name: `Turn on sync in ${name} again (it’s still on the old key)` }),
  ).toBeVisible();
  await page.goto(`${appURL}/#sync=connect`);
  await expect(
    page.getByRole('heading', { name: `Sync ${name} with your account?` }),
  ).toBeVisible();
  await expect(page.locator('[data-connect-code]')).toHaveText(code);
  const moved = oldCopyMoved(page);
  await page.getByRole('button', { name: `Turn on sync for ${name}` }).click();
  await page.waitForURL(`${appURL}/`);
  await expect(page.locator('[data-sync-code]')).toHaveText(code);
  await expect(status(page)).toHaveText(/^(Sync is on|Synced just now)/);

  // Once the phone has moved the old copy, the tablet stops syncing at its next
  // sync, and says why. Back on screen, it syncs; it may have already (Photos
  // checks its online library by itself), so the "Sync now" button may be gone.
  await moved;
  await tablet.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(status(tablet)).toHaveText(/^Your account key was replaced on another device/);
  await expect(tablet.getByRole('button', { name: 'Turn on sync' })).toBeVisible();
  await tablet.context().close();
});
