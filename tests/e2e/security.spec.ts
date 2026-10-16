/**
 * Security and privacy checks that run against EVERY site, using the real
 * _headers file served by Cloudflare's local runtime.
 */
import { contentSecurityPolicy } from '../../packages/astro-config/src/headers.ts';
import { expect, test } from './fixtures.ts';

const REQUIRED_HEADERS: Record<string, string | RegExp> = {
  'content-security-policy': contentSecurityPolicy(),
  'strict-transport-security': /max-age=\d{8,}; includeSubDomains; preload/,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': /camera=\(\).*geolocation=\(\).*microphone=\(\)/,
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
};

for (const path of ['/', '/404', '/manifest.webmanifest', '/sw.js']) {
  test(`security headers are sent for ${path}`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    for (const [name, expected] of Object.entries(REQUIRED_HEADERS)) {
      if (typeof expected === 'string') expect(headers[name], name).toBe(expected);
      else expect(headers[name], name).toMatch(expected);
    }
  });
}

test('the CSP blocks inline scripts and only allows our own files', () => {
  const csp = contentSecurityPolicy();
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
});

test('pages set no cookies and load nothing from other websites', async ({ page, context }) => {
  // The `guard` fixture fails this test if anything is requested from another origin.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(await context.cookies()).toEqual([]);
});

test('hashed build files are cached for a year, pages are always revalidated', async ({
  page,
  request,
}) => {
  await page.goto('/');
  const asset = await page
    .locator('link[rel="stylesheet"][href^="/_astro/"]')
    .first()
    .getAttribute('href');
  expect(asset).toBeTruthy();
  const assetResponse = await request.get(asset as string);
  expect(assetResponse.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

  const pageResponse = await request.get('/');
  expect(pageResponse.headers()['cache-control']).not.toContain('immutable');
});
