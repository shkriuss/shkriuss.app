import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Licenses of crates compiled into Harper's module that the license policy does not list, which
 * the maintainer accepted for it on 2026-10-07: the Mozilla Public License 2.0, a copyleft of
 * single files that is compatible with AGPL-3.0, and the permissive Unicode and zlib licenses.
 * A crate under any other license needs the same review.
 */
const ACCEPTED_FOR_HARPER = ["MPL-2.0", "Unicode-3.0", "Zlib"];

/** The repository's root. */
const root = path.resolve(import.meta.dirname, "../../../../..");

/** The version of harper.js that the app has. */
async function installedVersion(): Promise<string> {
  const app = path.resolve(import.meta.dirname, "../../..");
  const manifest: unknown = JSON.parse(
    await readFile(path.join(app, "node_modules/harper.js/package.json"), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("version" in manifest) ||
    typeof manifest.version !== "string"
  ) {
    throw new Error("harper.js has no version.");
  }
  return manifest.version;
}

describe("the notices of Harper's module", () => {
  it("are those of the harper.js that the app has: scripts/harper-notices.ts writes them anew", async () => {
    const source = await readFile(path.join(import.meta.dirname, "harper.ts"), "utf8");
    expect(source).toContain(`of harper.js ${await installedVersion()} (Apache-2.0)`);
    // Among them, the crates whose licenses ask the most of the app, and their texts.
    expect(source).toMatch(/^ \* cssparser [\d.]+, MPL-2\.0$/m);
    expect(source).toMatch(/^ \* The text of MPL-2\.0:$/m);
  });
});

describe("the licenses of the crates compiled into Harper's module", () => {
  it("are those that the license policy allows, or that were accepted for it", async () => {
    const policy: unknown = JSON.parse(
      await readFile(path.join(root, "tooling/checks/license-policy.json"), "utf8"),
    );
    const allowed =
      typeof policy === "object" &&
      policy !== null &&
      "allowed" in policy &&
      Array.isArray(policy.allowed)
        ? policy.allowed.filter((license): license is string => typeof license === "string")
        : [];
    expect(allowed).toContain("MIT");
    const source = await readFile(path.join(import.meta.dirname, "harper.ts"), "utf8");
    // The list of crates, which ends where the notices' and the licenses' texts begin.
    const list = source.slice(0, source.search(/^ \* The (?:text|NOTICE) of /m));
    const used = new Set(
      [...list.matchAll(/^ \* [\w-]+ \d[\w.+-]*, ([^:\n]+?)(?::|$)/gm)].flatMap(
        ([, licenses = ""]) => licenses.split(" and "),
      ),
    );
    expect(used.size).toBeGreaterThan(1);
    expect(
      [...used].filter(
        (license) => !allowed.includes(license) && !ACCEPTED_FOR_HARPER.includes(license),
      ),
    ).toStrictEqual([]);
  });
});
