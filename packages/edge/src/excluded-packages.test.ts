import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertExcludedPackages } from "./excluded-packages.ts";

let root = "";

/** A file of the repository at `root`, by its path there. */
function file(relative: string): string {
  return path.join(root, ...relative.split("/"));
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "shkriuss-excluded-"));
  const manifests = {
    "packages/store/package.json": '{"name": "@example/store"}',
    // A package.json without a name, as some packages put into their builds.
    "packages/store/src/dist/package.json": '{"type": "module"}',
    "node_modules/crypto-lib/package.json": '{"name": "crypto-lib"}',
    "apps/words/package.json": '{"name": "@example/words"}',
  };
  for (const [manifest, source] of Object.entries(manifests)) {
    await mkdir(path.dirname(file(manifest)), { recursive: true });
    await writeFile(file(manifest), source);
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("assertExcludedPackages", () => {
  it("accepts a build without the code of the packages that the app excludes", async () => {
    await expect(
      assertExcludedPackages(
        [
          file("apps/words/src/main.tsx"),
          file("node_modules/crypto-lib/index.js"),
          // Generated code belongs to no package.
          "\0vite/preload-helper.js",
        ],
        ["@example/store"],
        root,
      ),
    ).resolves.toBeUndefined();
  });

  it("names each excluded package whose code the build has, with the first of its files", async () => {
    await expect(
      assertExcludedPackages(
        [
          file("apps/words/src/main.tsx"),
          `${file("packages/store/src/dist/index.js")}?worker&url`,
          file("packages/store/src/other.ts"),
          file("node_modules/crypto-lib/index.js"),
        ],
        ["@example/store", "crypto-lib"],
        root,
      ),
    ).rejects.toThrow(
      "The build has the code of @example/store (packages/store/src/dist/index.js) and crypto-lib (node_modules/crypto-lib/index.js), which this app excludes.",
    );
  });

  it("reads nothing for an app that excludes nothing", async () => {
    await expect(
      assertExcludedPackages([path.join(root, "nowhere", "x.js")], [], root),
    ).resolves.toBeUndefined();
  });
});
