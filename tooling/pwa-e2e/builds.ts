import { readFileSync } from "node:fs";

/**
 * The builds of the test app, each a version of it as a host would deploy it in turn. The test
 * server serves them side by side (server.ts):
 *
 * - `a`, then `b`: two versions of the app;
 * - `broken`: a version with a file that the host changed after the build hashed it;
 * - `fix`: a version that replaces `a` as a broken version (service worker spec §8);
 * - `removal`: a build that turns service workers off (§9).
 */
export const BUILDS = ["a", "b", "broken", "fix", "removal"] as const;

export type Build = (typeof BUILDS)[number];

export function isBuild(name: string): name is Build {
  return BUILDS.some((build) => build === name);
}

/** The text of a file of a build in `dist/`. */
export function builtFile(build: Build, file: string): string {
  return readFileSync(new URL(`dist/${build}/${file}`, import.meta.url), "utf8");
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
