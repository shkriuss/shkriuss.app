/**
 * Browser tests. Each site runs in Cloudflare's local runtime (`wrangler dev`)
 * serving its built files with the real _headers, so tests see exactly what
 * production serves. Build first: `pnpm build && pnpm test:e2e`.
 *
 * Every site runs the shared tests in tests/e2e/ plus its own apps/<slug>/e2e/.
 */
import { defineConfig, devices } from '@playwright/test';
import { sites } from './tests/e2e/sites.ts';

const isCI = Boolean(process.env['CI']);
// Lets this run with a browser that's already installed (e.g. in a sandbox).
const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : '50%',
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    ...devices['Pixel 7'],
    // Mobile first: test on a phone-sized screen.
    locale: 'en-US',
    // Service workers cache aggressively; only the offline tests turn them on.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },

  projects: sites.map((site) => ({
    name: site.slug,
    testMatch: ['tests/e2e/**/*.spec.ts', `apps/${site.slug}/e2e/**/*.spec.ts`],
    use: { baseURL: site.baseURL },
  })),

  webServer: sites.map((site) => ({
    command: `pnpm exec wrangler dev --port ${site.port} --ip 127.0.0.1 --inspector-port ${site.port + 1000} --log-level warn`,
    cwd: site.dir,
    url: `${site.baseURL}/`,
    reuseExistingServer: !isCI,
    timeout: 90_000,
    env: { WRANGLER_SEND_METRICS: 'false' },
    stdout: 'ignore',
    stderr: 'pipe',
  })),
});
