import { createHash } from "node:crypto";
import { MANIFEST_FILE, parseManifest } from "@shkriuss/edge";
import { expect, test } from "./fixtures.ts";

test("publishes the SHA-256 of every file it serves", async ({ request }) => {
  const response = await request.get(`/${MANIFEST_FILE}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);

  const manifest = parseManifest(await response.text());
  expect([...manifest.keys()]).toContain("/index.html");
  expect([...manifest.keys()].some((file) => file.startsWith("/assets/"))).toBe(true);
  for (const [file, hash] of manifest) {
    const served = await request.get(file);
    expect(served.status(), file).toBe(200);
    expect(
      createHash("sha256")
        .update(await served.body())
        .digest("hex"),
      file,
    ).toBe(hash);
  }
});
