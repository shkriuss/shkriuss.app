/**
 * Security and privacy checks that run against EVERY site, using the real
 * _headers file served by Cloudflare's local runtime.
 */
import {
  BUILD_FILE_CACHE_CONTROL,
  contentSecurityPolicy,
} from '../../packages/astro-config/src/headers.ts';
import { robotsTxt } from '../../packages/astro-config/src/robots-txt.ts';
import { getSite } from '../../packages/registry/src/index.ts';
import { expect, test } from './fixtures.ts';

const REQUIRED_HEADERS: Record<string, string | RegExp> = {
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
  test(`security headers are sent for ${path}`, async ({ request }, testInfo) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    // Each project is one site, named by its slug.
    const site = getSite(testInfo.project.name);
    const expectedHeaders = {
      ...REQUIRED_HEADERS,
      'content-security-policy': contentSecurityPolicy({ webAssembly: site.webAssembly }),
    };
    for (const [name, expected] of Object.entries(expectedHeaders)) {
      if (typeof expected === 'string') expect(headers[name], name).toBe(expected);
      else expect(headers[name], name).toMatch(expected);
    }
  });
}

test('says where to report a security problem, for this site (audit 3 I-3)', async ({
  request,
}, testInfo) => {
  // RFC 9116: a security.txt covers only the host it's on, so every site has one.
  const response = await request.get('/.well-known/security.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain/);
  const { origin } = getSite(testInfo.project.name);
  expect(await response.text()).toContain(`Canonical: ${origin}/.well-known/security.txt`);
});

test('serves a robots.txt of its own, so Cloudflare doesn’t (audit 5 I-1)', async ({ request }) => {
  // Without one, Cloudflare served a robots.txt of its own under the site's name.
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toMatch(/^text\/plain/);
  expect(await response.text()).toBe(robotsTxt());
});

test('the CSP blocks inline scripts and only allows our own files', () => {
  const csp = contentSecurityPolicy();
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'self';");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain('unsafe-eval');
});

test('apps that run WebAssembly may compile it and start threads, and nothing else changes', () => {
  const csp = contentSecurityPolicy({ webAssembly: true });
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval';");
  expect(csp).toContain('trusted-types shkriuss-sw shkriuss-worker default');
  expect(csp.replace(" 'wasm-unsafe-eval'", '').replace(' default', '')).toBe(
    contentSecurityPolicy(),
  );
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toContain('unsafe-inline');
  expect(csp).not.toContain("'allow-duplicates'");
});

test('pages set no cookies and load nothing from other websites', async ({ page, context }) => {
  // The `guard` fixture fails this test if anything is requested from another origin.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(await context.cookies()).toEqual([]);
});

test('build files, pages and a “not found” for a build file are never kept without asking again', async ({
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
  expect(assetResponse.status()).toBe(200);
  expect(assetResponse.headers()['cache-control']).toBe(BUILD_FILE_CACHE_CONTROL);

  // A build file that isn't there gets the /_astro/* header too, on the "not
  // found" page. With a year-long "immutable" header, a browser kept that
  // failure for a year, and the page needing the file stayed broken on that
  // device (audit 5 Z-1).
  const missing = '/_astro/not-there.abcdef12.js';
  const missingResponse = await request.get(missing);
  expect(missingResponse.status()).toBe(404);
  for (const [path, response] of [
    [asset as string, assetResponse],
    [missing, missingResponse],
  ] as const) {
    const cacheControl = response.headers()['cache-control'] ?? '';
    expect(cacheControl, path).not.toContain('immutable');
    expect(cacheControl, path).not.toMatch(/max-age=[1-9]/);
  }

  // Pages and the service worker: never kept without asking the server again.
  for (const path of ['/', '/sw.js']) {
    const cacheControl = (await request.get(path)).headers()['cache-control'] ?? '';
    expect(cacheControl, path).not.toContain('immutable');
    expect(cacheControl, path).not.toMatch(/max-age=[1-9]/);
  }
});
