import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { edge, parseManifest } from "@shkriuss/edge";
import { build, type PluginOption } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodePng } from "./icons/test/decode.ts";
import { BUILD_DATA_PLACEHOLDER, precacheList } from "./script.ts";
import { pwa, webAppManifest } from "./vite.ts";

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

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * A tiny app with a lazily loaded module. It is in this package's directory, as apps are in the
 * repository, whose files the build's licenses cover: the service worker's code is among them.
 */
async function createApp(): Promise<string> {
  const root = await mkdtemp(path.join(import.meta.dirname, "..", ".test-build-"));
  roots.push(root);
  await writeFile(
    path.join(root, "index.html"),
    '<!doctype html><html lang="en"><head><title>Test</title>' +
      '<script type="module" src="/main.js"></script></head><body></body></html>',
  );
  await writeFile(
    path.join(root, "main.js"),
    'document.body.dataset["mode"] = SHKRIUSS_PWA_MODE;\nimport("./lazy.js");\n',
  );
  await writeFile(path.join(root, "lazy.js"), 'export const lazy = "lazy";\n');
  return root;
}

/** The files of this package whose code the service worker of `pwa(options)` includes. */
async function bundledFiles(options: Parameters<typeof pwa>[0]): Promise<string[]> {
  const bundle = await pwa(options).api?.bundle();
  return (bundle?.modules ?? [])
    .map((id) => path.relative(path.join(import.meta.dirname, ".."), id))
    .toSorted();
}

async function buildApp(root: string, plugins: PluginOption[]): Promise<string> {
  await build({ root, configFile: false, logLevel: "silent", plugins });
  return path.join(root, "dist");
}

