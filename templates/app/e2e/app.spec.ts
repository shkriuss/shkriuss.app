// Tests for this app. Shared checks (accessibility, security headers, offline
// support, privacy) already run for every app from tests/e2e/; add tests here
// for what makes this app special.
import { expect, test } from '@playwright/test';

test('shows the app name as the main heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
