/**
 * Install and offline checks that run against EVERY site.
 */
import { expect, test } from './fixtures.ts';

test('has a valid web app manifest with working icons', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ start_url: '/', scope: '/', display: 'standalone' });
  expect(manifest.name).toBeTruthy();

  const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(
    true,
  );

  for (const icon of manifest.icons as { src: string; type: string }[]) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok(), icon.src).toBe(true);
    expect(iconResponse.headers()['content-type'], icon.src).toContain(icon.type);
  }
  expect((await request.get('/apple-touch-icon.png')).ok()).toBe(true);
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('works offline after the first visit', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // The service worker controls the page from the next load on.
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    await context.setOffline(false);
  });
});
