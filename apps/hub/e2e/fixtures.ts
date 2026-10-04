import { test as base, expect } from "@playwright/test";

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
 * Every test fails if the page reports a CSP or Trusted Types violation, logs an error,
 * throws, or has a request fail (architecture §15). Tests that provoke a refusal on purpose
 * call `security.expectRefusals()` and assert what was refused.
 */
export const test = base.extend<{ security: Security }>({
  security: [
    async ({ page }, use, testInfo) => {
      const violations: string[] = [];
      const problems: string[] = [];
      // Every console message and response, attached to failed tests for diagnosis.
      const log: string[] = [];
      let refusalsExpected = false;

      await page.exposeBinding("reportSecurityViolation", (_source, text: string) => {
        violations.push(text);
      });
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          window.reportSecurityViolation?.(`${event.effectiveDirective}: ${event.blockedURI}`);
        });
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
        problems.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? ""})`);
      });

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
