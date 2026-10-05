import { createHash } from "node:crypto";
import { LICENSES_FILE, MANIFEST_FILE, SOURCE_URL, parseManifest } from "@shkriuss/edge";
import { expect, test } from "@shkriuss/config/playwright";

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

test("serves the licenses of the software it includes, and links them", async ({
  page,
  request,
}) => {
  const response = await request.get(`/${LICENSES_FILE}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/plain/);
  const licenses = await response.text();
  expect(licenses).toMatch(/^Licenses of shkriuss\.app\n/);
  expect(licenses).toContain(SOURCE_URL);
  expect(licenses).toMatch(/^react \d+\.\d+\.\d+ \(MIT\)$/m);
  expect(licenses).toMatch(/^react-dom \d+\.\d+\.\d+ \(MIT\)$/m);
  // Its stylesheet inlines Tailwind CSS, which no script imports.
  expect(licenses).toMatch(/^tailwindcss \d+\.\d+\.\d+ \(MIT\)$/m);

  await page.goto("/");
  await expect(page.getByRole("link", { name: LICENSES_FILE })).toHaveAttribute(
    "href",
    `/${LICENSES_FILE}`,
  );
});
