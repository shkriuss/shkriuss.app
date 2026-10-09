import { readFileSync } from "node:fs";

/**
 * The builds of the test app, each a version of it as a host would deploy it in turn. The test
 * server serves them side by side (server.ts):
 *
 * - `a`, then `b`: two versions of the app;
 * - `broken`: a version with a file that the host changed after the build hashed it;
 * - `fix`: a version that replaces `a` as a broken version (service worker spec §8);
 * - `removal`: a build that turns service workers off (§9);
 * - `tampered`: a version with a file kept on first use that the host changed after the build
 *   hashed it (§6.3).
 *
 * Every build has two files that it keeps on first use (§2.1): `/first-use/same.dat`, the same in
 * every build, and `/first-use/build.dat`, which names its build.
 */
export const BUILDS = ["a", "b", "broken", "fix", "removal", "tampered"] as const;

/** The end of the names of the files that every build keeps on first use. */
export const FIRST_USE = ".dat";

export type Build = (typeof BUILDS)[number];

export function isBuild(name: string): name is Build {
  return BUILDS.some((build) => build === name);
}

/** The text of a file of a build in `dist/`. */
export function builtFile(build: Build, file: string): string {
  return readFileSync(new URL(`dist/${build}/${file}`, import.meta.url), "utf8");
}

/**
 * The files that the service worker of a build keeps, by the URL that the host serves each at,
 * with their SHA-256 (service worker spec §2.1): every file of its `sha256sums.txt`, but `/sw.js`
 * and `security.txt`. The test app has one HTML file, `/index.html`, served at `/`.
 */
export function precachedFiles(build: Build): Map<string, string> {
  const files = new Map<string, string>();
  for (const line of builtFile(build, "sha256sums.txt").trim().split("\n")) {
    const [sha256 = "", path = ""] = line.split("  ");
    if (path !== "/sw.js" && path !== "/.well-known/security.txt") {
      files.set(path === "/index.html" ? "/" : path, sha256);
    }
  }
  return files;
}

/** The files of `precachedFiles()` that the service worker keeps at install: not on first use. */
export function keptAtInstall(build: Build): Map<string, string> {
  return new Map([...precachedFiles(build)].filter(([url]) => !url.endsWith(FIRST_USE)));
}

/** The version id in the `/sw.js` of a build in `dist/`. */
export function versionOf(build: Build): string {
  const script = builtFile(build, "sw.js");
  const version = /"version":"([0-9a-f]{16})"/.exec(script)?.[1];
  if (version === undefined) {
    throw new Error(`dist/${build}/sw.js has no version id; build the test app first.`);
  }
  return version;
}
