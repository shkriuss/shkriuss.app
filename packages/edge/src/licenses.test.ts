import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Licenses,
  OWN_GENERATED,
  collectLicenses,
  legalComments,
  licensesFile,
  stylesheetImports,
} from "./licenses.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "shkriuss-licenses-"));
  roots.push(root);
  return root;
}

/** A package in `root`'s node_modules, with `files` such as its license files. */
async function fakePackage(
  root: string,
  manifest: Record<string, string>,
  files: Record<string, string>,
): Promise<string> {
  const name = manifest["name"] ?? "unnamed";
  const where = path.join(root, "node_modules", name);
  await mkdir(where, { recursive: true });
  await writeFile(path.join(where, "package.json"), JSON.stringify(manifest));
  for (const [file, text] of Object.entries(files)) {
    await writeFile(path.join(where, file), text);
  }
  return where;
}

const RULE = "=".repeat(80);

describe("legalComments", () => {
  it("takes the comments that start with /*!, without their markers", () => {
    const source = [
      "/** A doc comment. */",
      "/*! First notice. */",
      "// A line comment.",
      "/* A plain comment. */",
      "/*!",
      " * Second notice,",
      " * on two lines.",
      " */",
      "export const x = 1;",
    ].join("\n");
    expect(legalComments(source)).toBe("First notice.\n\nSecond notice,\non two lines.");
    expect(legalComments("export const y = 2;")).toBe("");
  });

  it("pairs each /*! with the first */ after it, and skips one that never ends", () => {
    expect(legalComments("/*!*/ /*! a /*! b */ c */ /*! never ends")).toBe("a /*! b");
  });

  it("takes linear time, also on a file with many comments that never end", () => {
    // A regular expression took quadratic time here: about 30 seconds for this file.
    expect(legalComments("/*!".repeat(200_000))).toBe("");
  });
});

describe("stylesheetImports", () => {
  it("finds what @import and @plugin name, in every form", () => {
    const css = [
      '@import "tailwindcss" source(none);',
      "@import 'single.css' layer(base);",
      '@import url("quoted.css") screen;',
      "@import url( 'spaced.css' );",
      "@import url(bare.css);",
      '@import"tight.css";',
      '@plugin "a-plugin";',
    ].join("\n");
    expect(stylesheetImports(css)).toStrictEqual([
      "tailwindcss",
      "single.css",
      "quoted.css",
      "spaced.css",
      "bare.css",
      "tight.css",
      "a-plugin",
    ]);
  });

  it("leaves out comments, other rules and imports that never end", () => {
    const css = '/* @import "commented.css"; */ @importance "no"; @import; @import "never';
    expect(stylesheetImports(css)).toStrictEqual([]);
  });

  it("takes linear time, also on many rules that name nothing", () => {
    expect(stylesheetImports("@import".repeat(200_000))).toStrictEqual([]);
    expect(stylesheetImports(`@import url(${" ".repeat(400_000)}`)).toStrictEqual([]);
    expect(stylesheetImports("/*".repeat(200_000))).toStrictEqual([]);
  });
});

