/**
 * Shared Playwright setup. Import `test` and `expect` from here (not from
 * @playwright/test) to get these checks in every test automatically:
 *
 * - no JavaScript errors or console errors (this includes CSP and Trusted
 *   Types violations, which browsers report as console errors);
 * - no requests to any other website (no trackers, fonts or CDNs).
 *
 * They cover every page the test opens: its own, other tabs, and the pages
 * of "other devices" (contexts made with browser.newContext()), where synced
 * data, which is untrusted input, is shown.
 *
 * Also provides `checkA11y(page)`, which runs axe with WCAG 2.2 A/AA rules.
 */
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

export const WCAG_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22a',
  'wcag22aa',
  'best-practice',
];

/** Fails the test with a readable list if axe finds accessibility problems. */
export async function checkA11y(page: Page, label = page.url()): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const problems = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}\n` +
      violation.nodes.map((node) => `    at ${node.target.join(' ')}`).join('\n'),
  );
  expect(problems, `Accessibility problems on ${label}`).toEqual([]);
}

interface Guard {
  /** Console messages that are expected in this test (substring match). */
  allowConsole: (text: string) => void;
  /** Another of our own sites this test visits (e.g. the hub, for the account). */
  allowOrigin: (origin: string) => void;
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page, browser, baseURL }, use) => {
      const errors: string[] = [];
      const external: string[] = [];
      const allowed: string[] = [];
      const origins = new Set([new URL(baseURL ?? 'http://127.0.0.1').origin]);

      const watched = new WeakSet<Page>();
      const watch = (watchedPage: Page, where: string) => {
        if (watched.has(watchedPage)) return;
        watched.add(watchedPage);
        watchedPage.on('pageerror', (error) => errors.push(`${where}Page error: ${error.message}`));
        watchedPage.on('console', (message) => {
          if (message.type() === 'error') errors.push(`${where}Console error: ${message.text()}`);
        });
        watchedPage.on('request', (request) => {
          const url = new URL(request.url());
          if (['data:', 'blob:'].includes(url.protocol)) return;
          if (!origins.has(url.origin)) external.push(request.url());
        });
      };
      const watchContext = (context: BrowserContext, where: string) => {
        for (const open of context.pages()) watch(open, where);
        context.on('page', (opened) => watch(opened, where));
      };
      watch(page, '');
      watchContext(page.context(), '');
      // Other devices: every context made during this test (browser.newPage() too).
      const newContext = browser.newContext;
      browser.newContext = async (...options) => {
        const context = await newContext.apply(browser, options);
        watchContext(context, 'Another device: ');
        return context;
      };

      try {
        await use({
          allowConsole: (text) => allowed.push(text),
          allowOrigin: (origin) => origins.add(new URL(origin).origin),
        });
      } finally {
        browser.newContext = newContext;
      }

      const unexpected = errors.filter((error) => !allowed.some((text) => error.includes(text)));
      expect(unexpected, 'Unexpected errors in the browser console').toEqual([]);
      expect(external, 'Requests to other websites (not allowed)').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