describe("pwa", () => {
  it("writes /sw.js, one classic script with the version's data, after every other file", async () => {
    const dist = await buildApp(await createApp(), [pwa(), edge()]);
    const script = await readFile(path.join(dist, "sw.js"), "utf8");
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect(manifest.get("/sw.js")).toBe(hash(script));

    // A classic script: one function that runs at once, without imports or exports.
    expect(script).toMatch(/^\(function\(\)\{.*\}\)\(\);\s*$/s);
    expect(script).not.toMatch(/\bimport\b|\bexport\b/);
    expect(script).not.toContain(BUILD_DATA_PLACEHOLDER);

    const version = /"version":"([0-9a-f]{16})"/.exec(script)?.[1] ?? "";
    expect(script).toContain(
      JSON.stringify({ version, files: precacheList(manifest), replaces: [] }),
    );
    const unversioned = script.replace(`"version":"${version}"`, `"version":"${"0".repeat(16)}"`);
    expect(hash(unversioned).slice(0, 16)).toBe(version);
    // Every file the build serves, but /sw.js and security.txt, which changes with every commit.
    const urls = precacheList(manifest).map((file) => file.url);
    expect(urls).toEqual(expect.arrayContaining(["/", "/licenses.txt"]));
    expect(manifest.has("/.well-known/security.txt")).toBe(true);
    expect(urls).not.toContain("/.well-known/security.txt");
    expect(urls).toHaveLength(manifest.size - 2);

    expect(await readFile(path.join(dist, "_headers"), "utf8")).toContain(
      "; trusted-types shkriuss-workers\n",
    );
  });

  it("tells the page that this build serves the app", async () => {
    const dist = await buildApp(await createApp(), [pwa(), edge()]);
    const scripts = await readdir(path.join(dist, "assets"));
    const entry = scripts.find((file) => file.startsWith("index-")) ?? "";
    expect(await readFile(path.join(dist, "assets", entry), "utf8")).toMatch(/[`"]serve[`"]/);
  });

  it("lists the broken versions that the build replaces", async () => {
    const replaces = ["0123456789abcdef", "fedcba9876543210"];
    const dist = await buildApp(await createApp(), [pwa({ replaces }), edge()]);
    expect(await readFile(path.join(dist, "sw.js"), "utf8")).toContain(
      `"replaces":${JSON.stringify(replaces)}`,
    );
  });

  it("writes a /sw.js that removes the service worker in a build that turns it off", async () => {
    const root = await createApp();
    const dist = await buildApp(root, [pwa({ remove: true }), edge()]);
    const script = await readFile(path.join(dist, "sw.js"), "utf8");
    expect(script).toContain("unregister");
    expect(script).not.toContain('"version"');
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect(manifest.get("/sw.js")).toBe(hash(script));
    const scripts = await readdir(path.join(dist, "assets"));
    const entry = scripts.find((file) => file.startsWith("index-")) ?? "";
    expect(await readFile(path.join(dist, "assets", entry), "utf8")).toMatch(/[`"]remove[`"]/);
  });

  it("gives the same /sw.js for the same app", async () => {
    const first = await buildApp(await createApp(), [pwa(), edge()]);
    const second = await buildApp(await createApp(), [pwa(), edge()]);
    expect(await readFile(path.join(second, "sw.js"), "utf8")).toBe(
      await readFile(path.join(first, "sw.js"), "utf8"),
    );
  });

  it("reports the modules whose code each service worker includes, for licenses.txt", async () => {
    expect(await bundledFiles({})).toStrictEqual([
      "src/protocol.ts",
      "worker/sw.ts",
      "worker/worker.ts",
    ]);
    const removal = await bundledFiles({ remove: true });
    expect(removal).toEqual(expect.arrayContaining(["worker/remove.ts", "worker/worker.ts"]));
    expect(removal).not.toContain("worker/sw.ts");
  });

  it("fails the build without edge(), which writes /sw.js", async () => {
    await expect(buildApp(await createApp(), [pwa()])).rejects.toThrow("pwa() needs edge()");
  });

  it("fails the build when the app has a /sw.js of its own", async () => {
    const root = await createApp();
    await mkdir(path.join(root, "public"));
    await writeFile(path.join(root, "public", "sw.js"), "self.oninstall = () => {};\n");
    await expect(buildApp(root, [pwa(), edge()])).rejects.toThrow("already has /sw.js");
  });

  it.each([
    ["a replaced version that is no version id", { replaces: ["the broken one"] }, "version id"],
    [
      "a build that both removes and replaces",
      { remove: true, replaces: ["0123456789abcdef"] },
      "replaces no version",
    ],
  ])("refuses %s", (_case, options, message) => {
    expect(() => pwa(options)).toThrow(message);
  });
});

describe("webAppManifest", () => {
  const options = {
    name: "Notes",
    description: "Notes that stay on this device.",
    accent: "#1d4ed8",
    icon: { size: 24, paths: [{ d: "M4 4H20V20H4Z" }] },
  };

  it("writes the manifest and the icons, links them from the page, and lists their hashes", async () => {
    const dist = await buildApp(await createApp(), [webAppManifest(options), edge()]);
    const manifest: unknown = JSON.parse(
      await readFile(path.join(dist, "manifest.webmanifest"), "utf8"),
    );
    expect(manifest).toMatchObject({ id: "/", name: "Notes", display: "standalone" });
    for (const [file, size] of [
      ["icon-192.png", 192],
      ["icon-512.png", 512],
      ["icon-maskable-192.png", 192],
      ["icon-maskable-512.png", 512],
      ["icon-monochrome-512.png", 512],
      ["apple-touch-icon.png", 180],
    ] as const) {
      const { width } = decodePng(await readFile(path.join(dist, file)));
      expect({ file, width }).toStrictEqual({ file, width: size });
    }
    expect(await readFile(path.join(dist, "favicon.svg"), "utf8")).toMatch(/^<svg /);

    const html = await readFile(path.join(dist, "index.html"), "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png">');
    expect(html).toContain(
      '<meta name="theme-color" content="#f3f4f6" media="(prefers-color-scheme: light)">',
    );
    expect(html).toContain(
      '<meta name="theme-color" content="#1f2937" media="(prefers-color-scheme: dark)">',
    );

    // The published hashes cover them, and so the service worker's precache list would too.
    const hashes = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect([...hashes.keys()]).toEqual(
      expect.arrayContaining(["/manifest.webmanifest", "/icon-512.png", "/favicon.svg"]),
    );
  });

  it("fails the build when public/ has a file of the same name", async () => {
    const root = await createApp();
    await mkdir(path.join(root, "public"));
    await writeFile(path.join(root, "public", "favicon.svg"), "<svg/>");
    await expect(buildApp(root, [webAppManifest(options), edge()])).rejects.toThrow(
      "public/favicon.svg would take the place",
    );
  });

  it("refuses options that make no manifest, when the configuration is read", () => {
    expect(() => webAppManifest({ ...options, name: "" })).toThrow("needs a name");
  });
});
