import { describe, expect, it } from "vitest";
import {
  checkWorkspace,
  checkWorkspaceConfig,
  pnpmConfigFiles,
  readSections,
  WORKSPACE_FILE,
} from "./workspace.ts";

const FILE = "pnpm-workspace.yaml";

const HARDENING = [
  "minimumReleaseAge: 4320",
  "minimumReleaseAgeExclude: []",
  "trustPolicy: no-downgrade",
  "blockExoticSubdeps: true",
  "strictDepBuilds: true",
  "engineStrict: true",
];

/** A workspace file with the settings of ADR 0007 and the lines given. */
const workspace = (...lines: string[]): string =>
  ["packages:", "  - apps/*", "  - packages/*", ...HARDENING, ...lines, ""].join("\n");

/** The violations of a workspace file as `line: message`. */
const messages = (source: string): string[] =>
  checkWorkspaceConfig(FILE, source).map(
    (violation) => `${violation.line ?? 0}: ${violation.message}`,
  );

describe("readSections", () => {
  it("reads top-level keys with their values, and the entries indented under them", () => {
    const sections = readSections(
      [
        "# A comment",
        "packages:",
        "  - apps/*",
        "",
        "catalog:",
        '  "@types/node": 24.19.1 # trailing comment',
        "  react: '19.3.0'",
        "  # a comment between entries",
        "  vite: 8.3.3",
        "catalogs:",
        "  next:",
        "    react: 20.0.0",
        "minimumReleaseAge: 4320",
        'savePrefix: ""',
      ].join("\n"),
    );
    expect(sections).toStrictEqual([
      { key: "packages", value: "", line: 2, entries: [{ key: "-", value: "apps/*", line: 3 }] },
      {
        key: "catalog",
        value: "",
        line: 5,
        entries: [
          { key: "@types/node", value: "24.19.1", line: 6 },
          { key: "react", value: "19.3.0", line: 7 },
          { key: "vite", value: "8.3.3", line: 9 },
        ],
      },
      {
        key: "catalogs",
        value: "",
        line: 10,
        entries: [
          { key: "next", value: "", line: 11 },
          { key: "react", value: "20.0.0", line: 12 },
        ],
      },
      { key: "minimumReleaseAge", value: "4320", line: 13, entries: [] },
      { key: "savePrefix", value: "", line: 14, entries: [] },
    ]);
  });
});

