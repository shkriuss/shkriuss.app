/**
 * The end-to-end test setup that every app shares (architecture §15, ADR 0008):
 *
 * - `playwrightConfig()`: the browsers and devices, and a server that serves the production
 *   build with its generated headers, as Cloudflare does;
 * - `test` and `expect`: Playwright's, with a fixture that fails a test on any security
 *   violation the browser reports.
 *
 * In an app's `playwright.config.ts`:
 *
 * ```ts
 * import { playwrightConfig } from "@shkriuss/config/playwright";
 * export default playwrightConfig({ port: 4173 });
 * ```
 *
 * In its tests: `import { expect, test } from "@shkriuss/config/playwright";`
 */
import {
  type Page,
  type PlaywrightTestConfig,
  type Project,
  test as base,
  defineConfig,
  devices,
  expect,
} from "@playwright/test";

export interface PlaywrightOptions {
  /** The port that this app's test server listens on; each app has its own. */
  readonly port: number;
}

const phone = { width: 412, height: 915 };
const tablet = { width: 1280, height: 800 };

/**
 * Firefox asks the user before it keeps an app's data until the user deletes it, which a test
 * cannot answer. These preferences, which Firefox's own tests use, answer yes instead.
 */
const firefox = {
  ...devices["Desktop Firefox"],
  launchOptions: {
    firefoxUserPrefs: {
      "dom.storageManager.prompt.testing": true,
      "dom.storageManager.prompt.testing.allow": true,
    },
  },
};

/**
 * Chromium as people have it: the whole browser, in its new headless mode. Playwright otherwise
 * runs its headless shell, a smaller build without Chrome's web app layer, which reads no app
 * id from a manifest and never checks whether an app can be installed.
 */
const chromium = { channel: "chromium" };

// The real devices are an iPhone, a Pixel and a Pixel Tablet (architecture §14).
const allProjects: Project[] = [
  { name: "chromium-phone", use: { ...devices["Pixel 10"], ...chromium } },
  {
    name: "chromium-tablet",
    use: {
      ...devices["Desktop Chrome"],
      ...chromium,
      viewport: tablet,
      deviceScaleFactor: 2,
      hasTouch: true,
    },
  },
  { name: "firefox-phone", use: { ...firefox, viewport: phone } },
  { name: "firefox-tablet", use: { ...firefox, viewport: tablet } },
  { name: "webkit-phone", use: { ...devices["iPhone 17"] } },
  { name: "webkit-tablet", use: { ...devices["iPad (gen 11)"] } },
];

/** The Playwright configuration of an app whose tests are in `e2e/`. Run `pnpm build` first. */
export function playwrightConfig({ port }: PlaywrightOptions): PlaywrightTestConfig {
  const inCi = process.env["CI"] !== undefined;

  // Claude Code cloud sessions cannot download Playwright's browsers. They have one
  // preinstalled Chromium, which the session-start hook exports here; Firefox and WebKit then
  // run in CI only.
  const chromiumExecutable = process.env["E2E_CHROMIUM_EXECUTABLE"];
  const projects =
    chromiumExecutable === undefined
      ? allProjects
      : allProjects
          .filter((project) => project.name?.startsWith("chromium-") === true)
          .map((project) => ({
            ...project,
            use: { ...project.use, launchOptions: { executablePath: chromiumExecutable } },
          }));

  return defineConfig({
    testDir: "e2e",
    fullyParallel: true,
    forbidOnly: inCi,
    // Flaky tests are fixed, never retried into passing (ADR 0008).
    retries: 0,
    reporter: inCi ? [["github"], ["list"]] : "list",
    use: {
      baseURL: `http://127.0.0.1:${port}`,
      trace: "retain-on-failure",
    },
    projects,
    // The production build, served by Wrangler's local copy of Cloudflare's asset server with
    // the generated _headers file, as in production. Each app's server also needs a devtools
    // port of its own: servers that start together would otherwise all pick the same free one.
    webServer: {
      command: `pnpm exec wrangler dev --port ${port} --ip 127.0.0.1 --inspector-port ${port + 5100}`,
      url: `http://127.0.0.1:${port}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { WRANGLER_SEND_METRICS: "false" },
    },
  });
}

declare global {
  interface Window {
    reportSecurityViolation?: (text: string) => void;
  }
}

/** What the browser reported while a test ran. */
export interface Security {
  /** CSP and Trusted Types violations, as "directive: blocked URI". */
  readonly violations: readonly string[];
  /** Call before doing something the browser must refuse; the test then checks the refusal. */
  readonly expectRefusals: () => void;
}

/**
 * Every test fails if a page reports a CSP or Trusted Types violation, logs an error, throws,
 * or has a request fail (architecture §15). That holds for every page of the test, such as a
 * second tab. Tests that provoke a refusal on purpose call `security.expectRefusals()` and
 * assert what was refused.
 */
export const test = base.extend<{ security: Security }>({
  security: [
    async ({ context }, use, testInfo) => {
      const violations: string[] = [];
      const problems: string[] = [];
      // Every console message and response, attached to failed tests for diagnosis.
      const log: string[] = [];
      let refusalsExpected = false;

      await context.exposeBinding("reportSecurityViolation", (_source, text: string) => {
        violations.push(text);
      });
      await context.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          window.reportSecurityViolation?.(`${event.effectiveDirective}: ${event.blockedURI}`);
        });
      });
      const watch = (page: Page): void => {
        page.on("console", (message) => {
          log.push(`console ${message.type()}: ${message.text()}`);
          if (message.type() === "error") {
            problems.push(`console error: ${message.text()}`);
          }
        });
        page.on("response", (response) => {
          log.push(`${response.status()} ${response.request().method()} ${response.url()}`);
        });
        page.on("pageerror", (error) => {
          problems.push(`uncaught error: ${error.message}`);
        });
        page.on("requestfailed", (request) => {
          problems.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? ""})`);
        });
      };
      context.pages().forEach(watch);
      context.on("page", watch);

      await use({
        violations,
        expectRefusals: () => {
          refusalsExpected = true;
        },
      });

      if (testInfo.status !== testInfo.expectedStatus) {
        const lines = [...violations.map((text) => `violation: ${text}`), ...problems, ...log];
        await testInfo.attach("browser log", { body: lines.join("\n"), contentType: "text/plain" });
      }
      if (!refusalsExpected) {
        expect([...violations, ...problems], "problems the browser reported").toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };
