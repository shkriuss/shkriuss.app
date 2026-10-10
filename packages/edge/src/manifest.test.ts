import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildManifest,
  formatManifest,
  MANIFEST_FILE,
  MAX_FILE_BYTES,
  oversizedFiles,
  parseManifest,
  replacedAssets,
} from "./manifest.ts";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const A = "a".repeat(64);
const B = "b".repeat(64);

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("buildManifest", () => {
  it("lists every served file with its SHA-256, and leaves out Cloudflare's config files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shkriuss-manifest-"));
    roots.push(root);
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "index.html"), "<p>hi</p>");
    await writeFile(path.join(root, "assets", "index-a1.js"), "console.info(1)");
    await writeFile(path.join(root, "_headers"), "/*\n  X-Frame-Options: DENY\n");
    await writeFile(path.join(root, MANIFEST_FILE), "stale");

    expect([...(await buildManifest(root))]).toEqual([
      ["/assets/index-a1.js", sha256("console.info(1)")],
      ["/index.html", sha256("<p>hi</p>")],
    ]);
  });
});

describe("oversizedFiles", () => {
  it("finds the served files over 25 MiB, which Cloudflare would refuse, and only those", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "shkriuss-manifest-"));
    roots.push(root);
    await mkdir(path.join(root, "assets"));
    // Files of these sizes without writing their bytes: the rest of each file reads as zeros.
    for (const [file, size] of [
      ["assets/just-fits.wasm", MAX_FILE_BYTES],
      ["assets/too-big.wasm", MAX_FILE_BYTES + 1],
      ["index.html", 10],
      // Cloudflare reads it as configuration, and never serves it.
      ["_headers", MAX_FILE_BYTES + 1],
    ] as const) {
      await writeFile(path.join(root, file), "");
      await truncate(path.join(root, file), size);
    }
    expect(MAX_FILE_BYTES).toBe(26_214_400);
    expect([...(await oversizedFiles(root))]).toEqual([
      ["/assets/too-big.wasm", MAX_FILE_BYTES + 1],
    ]);
  });
});

describe("formatManifest and parseManifest", () => {
  it("write sha256sum's format, sorted by path, and read it back", () => {
    const manifest = new Map([
      ["/index.html", A],
      ["/assets/x.js", B],
    ]);
    const text = formatManifest(manifest);
    expect(text).toBe(`${B}  /assets/x.js\n${A}  /index.html\n`);
    expect(parseManifest(text)).toEqual(manifest);
  });

  it.each([`${A} /index.html`, `${A.slice(1)}  /index.html`, `${A}  index.html`, "<html>"])(
    "rejects the malformed line %j",
    (line) => {
      expect(() => parseManifest(`${line}\n`)).toThrow(/Line 1 of the manifest/);
    },
  );
});

describe("replacedAssets", () => {
  it("finds assets whose content changes under the same name, and nothing else", () => {
    const live = new Map([
      ["/assets/same.js", A],
      ["/assets/changed.js", A],
      ["/assets/removed.js", A],
      ["/index.html", A],
    ]);
    const next = new Map([
      ["/assets/same.js", A],
      ["/assets/changed.js", B],
      ["/assets/new.js", B],
      ["/index.html", B],
    ]);
    expect(replacedAssets(live, next)).toEqual(["/assets/changed.js"]);
  });
});
