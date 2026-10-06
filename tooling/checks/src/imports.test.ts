import { describe, expect, it } from "vitest";
import { checkImports, importsOf } from "./imports.ts";

describe("importsOf", () => {
  it("finds static, side-effect and dynamic imports, and re-exports, across lines", () => {
    const source = [
      'import "@shkriuss/ui/styles.css";',
      "import {",
      "  a,",
      "  b,",
      '} from "./a.ts";',
      'export { c } from "../c.ts";',
      'const lazy = import("./lazy.ts");',
      '// From "./comment.ts", which is no import.',
      "/**",
      ' * import { app } from "./example.ts";',
      " */",
    ].join("\n");
    expect(importsOf(source).map(({ specifier }) => specifier)).toStrictEqual([
      "@shkriuss/ui/styles.css",
      "./a.ts",
      "../c.ts",
      "./lazy.ts",
    ]);
  });
});

function check(files: Record<string, string>): string[] {
  return checkImports(Object.keys(files), (file) => files[file] ?? "").map(
    (violation) => `${violation.file}:${violation.line ?? 0}: ${violation.message}`,
  );
}

const MANIFESTS = {
  "apps/notes/package.json": '{ "name": "@shkriuss/notes" }',
  "apps/lists/package.json": '{ "name": "@shkriuss/lists" }',
  "packages/data/package.json": '{ "name": "@shkriuss/data" }',
  "tooling/checks/package.json": '{ "name": "@shkriuss/checks" }',
};

describe("checkImports", () => {
  it("accepts relative imports within a package, and packages by their name", () => {
    expect(
      check({
        ...MANIFESTS,
        "apps/notes/src/routes/home.tsx":
          'import { m } from "../messages.ts";\nimport { config } from "../../app.config.ts";\nimport { openDatabase } from "@shkriuss/data";',
        "apps/notes/src/main.tsx": 'import worker from "./backup.worker.ts?worker&url";',
        "packages/data/src/db.ts": 'import Dexie from "dexie";',
      }),
    ).toStrictEqual([]);
  });

  it("refuses relative imports that leave their package", () => {
    expect(
      check({
        ...MANIFESTS,
        "apps/notes/src/main.tsx": '\nimport { db } from "../../../packages/data/src/db.ts";',
        "tooling/checks/src/cli.ts": 'export { x } from "../../../apps/notes/src/x.ts";',
      }),
    ).toStrictEqual([
      'apps/notes/src/main.tsx:2: "../../../packages/data/src/db.ts" leaves apps/notes: import other packages by their name, through their entry points.',
      'tooling/checks/src/cli.ts:1: "../../../apps/notes/src/x.ts" leaves tooling/checks: import other packages by their name, through their entry points.',
    ]);
  });

  it("refuses imports of an app, from another app or from a package", () => {
    expect(
      check({
        ...MANIFESTS,
        "apps/lists/src/main.tsx": 'import { notes } from "@shkriuss/notes";',
        "packages/data/src/db.ts": 'const notes = import("@shkriuss/notes/src/x.ts");',
      }),
    ).toStrictEqual([
      'apps/lists/src/main.tsx:1: "@shkriuss/notes" is an app, which nothing imports: shared code goes into packages/.',
      'packages/data/src/db.ts:1: "@shkriuss/notes/src/x.ts" is an app, which nothing imports: shared code goes into packages/.',
    ]);
  });

  it("leaves other files alone", () => {
    expect(
      check({
        ...MANIFESTS,
        "packages/data/README.md": 'import { x } from "../../apps/notes/x.ts";',
        "docs/example.ts": 'import { x } from "../apps/notes/x.ts";',
      }),
    ).toStrictEqual([]);
  });
});
