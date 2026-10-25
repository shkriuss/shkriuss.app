/**
 * Helpers for browser tests that use the shkriuss account (docs/adr/0010):
 * create one on the hub, sign in with a recovery key, turn on sync in an app
 * (which goes to the hub's Account page and back), and replace the key.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from './fixtures.ts';
import { sites } from './sites.ts';

export const hubURL = sites.find((site) => site.slug === 'hub')?.baseURL ?? '';

/** Creates an account on the hub. Returns its recovery key and account code. */
export async function createAccount(page: Page): Promise<{ key: string; code: string }> {
  await page.goto(`${hubURL}/account/`);
  await page.getByRole('button', { name: 'Create an account' }).click();
  const key = (await page.locator('[data-new-key]').textContent()) ?? '';
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Continue' }).click();
  const code = page.locator('[data-account-code]');
  await expect(code).toHaveText(/^\w{4}-\w{4}$/);
  return { key, code: (await code.textContent()) ?? '' };
}

/** Signs a device in on the hub with a recovery key. */
export async function signInWithKey(page: Page, key: string): Promise<void> {
  await page.goto(`${hubURL}/account/`);
  await page.getByRole('button', { name: 'Use my recovery key' }).click();
  await page.getByRole('textbox', { name: 'Recovery key' }).fill(key);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('[data-account-code]')).toBeVisible();
}

/** On an app's page: "Turn on sync", confirm on the hub, and wait until it's synced. */
export async function turnOnSync(page: Page, appName: string): Promise<void> {
  const appURL = new URL(page.url()).origin;
  const since = await page.evaluate(() => Date.now());
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(
    page.getByRole('heading', { name: `Sync ${appName} with your account?` }),
  ).toBeVisible();
  await page.getByRole('button', { name: `Turn on sync for ${appName}` }).click();
  await page.waitForURL(`${appURL}/`);
  await expect(page.locator('[data-sync-on]')).toBeVisible();
  await expect(page.locator('[data-sync-status]')).toHaveText(/^(Sync is on|Synced just now)/);
  // "Sync is on" shows before the first sync is over. Wait for it, upload
  // included: a test waiting for the upload of its next change mustn't get
  // this one instead (and check the other device too early).
  await syncedSince(page, since);
}

/** Resolves once the app on `page` has finished a sync that started at `since` or later (its own clock). */
export async function syncedSince(page: Page, since: number): Promise<void> {
  await page.waitForFunction((after) => {
    const state = JSON.parse(localStorage.getItem('shkriuss-device:sync') ?? 'null') as {
      last?: number | null;
    } | null;
    return (state?.last ?? 0) >= after;
  }, since);
}

/**
 * After the account key is replaced and an app connects again: resolves once
 * the app has moved its old online copy and deleted it (what makes other
 * devices stop). Start waiting before connecting.
 */
export const oldCopyMoved = (page: Page) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/sync/copy?moved') &&
      response.request().method() === 'DELETE' &&
      response.ok(),
  );

/**
 * On the hub's Account page, signed in: replaces the account key. Returns the
 * new recovery key and account code.
 */
export async function replaceKey(page: Page): Promise<{ key: string; code: string }> {
  await page.goto(`${hubURL}/account/`);
  await page.getByRole('button', { name: 'Replace the account key' }).click();
  await page.getByRole('button', { name: 'Get a new key' }).click();
  const key = (await page.locator('[data-new-key]').textContent()) ?? '';
  await page.getByLabel("I've saved my recovery key").check();
  await page.getByRole('button', { name: 'Replace the key' }).click();
  const code = page.locator('[data-account-code]');
  await expect(page.locator('[data-message]')).toHaveText(/^Your account key is replaced/);
  return { key, code: (await code.textContent()) ?? '' };
}

/** A second device with its own storage. */
export async function otherDevice(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
}