describe("collectLicenses", () => {
  it("collects each package once, in order, with its license files", async () => {
    const root = await directory();
    const a1 = await fakePackage(
      root,
      { name: "a", version: "1.0.0", license: "MIT" },
      { LICENSE: "A license.\r\n", "notice.txt": "A notice.", "README.md": "Not a license." },
    );
    const b = await fakePackage(
      root,
      { name: "b", version: "2.0.0" },
      { "LICENSE-MIT": "B license.", COPYING: "B copying." },
    );
    const a2 = path.join(root, "node_modules", "b", "node_modules", "a");
    await mkdir(a2, { recursive: true });
    await writeFile(
      path.join(a2, "package.json"),
      '{"name": "a", "version": "0.9.0", "license": "ISC"}',
    );
    await writeFile(path.join(a2, "LICENCE"), "Older a.");
    const licenses = await collectLicenses(
      [
        path.join(b, "index.js?worker&url"),
        path.join(a1, "index.js"),
        path.join(a1, "lib", "more.js"),
        path.join(a2, "index.js"),
      ],
      { root, packageOf: () => root },
    );
    expect(licenses.notices).toStrictEqual([]);
    expect(licenses.packages).toStrictEqual([
      {
        name: "a",
        version: "0.9.0",
        license: "ISC",
        files: [{ name: "LICENCE", text: "Older a." }],
      },
      {
        name: "a",
        version: "1.0.0",
        license: "MIT",
        files: [
          { name: "LICENSE", text: "A license." },
          { name: "notice.txt", text: "A notice." },
        ],
      },
      {
        name: "b",
        version: "2.0.0",
        license: "unknown",
        files: [
          { name: "COPYING", text: "B copying." },
          { name: "LICENSE-MIT", text: "B license." },
        ],
      },
    ]);
  });

  it("takes the legal comments of the repository's own files", async () => {
    const root = await directory();
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "words.ts"),
      "/*! From BIP-39, MIT. */\nexport const w = 1;\n",
    );
    await writeFile(path.join(root, "src", "own.ts"), "/** Ours. */\nexport const o = 1;\n");
    const licenses = await collectLicenses(
      [path.join(root, "src", "own.ts"), path.join(root, "src", "words.ts")],
      { root, packageOf: () => root },
    );
    expect(licenses).toStrictEqual({
      packages: [],
      notices: [{ file: "src/words.ts", text: "From BIP-39, MIT." }],
    });
  });

  it("follows the imports of the repository's stylesheets, which the build inlines", async () => {
    const root = await directory();
    await fakePackage(
      root,
      { name: "styles", version: "4.0.0", license: "MIT" },
      { LICENSE: "Styles license." },
    );
    // Only the stylesheet that app.css imports imports this scoped package.
    await fakePackage(
      root,
      { name: "@fonts/serif", version: "1.0.0", license: "OFL-1.1" },
      { LICENSE: "Font license." },
    );
    await mkdir(path.join(root, "src", "parts"), { recursive: true });
    await writeFile(
      path.join(root, "src", "app.css"),
      '/*! App notice. */\n@import "./parts/theme.css";\n@import "styles";\n',
    );
    await writeFile(
      path.join(root, "src", "parts", "theme.css"),
      '/*! Theme notice. */\n@import "styles/extra.css";\n@import "@fonts/serif/index.css";\n@import "../app.css";\n',
    );
    const licenses = await collectLicenses([path.join(root, "src", "app.css")], {
      root,
      packageOf: () => root,
    });
    expect(licenses).toStrictEqual({
      packages: [
        {
          name: "@fonts/serif",
          version: "1.0.0",
          license: "OFL-1.1",
          files: [{ name: "LICENSE", text: "Font license." }],
        },
        {
          name: "styles",
          version: "4.0.0",
          license: "MIT",
          files: [{ name: "LICENSE", text: "Styles license." }],
        },
      ],
      notices: [
        { file: "src/app.css", text: "App notice." },
        { file: "src/parts/theme.css", text: "Theme notice." },
      ],
    });
  });

  it.each([
    ["a URL", '@import "https://example.com/x.css";', /neither a package nor a file/],
    [
      "a file outside the repository",
      '@import "../../outside.css";',
      /imports \.\.\/\.\.\/outside\.css, which is outside/,
    ],
    ["a package that is not installed", '@import "missing";', /missing, which is not installed/],
    ["a package of the repository", '@import "own";', /a package of this repository/],
  ])("refuses a stylesheet that imports %s", async (_case, css, error) => {
    const root = await directory();
    await mkdir(path.join(root, "packages", "own"), { recursive: true });
    await writeFile(path.join(root, "packages", "own", "package.json"), '{"name":"own"}');
    await mkdir(path.join(root, "node_modules"));
    await symlink(path.join(root, "packages", "own"), path.join(root, "node_modules", "own"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "app.css"), css);
    await expect(
      collectLicenses([path.join(root, "src", "app.css")], { root, packageOf: () => root }),
    ).rejects.toThrow(error);
  });

  it("keeps only a bundler's own license for the code it generates", async () => {
    const root = await directory();
    const license = "# Vite core license\nMIT.\n\n# Licenses of bundled dependencies\nOthers.\n";
    const vite = await fakePackage(
      root,
      { name: "vite", version: "8.0.0", license: "MIT" },
      {
        "LICENSE.md": license,
      },
    );
    const rolldown = await fakePackage(
      root,
      { name: "rolldown", version: "1.0.0" },
      {
        LICENSE: "Rolldown.",
      },
    );
    const packageOf = (name: string): string => (name === "vite" ? vite : rolldown);
    const generated = await collectLicenses(["\0vite/preload-helper.js", "\0rolldown/runtime.js"], {
      root,
      packageOf,
    });
    expect(generated.packages.map(({ name, files }) => [name, files])).toStrictEqual([
      ["rolldown", [{ name: "LICENSE", text: "Rolldown." }]],
      ["vite", [{ name: "LICENSE.md", text: "# Vite core license\nMIT." }]],
    ]);
    // Code of the package itself, from node_modules, keeps every license it lists.
    const bundled = await collectLicenses(["\0vite/preload-helper.js", path.join(vite, "x.js")], {
      root,
      packageOf,
    });
    expect(bundled.packages[0]?.files[0]?.text).toBe(license.trim());
  });

  it("counts what this repository's own plugins generate as its own code", async () => {
    const root = await directory();
    expect(
      await collectLicenses([`${OWN_GENERATED}catalog`], { root, packageOf: () => root }),
    ).toStrictEqual({ packages: [], notices: [] });
  });

  it.each<[string, (root: string) => Promise<string>, RegExp]>([
    [
      "generated code of unknown origin",
      async () => "\0other/helper.js",
      /generated code of unknown origin: other\/helper\.js/,
    ],
    [
      "a package without a license file",
      async (root) =>
        path.join(await fakePackage(root, { name: "bare", version: "1.0.0" }, {}), "index.js"),
      /bare@1\.0\.0 has no license file/,
    ],
    [
      "a file of no package outside the repository",
      async () => path.join(tmpdir(), "elsewhere.js"),
      /neither a package nor in/,
    ],
  ])("refuses %s", async (_case, module, message) => {
    const root = await directory();
    const id = await module(root);
    await expect(collectLicenses([id], { root, packageOf: () => root })).rejects.toThrow(message);
  });
});

