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
  // The packages of the backup worker, which Vite builds on its own.
  expect(licenses).toMatch(/^age-encryption \d+\.\d+\.\d+ \(BSD-3-Clause\)$/m);
  expect(licenses).toMatch(/^@noble\/ciphers \d+\.\d+\.\d+ \(MIT\)$/m);
  // The word list of generated passphrases, in a file of ours.
  expect(licenses).toContain("Material in packages/backup/src/words.ts");
  expect(licenses).toContain("BIP-39");
});