describe("checkWorkspaceConfig", () => {
  it("accepts the catalog, overrides with reasons, and blocked install scripts", () => {
    expect(
      messages(
        workspace(
          "catalog:",
          '  "@types/node": 24.19.1',
          "  react: 19.3.0",
          "  vite: ^8.3.3",
          "  vitest: ~5.0.3",
          "  next: 15.0.0-canary.1",
          "overrides:",
          "  # GHSA-xxxx: fixed in 0.18.2.",
          "  katex: 0.18.10",
          "  esbuild: catalog:",
          "  react-dom: catalog:react19",
          "allowBuilds:",
          "  # Ships its binary in a platform package.",
          "  esbuild: false",
          "  workerd: false",
          'savePrefix: ""',
        ),
      ),
    ).toStrictEqual([]);
  });

  it("refuses catalog and override entries that are not versions", () => {
    expect(
      messages(
        workspace(
          "catalog:",
          "  left-pad: https://example.com/left-pad-1.3.0.tgz",
          "  react: github:facebook/react#main",
          "  vite: git+ssh://git@github.com/vitejs/vite.git",
          "  dexie: file:../dexie",
          "  turbo: link:../turbo",
          "  prettier: workspace:*",
          "  vitest: latest",
          "  oxlint: '*'",
          "  tslib: npm:tslib@2.8.1",
          "  zod: 4",
          "overrides:",
          "  sharp: ../sharp.tgz",
        ),
      ),
    ).toStrictEqual([
      '11: catalog.left-pad is "https://example.com/left-pad-1.3.0.tgz"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '12: catalog.react is "github:facebook/react#main"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '13: catalog.vite is "git+ssh://git@github.com/vitejs/vite.git"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '14: catalog.dexie is "file:../dexie"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '15: catalog.turbo is "link:../turbo"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '16: catalog.prettier is "workspace:*"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '17: catalog.vitest is "latest"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '18: catalog.oxlint is "*"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '19: catalog.tslib is "npm:tslib@2.8.1"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '20: catalog.zod is "4"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      '22: overrides.sharp is "../sharp.tgz"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
    ]);
  });

  it("refuses named catalogs with such entries, and flow mappings it cannot read", () => {
    expect(
      messages(
        workspace(
          "catalogs:",
          "  next:",
          "    react: github:facebook/react#main",
          "overrides: { sharp: https://example.com/sharp.tgz }",
          "catalog:",
          "  - react",
        ),
      ),
    ).toStrictEqual([
      '12: catalogs.react is "github:facebook/react#main"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).',
      "13: Write overrides as a mapping, one entry per line.",
      "15: catalog is a mapping of names to versions, not a list.",
    ]);
  });

  it("refuses patched dependencies, a pnpmfile and the old ways to allow install scripts", () => {
    expect(
      messages(
        workspace(
          "patchedDependencies:",
          "  left-pad@1.3.0: patches/left-pad@1.3.0.patch",
          "pnpmfile: ./hooks.cjs",
          "onlyBuiltDependencies:",
          "  - esbuild",
          "dangerouslyAllowAllBuilds: true",
        ),
      ),
    ).toStrictEqual([
      "10: patchedDependencies is not allowed; a patch changes what a dependency runs. Fix it upstream, or record the exception in an ADR (ADR 0007).",
      "12: pnpmfile is not allowed; its hooks change what pnpm installs (ADR 0007).",
      "13: onlyBuiltDependencies is not allowed; install scripts stay blocked (ADR 0007).",
      "15: dangerouslyAllowAllBuilds is not allowed; install scripts stay blocked (ADR 0007).",
    ]);
  });

  it("refuses an install script allowed", () => {
    expect(
      messages(workspace("allowBuilds:", "  esbuild: false", "  sharp: true", "  workerd: 'true'")),
    ).toStrictEqual([
      '12: allowBuilds.sharp is "true"; install scripts stay blocked (ADR 0007). An exception needs the maintainer\'s review, an ADR, and a place in tooling/checks/src/workspace.ts.',
      '13: allowBuilds.workerd is "true"; install scripts stay blocked (ADR 0007). An exception needs the maintainer\'s review, an ADR, and a place in tooling/checks/src/workspace.ts.',
    ]);
    expect(messages(workspace("allowBuilds: { sharp: true }"))).toStrictEqual([
      "10: Write allowBuilds as a mapping, one package per line.",
    ]);
    expect(messages(workspace("allowBuilds: {}"))).toStrictEqual([]);
  });

  it("requires the settings of ADR 0007", () => {
    expect(messages("packages:\n  - apps/*\n")).toStrictEqual([
      "0: Set trustPolicy: no-downgrade (ADR 0007).",
      "0: Set blockExoticSubdeps: true (ADR 0007).",
      "0: Set strictDepBuilds: true (ADR 0007).",
      "0: Set engineStrict: true (ADR 0007).",
      "0: Set minimumReleaseAge: 4320 (three days, ADR 0007).",
    ]);
    expect(
      messages(
        [
          "minimumReleaseAge: 60",
          "trustPolicy: trust-on-first-use",
          "blockExoticSubdeps: false",
          "strictDepBuilds: false",
          "engineStrict: false",
          "",
        ].join("\n"),
      ),
    ).toStrictEqual([
      '2: trustPolicy is "trust-on-first-use"; ADR 0007 requires no-downgrade.',
      '3: blockExoticSubdeps is "false"; ADR 0007 requires true.',
      '4: strictDepBuilds is "false"; ADR 0007 requires true.',
      '5: engineStrict is "false"; ADR 0007 requires true.',
      '1: minimumReleaseAge is "60"; ADR 0007 requires at least 4320 (three days).',
    ]);
    expect(
      messages(workspace().replace("minimumReleaseAge: 4320", "minimumReleaseAge: 3d")),
    ).toStrictEqual([
      '4: minimumReleaseAge is "3d"; ADR 0007 requires at least 4320 (three days).',
    ]);
    expect(
      messages(workspace().replace("minimumReleaseAge: 4320", "minimumReleaseAge: 10080")),
    ).toStrictEqual([]);
  });
});

describe("pnpmConfigFiles", () => {
  it("refuses .npmrc and pnpmfiles anywhere", () => {
    expect(
      pnpmConfigFiles([
        ".npmrc",
        "apps/notes/.npmrc",
        ".pnpmfile.cjs",
        "packages/data/.pnpmfile.mjs",
        "tooling/checks/.pnpmfile.js",
        "pnpm-workspace.yaml",
        "pnpm-lock.yaml",
        ".npmrc.example.md",
        "docs/npmrc.md",
      ]).map((violation) => violation.file),
    ).toStrictEqual([
      ".npmrc",
      "apps/notes/.npmrc",
      ".pnpmfile.cjs",
      "packages/data/.pnpmfile.mjs",
      "tooling/checks/.pnpmfile.js",
    ]);
    expect(pnpmConfigFiles([".npmrc"])[0]?.message).toBe(
      ".npmrc is not allowed; pnpm's settings live in pnpm-workspace.yaml, where `pnpm check` reads them (ADR 0007).",
    );
    expect(pnpmConfigFiles([".pnpmfile.cjs"])[0]?.message).toBe(
      "A pnpmfile is not allowed; its hooks change what pnpm installs (ADR 0007).",
    );
  });
});

describe("checkWorkspace", () => {
  it("reads the workspace file among the repository's files, and requires it", () => {
    const files: Record<string, string> = {
      [WORKSPACE_FILE]: workspace("allowBuilds:", "  sharp: true"),
      "apps/notes/.npmrc": "ignore-scripts=false",
    };
    expect(
      checkWorkspace(Object.keys(files), (file) => files[file] ?? "").map(
        (violation) => `${violation.file}:${violation.line ?? 0}`,
      ),
    ).toStrictEqual(["pnpm-workspace.yaml:11", "apps/notes/.npmrc:0"]);
    expect(checkWorkspace(["package.json"], () => "")).toStrictEqual([
      { file: "pnpm-workspace.yaml", message: "Missing; it holds pnpm's settings (ADR 0007)." },
    ]);
  });
});
