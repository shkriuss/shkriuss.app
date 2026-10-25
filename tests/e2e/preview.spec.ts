/**
 * Previews of a change look just like the real sites, so every page of one
 * says it's a preview, and not to use a real account or real data there
 * (audit D-2). Here the site's own pages are served at a preview's address.
 */
import { checkA11y, expect, test } from './fixtures.ts';

const PREVIEW = 'https://pr-1-site.shkriuss.workers.dev';
const NOTE =
  /^This is a preview of a change to .+, for testing\. Don’t use your real shkriuss account or your real data here\.$/;

test('on a preview’s address, every page says it’s a preview', async ({ page, baseURL, guard }) => {
  guard.allowOrigin(PREVIEW);
  await page.route(`${PREVIEW}/**`, async (route) => {
    const { pathname, search } = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `${baseURL}${pathname}${search}` }) });
  });
  const note = page.locator('[data-preview-note]');
  for (const path of ['/', '/404']) {
    await page.goto(`${PREVIEW}${path}`);
    await expect(note).toBeVisible();
    await expect(note).toHaveText(NOTE);
  }
  await checkA11y(page, 'a preview');

  // Not on the real site's address (here, the tests' own).
  await page.goto('/');
  await expect(note).toBeHidden();
});
