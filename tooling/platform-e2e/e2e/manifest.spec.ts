import { expect, test } from "@shkriuss/config/playwright";

// The web app manifest and the icons that webAppManifest() of @shkriuss/pwa writes for the test
// app, in real browsers, under the production security headers.

/** Each PNG icon and its size. */
const ICONS = [
  ["/icon-192.png", 192],
  ["/icon-512.png", 512],
  ["/icon-maskable-192.png", 192],
  ["/icon-maskable-512.png", 512],
  ["/icon-monochrome-512.png", 512],
  ["/apple-touch-icon.png", 180],
] as const;

test("the page links the manifest and the icons, which the browser loads under the CSP", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/favicon.svg");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/apple-touch-icon.png",
  );
  const served = await page.evaluate(async () => {
    const response = await fetch("/manifest.webmanifest");
    return {
      type: response.headers.get("content-type"),
      manifest: (await response.json()) as unknown,
    };
  });
  expect(served.type).toMatch(/^application\/manifest\+json/);
  expect(served.manifest).toMatchObject({
    id: "/",
    name: "Platform tests",
    short_name: "Platform",
    start_url: "/",
    scope: "/",
    display: "standalone",
  });

  // Each icon is an image that the browser decodes, at its size.
  const sizes = await page.evaluate(
    async (icons) =>
      Promise.all(
        [...icons.map(([src]) => src), "/favicon.svg"].map(async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          return [src, image.naturalWidth, image.naturalHeight];
        }),
      ),
    ICONS,
  );
  // An SVG without a width has no size of its own: browsers draw it square, at their default.
  const favicon = sizes.pop();
  expect(sizes).toStrictEqual(ICONS.map(([src, size]) => [src, size, size]));
  expect(favicon?.[1]).toBeGreaterThan(0);
  expect(favicon?.[1]).toBe(favicon?.[2]);
});

test("Chromium reads the manifest without errors, and finds the app installable", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Only Chromium reports how it reads the manifest.");
  await page.goto("/");
  const client = await page.context().newCDPSession(page);
  const { url, errors } = await client.send("Page.getAppManifest");
  expect(url).toBe(new URL("/manifest.webmanifest", page.url()).href);
  expect(errors).toStrictEqual([]);
  // The id that Chromium knows the installed app by, from the manifest's id: the app's root.
  const { appId } = await client.send("Page.getAppId");
  expect(appId).toBe(new URL("/", page.url()).href);
  const { installabilityErrors } = await client.send("Page.getInstallabilityErrors");
  // A test's browser context is like a private window, where Chromium installs nothing.
  expect(installabilityErrors.filter(({ errorId }) => errorId !== "in-incognito")).toStrictEqual(
    [],
  );
});
