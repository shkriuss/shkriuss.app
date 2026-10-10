import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Every deployment publishes the SHA-256 of each file it serves (ADR 0007, transparency), in
 * the format `sha256sum` writes: `<hash>  <path>`, one file per line, sorted by path.
 */
export const MANIFEST_FILE = "sha256sums.txt";

/** Files in the build that Cloudflare reads as configuration and never serves. */
const NOT_SERVED = new Set(["_headers", "_redirects", MANIFEST_FILE]);

const LINE = /^([0-9a-f]{64}) {2}(\/\S*)$/;

/** The URL paths (`/assets/x.js`) of every file in `directory` that will be served. */
async function servedFiles(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await servedFiles(directory, relative)));
    } else if (!(prefix === "" && NOT_SERVED.has(entry.name))) {
      files.push(`/${relative}`);
    }
  }
  return files;
}

/** The manifest of a build directory, as a map from URL path to SHA-256 (hex). */
export async function buildManifest(directory: string): Promise<Map<string, string>> {
  const manifest = new Map<string, string>();
  for (const file of (await servedFiles(directory)).toSorted()) {
    const bytes = await readFile(path.join(directory, file));
    manifest.set(file, createHash("sha256").update(bytes).digest("hex"));
  }
  return manifest;
}

/** The largest file that Cloudflare serves as a static asset: 25 MiB. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * The served files of `directory` that are larger than Cloudflare serves (`MAX_FILE_BYTES`),
 * with their sizes in bytes, by URL path. The deploy would refuse them, after the build and the
 * tests had passed.
 */
export async function oversizedFiles(directory: string): Promise<Map<string, number>> {
  const oversized = new Map<string, number>();
  for (const file of (await servedFiles(directory)).toSorted()) {
    const { size } = await stat(path.join(directory, file));
    if (size > MAX_FILE_BYTES) {
      oversized.set(file, size);
    }
  }
  return oversized;
}

export function formatManifest(manifest: ReadonlyMap<string, string>): string {
  const lines = [...manifest.keys()]
    .toSorted()
    .map((file) => `${manifest.get(file) ?? ""}  ${file}`);
  return `${lines.join("\n")}\n`;
}

/** Reads a manifest; throws on anything that is not a well-formed line. */
export function parseManifest(text: string): Map<string, string> {
  const manifest = new Map<string, string>();
  for (const [index, line] of text.split("\n").entries()) {
    if (line === "") {
      continue;
    }
    const match = LINE.exec(line);
    if (match === null) {
      throw new Error(`Line ${index + 1} of the manifest is not "<sha256>  /<path>".`);
    }
    manifest.set(match[2] ?? "", match[1] ?? "");
  }
  return manifest;
}

/**
 * Files in `/assets/` that both deployments serve under the same name but with different
 * content. Browsers keep those files for a year, so a returning visitor would load the old
 * copy, which then fails its new integrity hash (ADR 0010). A deployment must never do that.
 */
export function replacedAssets(
  live: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): string[] {
  return [...next]
    .filter(
      ([file, hash]) => file.startsWith("/assets/") && live.has(file) && live.get(file) !== hash,
    )
    .map(([file]) => file)
    .toSorted();
}
