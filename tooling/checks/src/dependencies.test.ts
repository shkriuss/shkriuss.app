import { describe, expect, it } from "vitest";
import { checkManifest, isWorkspaceManifest } from "./dependencies.ts";

const manifest = (fields: Record<string, unknown>): string =>
  JSON.stringify({ name: "x", private: true, license: "AGPL-3.0-only", ...fields });

describe("checkManifest", () => {
  it("accepts catalog and workspace dependencies", () => {
    const source = manifest({
      dependencies: { react: "catalog:", "@shkriuss/ui": "workspace:*" },
      devDependencies: { vitest: "catalog:testing" },
      peerDependencies: { react: "catalog:" },
    });
    expect(checkManifest("apps/notes/package.json", source)).toEqual([]);
  });

  it("rejects a peer dependency's range, which pnpm would install from outside the catalog", () => {
    const violations = checkManifest(
      "packages/ui/package.json",
      manifest({ peerDependencies: { react: "^19.0.0" } }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("peerDependencies.react");
  });

  it("rejects versions written directly in package.json", () => {
    const violations = checkManifest(
      "package.json",
      manifest({ devDependencies: { prettier: "^3.0.0" } }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("devDependencies.prettier");
  });

  it("requires private packages with the repository license", () => {
    const source = JSON.stringify({ name: "x", license: "MIT" });
    expect(checkManifest("package.json", source).map((v) => v.message)).toEqual([
      'Set "private": true; packages in this repository are never published.',
      'Set "license": "AGPL-3.0-only".',
    ]);
  });

  it("reports invalid JSON instead of throwing", () => {
    expect(checkManifest("package.json", "{")[0]?.message).toMatch(/^Invalid JSON/);
  });
});

describe("isWorkspaceManifest", () => {
  it.each([
    ["package.json", true],
    ["apps/notes/package.json", true],
    ["packages/ui/package.json", true],
    ["tooling/checks/package.json", true],
    ["apps/notes/src/fixtures/package.json", false],
    ["node_modules/x/package.json", false],
  ])("%s → %s", (file, expected) => {
    expect(isWorkspaceManifest(file)).toBe(expected);
  });
});
