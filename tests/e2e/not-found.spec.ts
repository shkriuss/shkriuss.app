import { expect, test } from './fixtures.ts';

test('unknown pages show the "Page not found" page with a 404 status', async ({ page, guard }) => {
  // Browsers log the 404 status of the page itself; that's expected here.
  guard.allowConsole('status of 404');
  const response = await page.goto('/this-page-does-not-exist/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await page.getByRole('main').getByRole('link').click();
  await expect(page).toHaveURL(/\/$/);
});
