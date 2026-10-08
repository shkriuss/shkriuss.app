import type { Request } from "@playwright/test";
import { expect, test } from "@shkriuss/config/playwright";

// The fixture that fails a test on any problem that the browser reports, which every app's
// end-to-end tests share. Chromium is the browser that reports a cancelled request as failed,
// in words of its own.

test("a request that a navigation of the page cancels is no problem", async ({
  page,
  network,
  security,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "The rule is for Chromium's words.");
  const held = network.hold("/held.txt");
  await page.goto(network.url);
  await page.evaluate(() => {
    fetch("/held.txt").catch(() => undefined);
  });
  await held.arrived;
  const failed: Request[] = [];
  page.on("requestfailed", (request) => {
    failed.push(request);
  });
  await page.reload();
  // Chromium 141, as in cloud sessions, reports the cancelled request as failed before the new
  // page loads; the Chromium of CI's Playwright reported nothing within 30 seconds. Either way,
  // it is no problem. Without the fixture's rule, Chromium 141 fails the test.
  for (const request of failed) {
    expect(request.failure()?.errorText).toBe("net::ERR_ABORTED");
  }
  expect(security.problems).toEqual([]);
});

test("a request that the page stops is still a problem", async ({
  page,
  network,
  security,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "The rule is for Chromium's words.");
  // This test checks the problem itself.
  security.expectRefusals();
  const held = network.hold("/held.txt");
  await page.goto(network.url);
  const controller = await page.evaluateHandle(() => {
    const stop = new AbortController();
    fetch("/held.txt", { signal: stop.signal }).catch(() => undefined);
    return stop;
  });
  await held.arrived;
  const failed = page.waitForEvent("requestfailed");
  await controller.evaluate((stop) => {
    stop.abort();
  });
  await failed;
  expect(security.problems).toEqual([
    `request failed: ${new URL("/held.txt", network.url).href} (net::ERR_ABORTED)`,
  ]);
});
