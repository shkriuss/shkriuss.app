import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { cspHashSource, subresourceIntegrity } from "./integrity.ts";
import { parseManifest } from "./manifest.ts";
import { edge, type EdgeOptions } from "./vite.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A tiny app with an entry script, a lazily loaded module and a stylesheet. */
async function createApp(indexHtml?: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "shkriuss-edge-"));
  roots.push(root);
  const html =
    indexHtml ??
    '<!doctype html><html lang="en"><head><title>Test</title>' +
      '<script type="module" src="/main.js"></script></head><body></body></html>';
  await writeFile(path.join(root, "index.html"), html);
  await writeFile(
    path.join(root, "main.js"),
    'import "./style.css";\nimport("./lazy.js").then((lazy) => lazy.run());\n',
  );
  await writeFile(
    path.join(root, "lazy.js"),
    'export function run() { document.title = "ran"; }\n',
  );
  await writeFile(path.join(root, "style.css"), "body { margin: 0; }\n");
  return root;
}

async function buildApp(root: string, base = "/", options: EdgeOptions = {}): Promise<void> {
  await build({
    root,
    base,
    configFile: false,
    logLevel: "silent",
    plugins: [edge(options)],
  });
}

describe("edge", () => {
  it("adds a hash for every built script and allows the import map by its hash", async () => {
    const root = await createApp();
    await buildApp(root);
    const dist = path.join(root, "dist");
    const html = await readFile(path.join(dist, "index.html"), "utf8");
    const importMap = /<script type="importmap">(.*?)<\/script>/.exec(html)?.[1] ?? "";

    const scripts = (await readdir(path.join(dist, "assets"))).filter((file) =>
      file.endsWith(".js"),
    );
    expect(scripts).toHaveLength(2);
    for (const file of scripts) {
      const hash = subresourceIntegrity(await readFile(path.join(dist, "assets", file)));
      expect(importMap).toContain(`"/assets/${file}":"${hash}"`);
    }
    expect(html).toMatch(
      /<script type="module" crossorigin src="\/assets\/[^"]+\.js" integrity="sha384-/,
    );
    expect(html).toMatch(/<link rel="stylesheet" crossorigin href="[^"]+\.css" integrity="sha384-/);

    const headers = await readFile(path.join(dist, "_headers"), "utf8");
    expect(headers).toContain(`script-src 'self' ${cspHashSource(importMap)};`);
    expect(headers).toContain("Integrity-Policy: blocked-destinations=(script)");
    // Without worker scripts, no Trusted Types policy at all.
    expect(headers).toContain("; trusted-types 'none'\n");
    expect(headers).toContain("https://shkriuss.dev/*\n  X-Robots-Tag: noindex\n");

    // The manifest covers the final files, after the plugin changed index.html.
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect([...manifest.keys()]).toEqual(
      [...scripts.map((file) => `/assets/${file}`), "/index.html"]
        .concat(
          (await readdir(path.join(dist, "assets")))
            .filter((file) => file.endsWith(".css"))
            .map((file) => `/assets/${file}`),
        )
        .toSorted(),
    );
    expect(manifest.get("/index.html")).toBe(createHash("sha256").update(html).digest("hex"));
  });

  it("marks an app's own staging host as not for search engines", async () => {
    const root = await createApp();
    await buildApp(root, "/", { appId: "notes", allowedFeatures: ["camera"] });
    const headers = await readFile(path.join(root, "dist", "_headers"), "utf8");
    expect(headers).toContain("https://notes.shkriuss.dev/*\n  X-Robots-Tag: noindex\n");
    expect(headers).toContain("camera=(self)");
  });

  it("refuses an invalid app id before building", () => {
    expect(() => edge({ appId: "www" })).toThrow(/reserved/);
  });

  it("lets a lazily loaded chunk import the entry script, and preloads nothing", async () => {
    const root = await createApp();
    // Code that both import ends up in the entry chunk, which the page has already loaded.
    await writeFile(path.join(root, "shared.js"), "export const shared = Math.random();\n");
    await writeFile(
      path.join(root, "main.js"),
      'import { shared } from "./shared.js";\nconsole.info(shared);\nimport("./lazy.js").then((lazy) => lazy.run());\n',
    );
    await writeFile(
      path.join(root, "lazy.js"),
      'import { shared } from "./shared.js";\nexport function run() { return shared; }\n',
    );
    // The plugin overrides an app that asks for preloading.
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [edge()],
      build: { modulePreload: { polyfill: true } },
    });
    const dist = path.join(root, "dist");
    const scripts = (await readdir(path.join(dist, "assets"))).filter((file) =>
      file.endsWith(".js"),
    );
    const entry = scripts.find((file) => file.startsWith("index-")) ?? "";
    const lazy = scripts.find((file) => file.startsWith("lazy-")) ?? "";
    expect(await readFile(path.join(dist, "assets", lazy), "utf8")).toContain(`./${entry}`);
    const html = await readFile(path.join(dist, "index.html"), "utf8");
    expect(html).not.toContain("modulepreload");
    expect(await readFile(path.join(dist, "assets", entry), "utf8")).not.toContain(
      "__vite__mapDeps",
    );
  });

  it("fails the build when a chunk imports a chunk other than the entry statically", async () => {
    const root = await createApp();
    // Two lazily loaded modules that share a third, which becomes a chunk of its own.
    await writeFile(path.join(root, "main.js"), 'import("./a.js"); import("./b.js");\n');
    await writeFile(path.join(root, "a.js"), 'export { shared as a } from "./shared.js";\n');
    await writeFile(path.join(root, "b.js"), 'export { shared as b } from "./shared.js";\n');
    await writeFile(path.join(root, "shared.js"), "export const shared = Math.random();\n");
    await expect(buildApp(root)).rejects.toThrow(/Safari would refuse to load it/);
  });

  it("puts all CSS in one stylesheet that the page loads with its hash", async () => {
    const root = await createApp();
    await writeFile(path.join(root, "lazy.js"), 'import "./lazy.css";\nexport function run() {}\n');
    await writeFile(path.join(root, "lazy.css"), "p { color: red; }\n");
    await buildApp(root);
    const dist = path.join(root, "dist");
    const stylesheets = (await readdir(path.join(dist, "assets"))).filter((file) =>
      file.endsWith(".css"),
    );
    expect(stylesheets).toHaveLength(1);
    const html = await readFile(path.join(dist, "index.html"), "utf8");
    expect(html).toContain(`href="/assets/${stylesheets[0] ?? ""}" integrity="sha384-`);
    for (const file of await readdir(path.join(dist, "assets"))) {
      expect(await readFile(path.join(dist, "assets", file), "utf8")).not.toContain(
        "__vite__mapDeps",
      );
    }
  });

  it("produces identical files when nothing changed", async () => {
    const first = await createApp();
    const second = await createApp();
    await buildApp(first);
    await buildApp(second);
    for (const file of ["index.html", "_headers"]) {
      expect(await readFile(path.join(second, "dist", file), "utf8")).toBe(
        await readFile(path.join(first, "dist", file), "utf8"),
      );
    }
  });

  it("fails the build for an inline script", async () => {
    const root = await createApp(
      "<!doctype html><html><head><title>Test</title><script>alert(1)</script>" +
        '<script type="module" src="/main.js"></script></head><body></body></html>',
    );
    await expect(buildApp(root)).rejects.toThrow(/inline <script>/);
  });

  it("builds each worker into one file and allows the policy that starts it", async () => {
    const root = await createApp();
    await writeFile(
      path.join(root, "main.js"),
      'import ping from "./ping.worker.js?worker&url";\nconsole.info(ping);\nimport("./lazy.js");\n',
    );
    // A dynamic import in a worker would need a chunk of its own, which a worker cannot check.
    await writeFile(
      path.join(root, "ping.worker.js"),
      'self.onmessage = () => import("./lazy.js").then((lazy) => self.postMessage(lazy.run));\n',
    );
    // The plugin overrides an app that asks for workers with chunks.
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [edge()],
      worker: { format: "es" },
    });
    const dist = path.join(root, "dist");
    const assets = await readdir(path.join(dist, "assets"));
    const workers = assets.filter((file) => file.includes(".worker-"));
    expect(workers).toEqual([expect.stringMatching(/^ping\.worker-[A-Za-z0-9_-]{8}\.js$/)]);
    const worker = await readFile(path.join(dist, "assets", workers[0] ?? ""), "utf8");
    expect(worker).not.toMatch(/\bimport\b/);
    // The page's scripts: the entry and the lazily loaded chunk, but not the worker.
    expect(assets.filter((file) => file.endsWith(".js"))).toHaveLength(3);

    const html = await readFile(path.join(dist, "index.html"), "utf8");
    const importMap = /<script type="importmap">(.*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(importMap).toMatch(
      /^\{"integrity":\{"\/assets\/index-[^"]+":"[^"]+","\/assets\/lazy-[^"]+":"[^"]+"\}\}$/,
    );

    const headers = await readFile(path.join(dist, "_headers"), "utf8");
    expect(headers).toContain("; trusted-types shkriuss-workers\n");
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect(manifest.has(`/assets/${workers[0] ?? ""}`)).toBe(true);
  });

  it("allows the policy for a service worker at /sw.js", async () => {
    const root = await createApp();
    await mkdir(path.join(root, "public"));
    await writeFile(path.join(root, "public", "sw.js"), "self.oninstall = () => {};\n");
    await buildApp(root);
    const dist = path.join(root, "dist");
    expect(await readFile(path.join(dist, "_headers"), "utf8")).toContain(
      "; trusted-types shkriuss-workers\n",
    );
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect(manifest.has("/sw.js")).toBe(true);
  });

  it("leaves a service worker built from source out of the import map", async () => {
    const root = await createApp();
    await writeFile(path.join(root, "sw.js"), "self.oninstall = () => {};\n");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "service-worker",
          buildStart() {
            this.emitFile({ type: "chunk", id: path.join(root, "sw.js"), fileName: "sw.js" });
          },
        },
        edge(),
      ],
    });
    const dist = path.join(root, "dist");
    const html = await readFile(path.join(dist, "index.html"), "utf8");
    expect(html).toContain('<script type="importmap">{"integrity":{"/assets/index-');
    expect(html).not.toContain("/sw.js");
    expect(await readFile(path.join(dist, "_headers"), "utf8")).toContain(
      "; trusted-types shkriuss-workers\n",
    );
  });

  it.each([
    ["a worker whose name the policy would refuse", "./ping-worker.js?worker&url"],
    ["a script file that is not a worker", "./ping-worker.js?url"],
  ])("fails the build for %s", async (_case, specifier) => {
    const root = await createApp();
    await writeFile(
      path.join(root, "main.js"),
      `import url from "${specifier}";\nconsole.info(url);\n`,
    );
    // Larger than 4 KiB, so that Vite does not inline a ?url import as a data: URL.
    await writeFile(
      path.join(root, "ping-worker.js"),
      `self.onmessage = () => {};\n${"// padding\n".repeat(400)}`,
    );
    await expect(buildApp(root)).rejects.toThrow(/not named "<name>\.worker-<hash>\.js"/);
  });

  it("fails the build for a worker module that the page imports as a module", async () => {
    const root = await createApp();
    await writeFile(path.join(root, "main.js"), 'import("./ping.worker.js");\n');
    await writeFile(path.join(root, "ping.worker.js"), "export const ping = 1;\n");
    await expect(buildApp(root)).rejects.toThrow(/named like a worker bundle but is not one/);
  });

  it("fails the build for an app that is not served from the root", async () => {
    const root = await createApp();
    await expect(buildApp(root, "/sub/")).rejects.toThrow(/"base" must be "\/"/);
  });
});
