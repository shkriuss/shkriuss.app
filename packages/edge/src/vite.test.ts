import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, type Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Header } from "./headers.ts";
import { cspHashSource, subresourceIntegrity } from "./integrity.ts";
import { parseManifest } from "./manifest.ts";
import { securityTxt } from "./security-txt.ts";
import { SERVICE_WORKER_PLUGIN, type ServiceWorkerApi } from "./service-worker.ts";
import { edge, type EdgeOptions } from "./vite.ts";

const roots: string[] = [];

/** When the builds' commit was made, for their security.txt: they run outside a git checkout. */
const COMMITTED = 1_791_104_400;

beforeEach(() => {
  vi.stubEnv("SOURCE_DATE_EPOCH", String(COMMITTED));
});

afterEach(async () => {
  vi.unstubAllEnvs();
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

/**
 * A stand-in for pwa() of @shkriuss/pwa/vite: its script lists the files it was given, and its
 * bundle includes `modules`. It adds the headers that it was given to `headers`.
 */
function serviceWorker(
  modules: readonly string[] = [],
  headers: (readonly Header[])[] = [],
): Plugin<ServiceWorkerApi> {
  return {
    name: SERVICE_WORKER_PLUGIN,
    api: {
      bundle: async () => ({
        modules,
        script: (files, given) => {
          headers.push(given);
          return `self.files = ${JSON.stringify(Object.fromEntries(files))};\n`;
        },
      }),
    },
  };
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
    // A year of caching for each file in /assets/ by its exact path, and UTF-8 for text files.
    expect(headers).not.toContain("/assets/*");
    for (const file of await readdir(path.join(dist, "assets"))) {
      expect(headers).toContain(
        `\n/assets/${file}\n  Cache-Control: public, max-age=31536000, immutable\n`,
      );
    }
    for (const file of ["/.well-known/security.txt", "/licenses.txt", "/sha256sums.txt"]) {
      expect(headers).toContain(`\n${file}\n  Content-Type: text/plain; charset=utf-8\n`);
    }

    // The manifest covers the final files, after the plugin changed index.html.
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect([...manifest.keys()]).toEqual(
      [
        ...scripts.map((file) => `/assets/${file}`),
        "/.well-known/security.txt",
        "/index.html",
        "/licenses.txt",
      ]
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

  describe("WebAssembly (ADR 0014)", () => {
    /** A module with one function, add(a, b), in the binary format: 41 bytes. */
    const ADD_MODULE = Uint8Array.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f,
      0x01, 0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
      0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
    ]);

    /** An app whose worker loads add.wasm, and whose page refers to the module if asked. */
    async function createWebAssemblyApp(pageLoadsModule = false): Promise<string> {
      const root = await createApp();
      await writeFile(path.join(root, "add.wasm"), ADD_MODULE);
      await writeFile(
        path.join(root, "main.js"),
        'import calc from "./calc.worker.js?worker&url";\nconsole.info(calc);\n' +
          (pageLoadsModule ? 'console.info(new URL("./add.wasm", import.meta.url).href);\n' : ""),
      );
      await writeFile(
        path.join(root, "calc.worker.js"),
        'const url = new URL("./add.wasm", import.meta.url);\n' +
          "self.onmessage = async () => {\n" +
          "  const { instance } = await WebAssembly.instantiateStreaming(fetch(url));\n" +
          "  self.postMessage(instance.exports.add(2, 3));\n" +
          "};\n",
      );
      return root;
    }

    it("builds a worker's module as a file of its own and allows it for an app that declares it", async () => {
      const root = await createWebAssemblyApp();
      await buildApp(root, "/", { webAssembly: true });
      const dist = path.join(root, "dist");
      const assets = await readdir(path.join(dist, "assets"));
      // A module of 41 bytes stays a file, which Vite would otherwise inline as a data: URL.
      const modules = assets.filter((file) => file.endsWith(".wasm"));
      expect(modules).toEqual([expect.stringMatching(/^add-[A-Za-z0-9_-]{8}\.wasm$/)]);
      const module = modules[0] ?? "";
      expect(new Uint8Array(await readFile(path.join(dist, "assets", module)))).toEqual(ADD_MODULE);
      const worker = assets.find((file) => file.startsWith("calc.worker-")) ?? "";
      expect(await readFile(path.join(dist, "assets", worker), "utf8")).toContain(module);

      const headers = await readFile(path.join(dist, "_headers"), "utf8");
      expect(headers).toMatch(/script-src 'self' 'wasm-unsafe-eval' 'sha256-[^']+'; /);
      const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
      expect(manifest.has(`/assets/${module}`)).toBe(true);
    });

    it("leaves WebAssembly out of the policy of an app without it", async () => {
      const root = await createApp();
      await buildApp(root);
      const headers = await readFile(path.join(root, "dist", "_headers"), "utf8");
      expect(headers).toContain("Content-Security-Policy: default-src 'none'; script-src 'self' ");
      expect(headers).not.toContain("wasm-unsafe-eval");
    });

    it("fails the build for a module in an app that does not declare WebAssembly", async () => {
      const root = await createWebAssemblyApp();
      await expect(buildApp(root)).rejects.toThrow(
        /has WebAssembly \(\/assets\/add-[\w-]{8}\.wasm\), which only an app that declares webAssembly/,
      );
    });

    it("fails the build for an app that declares WebAssembly without a module", async () => {
      const root = await createApp();
      await expect(buildApp(root, "/", { webAssembly: true })).rejects.toThrow(
        /declares webAssembly, but its build has no WebAssembly module/,
      );
    });

    it("fails the build when a script of the page refers to a module", async () => {
      const root = await createWebAssemblyApp(true);
      await expect(buildApp(root, "/", { webAssembly: true })).rejects.toThrow(
        /assets\/index-[\w-]{8}\.js refers to \/assets\/add-[\w-]{8}\.wasm, but only workers load WebAssembly/,
      );
    });
  });

  it("writes the licenses of the code in the page and its workers", async () => {
    const root = await createApp();
    const library = path.join(root, "node_modules", "fake-library");
    await mkdir(path.join(library, "dist"), { recursive: true });
    await writeFile(
      path.join(library, "package.json"),
      '{"name": "fake-library", "version": "1.2.3", "license": "MIT", "main": "dist/index.js"}',
    );
    // A package.json without a name, such as some packages put into their builds.
    await writeFile(path.join(library, "dist", "package.json"), '{"type": "module"}');
    await writeFile(path.join(library, "dist", "index.js"), "export const greet = () => 'hi';\n");
    await writeFile(path.join(library, "LICENSE"), "MIT License\r\nCopyright (c) Fake\r\n");
    await writeFile(path.join(library, "NOTICE"), "A notice of Fake.\n");
    const unused = path.join(root, "node_modules", "unused-library");
    await mkdir(unused, { recursive: true });
    await writeFile(
      path.join(unused, "package.json"),
      '{"name": "unused-library", "version": "1.0.0"}',
    );
    await writeFile(path.join(unused, "index.js"), "export const unused = () => 0;\n");
    await writeFile(
      path.join(root, "vendored.js"),
      "/*! Words from Elsewhere, under the MIT License. */\nexport const words = ['a'];\n",
    );
    await writeFile(
      path.join(root, "helper.js"),
      "/*!\n * Worker material,\n * under CC0.\n */\nexport const help = () => 1;\n",
    );
    await writeFile(
      path.join(root, "tick.worker.js"),
      'import { help } from "./helper.js";\nself.onmessage = () => self.postMessage(help());\n',
    );
    await writeFile(
      path.join(root, "main.js"),
      [
        'import { greet } from "fake-library";',
        'import { unused } from "unused-library";',
        'import { words } from "./vendored.js";',
        'import tick from "./tick.worker.js?worker&url";',
        "console.info(greet(), words, tick);",
        "",
      ].join("\n"),
    );
    await buildApp(root, "/", { appId: "notes" });
    const dist = path.join(root, "dist");
    const licenses = await readFile(path.join(dist, "licenses.txt"), "utf8");
    expect(licenses).toMatch(
      /^Licenses of notes\.shkriuss\.app\n\nnotes\.shkriuss\.app is free software under the GNU Affero/,
    );
    expect(licenses).toContain("https://github.com/shkriuss/shkriuss.app");
    expect(licenses).toContain(
      "fake-library 1.2.3 (MIT)\n" +
        "=".repeat(80) +
        "\n\n--- LICENSE ---\n\nMIT License\nCopyright (c) Fake\n\n--- NOTICE ---\n\nA notice of Fake.\n",
    );
    expect(licenses).toContain(
      "Material in vendored.js\n" +
        "=".repeat(80) +
        "\n\nWords from Elsewhere, under the MIT License.",
    );
    expect(licenses).toContain(
      "Material in helper.js\n" + "=".repeat(80) + "\n\nWorker material,\nunder CC0.\n",
    );
    // Tree-shaking removed every line of it, so none of its code is served.
    expect(licenses).not.toContain("unused-library");
    expect(licenses).not.toContain("unused");
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect(manifest.get("/licenses.txt")).toBe(createHash("sha256").update(licenses).digest("hex"));
  });

  it("fails the build for a package without a license file", async () => {
    const root = await createApp();
    const library = path.join(root, "node_modules", "unlicensed");
    await mkdir(library, { recursive: true });
    await writeFile(
      path.join(library, "package.json"),
      '{"name": "unlicensed", "version": "0.1.0"}',
    );
    await writeFile(path.join(library, "index.js"), "export const value = () => Math.random();\n");
    await writeFile(
      path.join(root, "main.js"),
      'import { value } from "unlicensed";\nconsole.info(value());\n',
    );
    await expect(buildApp(root)).rejects.toThrow(/unlicensed@0\.1\.0 has no license file/);
  });

  it("leaves out a worker whose module tree-shaking removed, and its licenses", async () => {
    const root = await createApp();
    const library = path.join(root, "node_modules", "worker-library");
    await mkdir(library, { recursive: true });
    await writeFile(
      path.join(library, "package.json"),
      '{"name": "worker-library", "version": "1.0.0", "license": "MIT"}',
    );
    await writeFile(path.join(library, "LICENSE"), "MIT License\n");
    await writeFile(path.join(library, "index.js"), "export const work = (value) => value * 2;\n");
    await writeFile(
      path.join(root, "work.worker.js"),
      'import { work } from "worker-library";\nself.onmessage = (event) => self.postMessage(work(event.data));\n',
    );
    // Vite builds the worker, as a module refers to it, but nothing uses that module.
    await writeFile(
      path.join(root, "unused.js"),
      'import work from "./work.worker.js?worker&url";\nexport const start = () => new Worker(work);\n',
    );
    await writeFile(
      path.join(root, "main.js"),
      'import { start } from "./unused.js";\nconsole.info("no worker");\n',
    );
    await buildApp(root, "/", { excludedPackages: ["worker-library"] });
    const dist = path.join(root, "dist");
    expect(await readdir(path.join(dist, "assets"))).not.toContainEqual(
      expect.stringMatching(/^work\.worker-/),
    );
    expect(await readFile(path.join(dist, "licenses.txt"), "utf8")).not.toContain("worker-library");
  });

  it("fails the build if the page, a worker or the service worker has a package that the app excludes", async () => {
    const root = await createApp();
    const store = path.join(root, "node_modules", "fake-store");
    await mkdir(store, { recursive: true });
    await writeFile(
      path.join(store, "package.json"),
      '{"name": "fake-store", "version": "1.0.0", "license": "MIT"}',
    );
    await writeFile(path.join(store, "LICENSE"), "MIT License\n");
    await writeFile(
      path.join(store, "index.js"),
      "export const keep = (value) => [value];\nexport const unused = () => 0;\n",
    );
    const excluding: EdgeOptions = { excludedPackages: ["fake-store"] };
    const refused =
      "The build has the code of fake-store (node_modules/fake-store/index.js), which this app excludes.";

    // Imported, but tree-shaking removed every line of it: none of its code is in the build.
    await writeFile(
      path.join(root, "main.js"),
      'import { unused } from "fake-store";\nconsole.info("nothing kept");\n',
    );
    await buildApp(root, "/", excluding);

    await writeFile(
      path.join(root, "main.js"),
      'import { keep } from "fake-store";\nconsole.info(keep(1));\n',
    );
    await expect(buildApp(root, "/", excluding)).rejects.toThrow(refused);

    await writeFile(
      path.join(root, "store.worker.js"),
      'import { keep } from "fake-store";\nself.onmessage = (event) => self.postMessage(keep(event.data));\n',
    );
    await writeFile(
      path.join(root, "main.js"),
      'import store from "./store.worker.js?worker&url";\nconsole.info(store);\n',
    );
    await expect(buildApp(root, "/", excluding)).rejects.toThrow(refused);

    await writeFile(path.join(root, "main.js"), 'console.info("nothing kept");\n');
    await expect(
      build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [serviceWorker([path.join(store, "index.js")]), edge(excluding)],
      }),
    ).rejects.toThrow(refused);
    // An app that excludes nothing may have it.
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [serviceWorker([path.join(store, "index.js")]), edge()],
    });
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

  it("writes the service worker last, with the hashes of every other file as served", async () => {
    const root = await createApp();
    // A package of others in the service worker's bundle.
    const library = path.join(root, "node_modules", "offline-library");
    await mkdir(library, { recursive: true });
    await writeFile(
      path.join(library, "package.json"),
      '{"name": "offline-library", "version": "2.0.0", "license": "MIT"}',
    );
    await writeFile(path.join(library, "index.js"), "export const offline = true;\n");
    await writeFile(path.join(library, "LICENSE"), "MIT License\n");
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [serviceWorker([path.join(library, "index.js")]), edge()],
    });
    const dist = path.join(root, "dist");
    const script = await readFile(path.join(dist, "sw.js"), "utf8");
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    const listed: unknown = JSON.parse(script.slice("self.files = ".length, -";\n".length));
    // The final HTML and licenses.txt among them, but not /sw.js itself.
    expect(listed).toStrictEqual(
      Object.fromEntries([...manifest].filter(([file]) => file !== "/sw.js")),
    );
    expect(Object.keys(listed ?? {})).toEqual(
      expect.arrayContaining(["/index.html", "/licenses.txt", "/.well-known/security.txt"]),
    );
    expect(manifest.get("/sw.js")).toBe(createHash("sha256").update(script).digest("hex"));
    expect(await readFile(path.join(dist, "_headers"), "utf8")).toContain(
      "; trusted-types shkriuss-workers\n",
    );
    expect(await readFile(path.join(dist, "licenses.txt"), "utf8")).toContain(
      "offline-library 2.0.0 (MIT)",
    );
  });

  it("gives the service worker the security headers that _headers gives every file", async () => {
    const root = await createApp();
    const given: (readonly Header[])[] = [];
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [serviceWorker([], given), edge({ allowedFeatures: ["camera"] })],
    });
    const headers = await readFile(path.join(root, "dist", "_headers"), "utf8");
    const everyFile = /^\/\*\n((?: {2}.+\n)+)/m.exec(headers)?.[1];
    expect(given).toHaveLength(1);
    expect(everyFile).toBe(given[0]?.map(([name, value]) => `  ${name}: ${value}\n`).join(""));
    expect(everyFile).toContain("Permissions-Policy: accelerometer=(), autoplay=(), camera=(self)");
    expect(everyFile).toContain("; trusted-types shkriuss-workers\n");
  });

  it("writes security.txt, the same for every build of a commit, and publishes its hash", async () => {
    const root = await createApp();
    await buildApp(root);
    const dist = path.join(root, "dist");
    const text = await readFile(path.join(dist, ".well-known", "security.txt"), "utf8");
    expect(text).toBe(securityTxt(new Date(COMMITTED * 1000)));
    const manifest = parseManifest(await readFile(path.join(dist, "sha256sums.txt"), "utf8"));
    expect(manifest.get("/.well-known/security.txt")).toBe(
      createHash("sha256").update(text).digest("hex"),
    );
  });

  it("fails the build without the commit's date, rather than write a different file", async () => {
    vi.stubEnv("SOURCE_DATE_EPOCH", undefined);
    // The app's folder is in no git checkout.
    await expect(buildApp(await createApp())).rejects.toThrow(
      "build in a git checkout, or set SOURCE_DATE_EPOCH",
    );
  });

  it("fails the build when another file is already security.txt", async () => {
    const root = await createApp();
    await mkdir(path.join(root, "public", ".well-known"), { recursive: true });
    await writeFile(path.join(root, "public", ".well-known", "security.txt"), "Contact: x\n");
    await expect(buildApp(root)).rejects.toThrow("The build already has /.well-known/security.txt");
  });

  it("fails the build when another file is already /sw.js", async () => {
    const root = await createApp();
    await mkdir(path.join(root, "public"));
    await writeFile(path.join(root, "public", "sw.js"), "self.oninstall = () => {};\n");
    await expect(
      build({ root, configFile: false, logLevel: "silent", plugins: [serviceWorker(), edge()] }),
    ).rejects.toThrow("The build already has /sw.js");
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