describe("licensesFile", () => {
  const licenses: Licenses = {
    packages: [
      {
        name: "react",
        version: "19.0.0",
        license: "MIT",
        files: [
          { name: "LICENSE", text: "MIT License" },
          { name: "NOTICE", text: "A notice." },
        ],
      },
    ],
    notices: [{ file: "packages/backup/src/words.ts", text: "BIP-39, MIT." }],
  };
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const own = { text: "GNU AFFERO GENERAL PUBLIC LICENSE\r\nVersion 3\r\n", commit };

  it("names the app, its license, its source and its commit, then every license it includes, then its own", () => {
    expect(licensesFile("notes", licenses, own)).toBe(
      [
        "Licenses of notes.shkriuss.app",
        "",
        "notes.shkriuss.app is free software under the GNU Affero General Public License, version 3 only",
        "(AGPL-3.0-only), whose text ends this file. Its source code is at https://github.com/shkriuss/shkriuss.app; this build",
        `is of the commit https://github.com/shkriuss/shkriuss.app/tree/${commit}.`,
        "",
        "It includes the following software and material of others, under their own licenses.",
        "",
        RULE,
        "react 19.0.0 (MIT)",
        RULE,
        "",
        "--- LICENSE ---",
        "",
        "MIT License",
        "",
        "--- NOTICE ---",
        "",
        "A notice.",
        "",
        RULE,
        "Material in packages/backup/src/words.ts",
        RULE,
        "",
        "BIP-39, MIT.",
        "",
        RULE,
        "The license of notes.shkriuss.app",
        RULE,
        "",
        "GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3",
        "",
      ].join("\n"),
    );
  });

  it("names the hub by its domain", () => {
    expect(licensesFile(undefined, { packages: [], notices: [] }, own)).toMatch(
      /^Licenses of shkriuss\.app\n\nshkriuss\.app is free software/,
    );
    expect(licensesFile(undefined, { packages: [], notices: [] }, own)).toContain(
      "The license of shkriuss.app",
    );
  });
});
