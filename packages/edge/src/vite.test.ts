import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { cspHashSource, subresourceIntegrity } from "./integrity.ts";
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
    expect(headers).toContain("https://shkriuss.dev/*\n  X-Robots-Tag: noindex\n");
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

  it("turns module preloading off, so every chunk loads through the import map", async () => {
    const root = await createApp();
    // Two lazily loaded modules that share a third, which becomes a chunk of its own.
    await writeFile(path.join(root, "main.js"), 'import("./a.js"); import("./b.js");\n');
    await writeFile(path.join(root, "a.js"), 'export { shared as a } from "./shared.js";\n');
    await writeFile(path.join(root, "b.js"), 'export { shared as b } from "./shared.js";\n');
    await writeFile(path.join(root, "shared.js"), "export const shared = Math.random();\n");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [edge()],
      // The plugin overrides an app that asks for preloading.
      build: { modulePreload: { polyfill: true } },
    });
    const dist = path.join(root, "dist");
    const html = await readFile(path.join(dist, "index.html"), "utf8");
    const scripts = (await readdir(path.join(dist, "assets"))).filter((file) =>
      file.endsWith(".js"),
    );
    expect(scripts.some((file) => file.startsWith("shared-"))).toBe(true);

    expect(html).not.toContain("modulepreload");
    const entry = scripts.find((file) => file.startsWith("index-")) ?? "";
    // With preloading on, Vite lists the chunks to preload before each import() here.
    expect(await readFile(path.join(dist, "assets", entry), "utf8")).not.toContain(
      "__vite__mapDeps",
    );
    const importMap = /<script type="importmap">(.*?)<\/script>/.exec(html)?.[1] ?? "";
    for (const file of scripts) {
      expect(importMap).toContain(`"/assets/${file}":"sha384-`);
    }
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

  it("fails the build for an app that is not served from the root", async () => {
    const root = await createApp();
    await expect(buildApp(root, "/sub/")).rejects.toThrow(/"base" must be "\/"/);
  });
});
