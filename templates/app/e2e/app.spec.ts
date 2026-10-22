// Tests for this app. Shared checks (accessibility, security headers, offline
// support, privacy) already run for every app from tests/e2e/; add tests here
// for what makes this app special. Import test and expect from the shared
// fixtures: they fail a test on console errors, CSP problems and requests to
// other websites.
import { expect, test } from '../../../tests/e2e/fixtures.ts';

test('shows the app name as the main heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
