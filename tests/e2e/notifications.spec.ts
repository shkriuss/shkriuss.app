/**
 * Notifications while the app is open, in EVERY app with reminders
 * (`pushNotifications: true` in apps.json; @shkriuss/ui/local-reminders,
 * audit J-6): the status line and "Turn on notifications" for each
 * permission, including an iPhone browser that can't show notifications
 * until the app is on the Home Screen. Each app's own tests check its
 * reminders.
 */
import type { Page } from '@playwright/test';
import { getSite } from '../../packages/registry/src/index.ts';
import { expect, test } from './fixtures.ts';
import { fakeNotifications } from './notifications.ts';

test.beforeEach(() => {
  test.skip(!getSite(test.info().project.name).pushNotifications, 'This site has no reminders');
});

const status = (page: Page) => page.locator('[data-notify-status]');
const enable = (page: Page) => page.getByRole('button', { name: 'Turn on notifications' });

test('turns on notifications with the button, keeping focus near it', async ({ page }) => {
  await fakeNotifications(page, 'default');
  await page.goto('/');
  await expect(status(page)).toHaveText(/^Notifications are off\./);
  await enable(page).click();
  await expect(enable(page)).toBeHidden();
  await expect(status(page)).toHaveText(/^Notifications are on\./);
  await expect(status(page)).toBeFocused();
});

test('says when notifications are blocked', async ({ page }, testInfo) => {
  const { name } = getSite(testInfo.project.name);
  await fakeNotifications(page, 'denied');
  await page.goto('/');
  await expect(status(page)).toHaveText(new RegExp(`^Notifications are blocked for ${name}`));
  await expect(enable(page)).toBeHidden();
});

test('says how to get them on an iPhone (no notifications in the browser)', async ({
  page,
}, testInfo) => {
  const { name } = getSite(testInfo.project.name);
  await fakeNotifications(page, 'unsupported');
  await page.goto('/');
  await expect(status(page)).toHaveText(/^This browser can’t show notifications/);
  await expect(status(page)).toContainText(`add ${name} to your Home Screen`);
  await expect(enable(page)).toBeHidden();
});
