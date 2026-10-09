/**
 * The end-to-end test setup that every app shares (architecture §15, ADR 0008):
 *
 * - `playwrightConfig()`: the browsers and devices, and a server that serves the production
 *   build with its generated headers, as Cloudflare does;
 * - `test` and `expect`: Playwright's, with a fixture that fails a test on any security
 *   violation the browser reports, and `network`, the way to the app's server, which a test
 *   cuts to go offline.
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
import http from "node:http";
import {
  type BrowserContext,
  type Page,
  type PlaywrightTestConfig,
  type Project,
  type Request,
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

// The real devices are an iPhone, a Pixel and a Pixel Tablet (architecture §14). Each project's
// name starts with its browser's: CI runs each browser's projects in jobs of their own.
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
  /** Console errors, uncaught errors and failed requests, in the words of the test's failure. */
  readonly problems: readonly string[];
  /** Call before doing something the browser must refuse; the test then checks the refusal. */
  readonly expectRefusals: () => void;
  /** Watches another browser context of the test, such as another device's, as its own. */
  readonly watch: (context: BrowserContext) => Promise<void>;
}

/** Requests that the network holds back until the test lets them through. */
export interface Hold {
  /** Settles once the first of them has come. */
  readonly arrived: Promise<void>;
  /** Lets them through, and those that come later. */
  readonly release: () => void;
}

/** The way from the browser to the app's server, which a test can hold up or cut. */
export interface Network {
  /** The app's address through this network: an origin of its own, with its own storage. */
  readonly url: string;
  /** From now on, holds back the requests whose path ends with `suffix`. */
  readonly hold: (suffix: string) => Hold;
  /** From now on, the network closes every connection instead of answering, as offline. */
  readonly cut: () => void;
}

/**
 * A proxy to the app's server at `target`, as tooling/pwa-e2e has. Playwright's
 * `context.setOffline()` cannot stand in for it: its WebKit then fails every load, even those
 * that the service worker answers.
 */
async function networkTo(target: string): Promise<Network & { close(): Promise<void> }> {
  const { hostname, port } = new URL(target);
  let up = true;
  let held:
    | { readonly suffix: string; readonly waiting: (() => void)[]; readonly came: () => void }
    | undefined;
  const server = http.createServer((request, response) => {
    if (!up) {
      request.socket.destroy();
      return;
    }
    function forward(): void {
      const upstream = http.request(
        {
          host: hostname,
          port,
          method: request.method,
          path: request.url,
          headers: request.headers,
        },
        (answer) => {
          response.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
          answer.pipe(response);
        },
      );
      upstream.on("error", () => {
        response.destroy();
      });
      request.pipe(upstream);
    }
    if (held !== undefined && request.url?.endsWith(held.suffix) === true) {
      held.waiting.push(forward);
      held.came();
      return;
    }
    forward();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The proxy listens on no port.");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    hold: (suffix) => {
      const waiting: (() => void)[] = [];
      const { promise, resolve } = Promise.withResolvers<void>();
      held = { suffix, waiting, came: resolve };
      return {
        arrived: promise,
        release: () => {
          held = undefined;
          for (const forward of waiting) {
            forward();
          }
        },
      };
    },
    cut: () => {
      up = false;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/**
 * Every test fails if a page reports a CSP or Trusted Types violation, logs an error, throws,
 * or has a request fail (architecture §15), but for one that a navigation of the page cancels.
 * That holds for every page of the test, such as a second tab, or another device's. Tests that
 * provoke a refusal on purpose call `security.expectRefusals()` and assert what was refused.
 *
 * `otherDevice` is a page of another device: a browser context of its own, with its own
 * storage, and the options of the test's project, such as its viewport.
 *
 * `network` is the way to the app's server, for a test that opens the app at `network.url`
 * (CLAUDE.md: every app works offline after its first load). Cutting it fails every request
 * that reaches the network, as offline, while the service worker still answers; holding it up
 * keeps, say, a module from coming until the test lets it.
 */
export const test = base.extend<{ security: Security; otherDevice: Page; network: Network }>({
  security: [
    async ({ context }, use, testInfo) => {
      const violations: string[] = [];
      const problems: string[] = [];
      // Every console message and response, attached to failed tests for diagnosis.
      const log: string[] = [];
      let refusalsExpected = false;

      const watch = (page: Page): void => {
        // The page's navigations so far, and how many had started when each request did.
        let navigations = 0;
        const started = new WeakMap<Request, number>();
        page.on("request", (request) => {
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            navigations += 1;
          }
          started.set(request, navigations);
        });
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
          const error = request.failure()?.errorText ?? "";
          // A navigation of the page, such as the test's reload, cancels what the page still had
          // under way, which some versions of Chromium report as failed. Nothing failed: say, a
          // favicon that Chromium fetches again when the app changes its address, which waited
          // behind the service worker's first downloads.
          if (error === "net::ERR_ABORTED" && started.get(request) !== navigations) {
            return;
          }
          problems.push(`request failed: ${request.url()} (${error})`);
        });
      };
      const watchContext = async (watched: BrowserContext): Promise<void> => {
        await watched.exposeBinding("reportSecurityViolation", (_source, text: string) => {
          violations.push(text);
        });
        await watched.addInitScript(() => {
          document.addEventListener("securitypolicyviolation", (event) => {
            window.reportSecurityViolation?.(`${event.effectiveDirective}: ${event.blockedURI}`);
          });
        });
        watched.pages().forEach(watch);
        watched.on("page", watch);
      };
      await watchContext(context);

      await use({
        violations,
        problems,
        expectRefusals: () => {
          refusalsExpected = true;
        },
        watch: watchContext,
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
  otherDevice: async ({ browser, security }, use) => {
    // A context that a test creates has the options of its project too.
    const context = await browser.newContext();
    await security.watch(context);
    await use(await context.newPage());
    // The test is over: closing the context fails what its pages still had under way.
    await Promise.all(context.pages().map(async (page) => page.removeAllListeners()));
    await context.close();
  },
  network: async ({ baseURL }, use) => {
    if (baseURL === undefined) {
      throw new Error("The network leads to the app's server at the config's baseURL.");
    }
    const network = await networkTo(baseURL);
    await use(network);
    await network.close();
  },
});

export { expect };
