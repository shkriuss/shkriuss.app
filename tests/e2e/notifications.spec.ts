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
  // Focus reads it out: it isn't said a second time (audit 3 G-11).
  await expect(page.locator('[data-announcer]')).not.toHaveText(/Notifications are on/);
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
  // The app there starts empty (audit 6 Z-1).
  await expect(status(page)).toContainText(
    'It starts empty there: see “Your data” below to bring what’s saved here.',
  );
  await expect(enable(page)).toBeHidden();
});

test.describe('in Safari on an iPhone', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  test('says reminders while closed need the Home Screen, where the app starts empty (audit 6 Z-1)', async ({
    page,
  }, testInfo) => {
    const { name } = getSite(testInfo.project.name);
    // Safari has no notifications outside the Home Screen.
    await fakeNotifications(page, 'unsupported');
    await page.goto('/');
    await expect(page.locator('[data-closed-status]')).toHaveText(
      `On iPhone and iPad, add ${name} to your Home Screen and open it from there to get reminders while it’s closed. It starts empty there: see “Your data” below to bring what’s saved here.`,
    );
    await expect(
      page.getByRole('checkbox', { name: `Also remind me when ${name} is closed` }),
    ).toBeDisabled();
  });
});
