/**
 * Helpers for browser tests that use the shkriuss account (docs/adr/0010):
 * create one on the hub, sign in with a recovery key, and turn on sync in an
 * app (which goes to the hub's Account page and back).
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
  await page.getByRole('button', { name: 'Turn on sync' }).click();
  await expect(
    page.getByRole('heading', { name: `Sync ${appName} with your account?` }),
  ).toBeVisible();
  await page.getByRole('button', { name: `Turn on sync for ${appName}` }).click();
  await page.waitForURL(`${appURL}/`);
  await expect(page.locator('[data-sync-on]')).toBeVisible();
  await expect(page.locator('[data-sync-status]')).toHaveText(/^(Sync is on|Synced just now)/);
}

/** A second device with its own storage. */
export async function otherDevice(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
}
