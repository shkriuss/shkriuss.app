/**
 * Accessibility checks that run against EVERY site.
 * Pages are found by following links from the home page.
 */
import type { Page } from '@playwright/test';
import { checkA11y, expect, test } from './fixtures.ts';

const MAX_PAGES = 25;

/** Same-site pages linked from the home page (and their links), breadth first. */
async function discoverPages(page: Page): Promise<string[]> {
  const found = new Set<string>(['/']);
  const queue = ['/'];
  while (queue.length > 0 && found.size < MAX_PAGES) {
    const path = queue.shift() as string;
    await page.goto(path);
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
    for (const href of hrefs) {
      const url = new URL(href);
      if (url.origin !== new URL(page.url()).origin) continue;
      if (/\.[a-z0-9]+$/i.test(url.pathname)) continue; // files, not pages
      if (!found.has(url.pathname)) {
        found.add(url.pathname);
        queue.push(url.pathname);
      }
    }
  }
  return [...found].sort();
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`every page passes WCAG 2.2 AA checks in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const paths = await discoverPages(page);
    for (const path of [...paths, '/404']) {
      await page.goto(path);
      await checkA11y(page, `${path} (${colorScheme})`);
    }
  });
}

test('the theme switch changes and remembers the theme', async ({ page }) => {
  await page.goto('/');
  const themes = page.getByRole('group', { name: 'Colour theme' });
  await expect(themes.getByRole('radio', { name: 'System' })).toBeChecked();

  await themes.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await checkA11y(page, '/ (dark, chosen)');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(themes.getByRole('radio', { name: 'Dark' })).toBeChecked();

  await themes.getByRole('radio', { name: 'System' }).check();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
});

test('every page has a language, a title and exactly one main heading', async ({ page }) => {
  for (const path of await discoverPages(page)) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle(/\S/);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
  }
});

test('the skip link moves focus to the main content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('content reflows at 320px wide without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of await discoverPages(page)) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `Horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
  }
});

test('with text at 200%, pages fit a phone without sideways scrolling', async ({ page }) => {
  // Text made larger in the browser's or the phone's settings (audit G-11).
  await page.setViewportSize({ width: 360, height: 640 });
  for (const path of await discoverPages(page)) {
    await page.goto(path);
    const overflow = await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    });
    expect(overflow, `Horizontal overflow on ${path} with 200% text`).toBeLessThanOrEqual(0);
  }
});

test('the footer links are big enough to tap', async ({ page }) => {
  // The project's 44px rule (audit G-12).
  await page.goto('/');
  const links = page.getByRole('navigation', { name: 'Footer' }).getByRole('link');
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});
