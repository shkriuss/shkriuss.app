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
    build: { modulePreload: { polyfill: false } },
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
