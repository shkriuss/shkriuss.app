import { defineConfig, devices, type Project } from "@playwright/test";

const port = 4173;
const inCi = process.env["CI"] !== undefined;

// Claude Code cloud sessions cannot download Playwright's browsers. They have one preinstalled
// Chromium, which the session-start hook exports here; Firefox and WebKit then run in CI only.
const chromiumExecutable = process.env["E2E_CHROMIUM_EXECUTABLE"];

const phone = { width: 412, height: 915 };
const tablet = { width: 1280, height: 800 };

// The real devices are an iPhone, a Pixel and a Pixel Tablet (architecture §14).
const allProjects: Project[] = [
  { name: "chromium-phone", use: { ...devices["Pixel 10"] } },
  {
    name: "chromium-tablet",
    use: { ...devices["Desktop Chrome"], viewport: tablet, deviceScaleFactor: 2, hasTouch: true },
  },
  { name: "firefox-phone", use: { ...devices["Desktop Firefox"], viewport: phone } },
  { name: "firefox-tablet", use: { ...devices["Desktop Firefox"], viewport: tablet } },
  { name: "webkit-phone", use: { ...devices["iPhone 17"] } },
  { name: "webkit-tablet", use: { ...devices["iPad (gen 11)"] } },
];

const projects =
  chromiumExecutable === undefined
    ? allProjects
    : allProjects
        .filter((project) => project.name?.startsWith("chromium-") === true)
        .map((project) => ({
          ...project,
          use: { ...project.use, launchOptions: { executablePath: chromiumExecutable } },
        }));

export default defineConfig({
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
  // The production build, served by Wrangler's local copy of Cloudflare's asset server with the
  // generated _headers file, as in production. Run `pnpm build` first.
  webServer: {
    command: `pnpm exec wrangler dev --port ${port} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
