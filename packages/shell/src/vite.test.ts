import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppConfig, app } from "./vite.ts";

const roots: string[] = [];

// The builds run outside a git checkout: edge() takes their commit's date, for security.txt,
// from here.
beforeEach(() => {
  vi.stubEnv("SOURCE_DATE_EPOCH", "1791104400");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const NOTES: AppConfig = {
  id: "notes",
  name: "Notes & lists <beta>",
  shortName: "Notes",
  description: 'Notes that stay on this "device".',
  accent: "#1d4ed8",
  icon: { size: 24, paths: [{ d: "M4 4h16v16H4Z" }] },
};

/**
 * A tiny app, in this package's directory, as apps are in the repository, whose files the
 * build's licenses cover. Its page has no title of its own: the app's comes from its config.
 */
async function createApp(): Promise<string> {
  const root = await mkdtemp(path.join(import.meta.dirname, "..", ".test-build-"));
  roots.push(root);
  await writeFile(
    path.join(root, "index.html"),
    '<!doctype html><html lang="en"><head><meta charset="utf-8" />' +
      '<script type="module" src="/main.js"></script></head><body></body></html>',
  );
  await writeFile(path.join(root, "main.js"), 'document.body.dataset["started"] = "yes";\n');
  return root;
}

/** Builds the app at `root` as `app(...options)` configures it, and returns what it wrote. */
async function buildApp(
  root: string,
  ...options: Parameters<typeof app>
): Promise<(file: string) => Promise<string>> {
  await build({ ...app(...options), root, configFile: false, logLevel: "silent" });
  return async (file) => readFile(path.join(root, "dist", file), "utf8");
}

describe("app", () => {
  it("titles and describes the page with the app's name and description", async () => {
    const read = await buildApp(await createApp(), NOTES);
    const page = await read("index.html");
    expect(page).toContain("<title>Notes &amp; lists &lt;beta></title>");
    expect(page).toContain(
      '<meta name="description" content="Notes that stay on this &quot;device&quot;.">',
    );
    // After the declaration of the page's character encoding, which comes first.
    expect(page.indexOf("<title>")).toBeGreaterThan(page.indexOf('<meta charset="utf-8"'));
  });

  it("writes the manifest and the icons, the service worker, and the security headers", async () => {
    const read = await buildApp(await createApp(), NOTES);
    expect(JSON.parse(await read("manifest.webmanifest"))).toMatchObject({
      name: "Notes & lists <beta>",
      short_name: "Notes",
      id: "/",
    });
    expect(await read("index.html")).toContain(
      '<link rel="manifest" href="/manifest.webmanifest">',
    );
    // The service worker lists every file, so the security headers are written after it.
    const serviceWorker = await read("sw.js");
    const headers = await read("_headers");
    expect(serviceWorker).toContain('"url":"/manifest.webmanifest"');
    expect(headers).toContain("trusted-types shkriuss-workers");
    // The app's own staging host, which search engines must not index.
    expect(headers).toContain("https://notes.shkriuss.dev/*\n  X-Robots-Tag: noindex");
    // Every browser feature denied.
    expect(headers).toContain(" camera=(),");
  });

  it("allows the browser features that the app needs, and only those", async () => {
    const read = await buildApp(await createApp(), { ...NOTES, allowedFeatures: ["camera"] });
    const headers = await read("_headers");
    expect(headers).toContain(" camera=(self),");
    expect(headers).toContain(" microphone=(),");
  });

  it("passes the service worker's procedures of last resort on", async () => {
    const read = await buildApp(await createApp(), NOTES, {
      serviceWorker: { replaces: ["0123456789abcdef"] },
    });
    expect(await read("sw.js")).toContain('"replaces":["0123456789abcdef"]');
  });

  it("refuses an id that cannot be an app's, before anything is built", () => {
    expect(() => app({ ...NOTES, id: "Notes" })).toThrow('"Notes" is not a valid app id');
    expect(() => app({ ...NOTES, id: "www" })).toThrow('"www" is reserved');
  });
});
