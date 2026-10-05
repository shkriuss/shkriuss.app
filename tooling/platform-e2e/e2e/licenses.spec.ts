import { LICENSES_FILE } from "@shkriuss/edge";
import { expect, test } from "@shkriuss/config/playwright";

test("serves the licenses of the packages in its build, with their notices", async ({
  request,
}) => {
  const response = await request.get(`/${LICENSES_FILE}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  const licenses = await response.text();
  expect(licenses).toMatch(/^dexie \d+\.\d+\.\d+ \(Apache-2\.0\)$/m);
  expect(licenses).toContain("--- NOTICE ---");
  expect(licenses).toContain("Apache License");
});
