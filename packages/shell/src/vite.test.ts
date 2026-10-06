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

  it("allows WebAssembly for an app that declares it, whose workers load modules (ADR 0014)", async () => {
    const root = await createApp();
    // add(a, b), in WebAssembly's binary format.
    await writeFile(
      path.join(root, "add.wasm"),
      Uint8Array.from([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f,
        0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
        0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
      ]),
    );
    await writeFile(
      path.join(root, "calc.worker.js"),
      'const url = new URL("./add.wasm", import.meta.url);\n' +
        "self.onmessage = async () => {\n" +
        "  const { instance } = await WebAssembly.instantiateStreaming(fetch(url));\n" +
        "  self.postMessage(instance.exports.add(2, 3));\n" +
        "};\n",
    );
    await writeFile(
      path.join(root, "main.js"),
      'import calc from "./calc.worker.js?worker&url";\nconsole.info(calc);\n',
    );
    const read = await buildApp(root, { ...NOTES, webAssembly: true });
    expect(await read("_headers")).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'sha256-/);
    // The service worker keeps the module, as every file, for offline use.
    expect(await read("sw.js")).toMatch(/"url":"\/assets\/add-[\w-]{8}\.wasm"/);
  });

  it("refuses to declare WebAssembly for an app that has none", async () => {
    await expect(buildApp(await createApp(), { ...NOTES, webAssembly: true })).rejects.toThrow(
      /declares webAssembly, but its build has no WebAssembly module/,
    );
  });

  it("builds an app without data only without the code of the packages that keep data", async () => {
    const root = await createApp();
    const withoutData = { ...NOTES, keepsData: false };
    await buildApp(root, withoutData);

    await writeFile(
      path.join(root, "main.js"),
      'import { openDatabase } from "@shkriuss/data";\nconsole.info(openDatabase);\n',
    );
    await expect(buildApp(root, withoutData)).rejects.toThrow(
      /The build has the code of @shkriuss\/data \(packages\/data\/src\/[\w/.-]+\), which this app excludes\./,
    );
    // An app with data, as most are, has it.
    await buildApp(root, NOTES);

    await writeFile(
      path.join(root, "main.js"),
      'import { generatePassphrase } from "@shkriuss/backup";\nconsole.info(generatePassphrase);\n',
    );
    await expect(buildApp(root, withoutData)).rejects.toThrow(
      / @shkriuss\/backup \(packages\/backup\/src\/[\w/.-]+\)/,
    );
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
