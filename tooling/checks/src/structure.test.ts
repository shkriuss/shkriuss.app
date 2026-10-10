import { describe, expect, it } from "vitest";
import {
  APP_FILES,
  SCHEMA_FILE,
  appsOf,
  checkAppStructure,
  checkBuildOutput,
  checkPorts,
  checkReleased,
  skeletonOf,
} from "./structure.ts";

/** The scripts that the templates have. */
const SCRIPTS = {
  build: "vite build",
  typecheck: "tsc && tsc -p tsconfig.browser.json",
  e2e: "playwright test",
};

/** What the check says of an `app.config.ts` that does not say, once and as the value, whether production gets the app. */
const ONCE =
  "app.config.ts must say once whether production gets the app, on a line of its own in export const config = { … }: released: true, or released: false, and the word released nowhere else, not in a comment: the deploy reads that line as it is (ADR 0015).";
const SHAPE =
  "app.config.ts has only imports and export const config = { … } satisfies AppConfig;, as the template, so that nothing else changes what the deploy and the hub read (ADR 0015).";
const SOUND =
  "export const config = { … } has no spread (...) and no computed key ([…]:), as the template, so that released: is the value the hub reads (ADR 0015).";
const UNREADABLE =
  "app.config.ts has no template literals, regular expressions, divisions or escapes in identifiers, which the check cannot read; write it as the template, with plain strings.";
const OPEN = "app.config.ts has a string or a comment that does not end.";

/** The one problem with `apps/notes/app.config.ts`, at `line` if it has one, as `check` reports it. */
function problem(message: string, line?: number): string[] {
  return [`apps/notes/app.config.ts${line === undefined ? "" : `:${line}`}: ${message}`];
}

/**
 * An `app.config.ts` as the template has it: `imports`, a comment, the configuration with
 * `released: false,` on line 11 unless `said` gives that line otherwise, `close` as its last line,
 * and `after` that.
 */
function config(
  id: string,
  {
    keepsData = true,
    said = "  released: false,",
    imports = 'import type { AppConfig } from "@shkriuss/shell/vite";\nimport { m } from "./src/messages.ts";\n',
    close = "} satisfies AppConfig;",
    after = "",
  } = {},
): string {
  return `${imports}\n/**\n * What this app is. Its id is permanent: it is the app's subdomain and folder.\n */\nexport const config = {\n  id: "${id}",\n  name: m.appName(),\n${keepsData ? "" : "  keepsData: false,\n"}  // Production gets a new app only once it has been checked on real devices (ADR 0015).\n${said}\n${close}\n${after}`;
}

/** The files of an app as its template has them, by path, with its contents. */
function app(
  folder: string,
  id: string,
  port: number,
  { name = `@shkriuss/${id}`, keepsData = true, scripts = SCRIPTS } = {},
): Map<string, string> {
  const files = new Map<string, string>(
    [...APP_FILES, ...(keepsData ? [SCHEMA_FILE] : [])].map((file) => [`${folder}/${file}`, ""]),
  );
  files.set(`${folder}/package.json`, JSON.stringify({ name, scripts }));
  files.set(`${folder}/app.config.ts`, config(id, { keepsData }));
  files.set(
    `${folder}/vite.config.ts`,
    'import { app } from "@shkriuss/shell/vite";\nimport { config } from "./app.config.ts";\n\nexport default app(config);\n',
  );
  files.set(
    `${folder}/playwright.config.ts`,
    `export default playwrightConfig({ port: ${port} });\n`,
  );
  files.set(`${folder}/e2e/app.spec.ts`, "");
  return files;
}

function check(...apps: Map<string, string>[]): string[] {
  const all = new Map(apps.flatMap((files) => [...files]));
  return checkAppStructure([...all.keys()], (file) => all.get(file) ?? "").map(
    (violation) =>
      `${violation.file}${violation.line === undefined ? "" : `:${violation.line}`}: ${violation.message}`,
  );
}

describe("appsOf", () => {
  it("finds the apps in apps/ and the templates, but not the hub, which is a site", () => {
    const files = [
      "apps/hub/package.json",
      "apps/notes/package.json",
      "tooling/app-template/package.json",
      "tooling/app-template-no-data/package.json",
    ];
    expect(appsOf(files).map(({ folder, id }) => `${folder} ${id}`)).toStrictEqual([
      "apps/notes notes",
      "tooling/app-template template",
      "tooling/app-template-no-data template-no-data",
    ]);
  });
});

describe("checkAppStructure", () => {
  it("accepts apps as their templates are, and the templates themselves", () => {
    expect(
      check(
        app("apps/notes", "notes", 4200),
        app("apps/words", "words", 4201, { keepsData: false }),
        app("tooling/app-template", "template", 4176, { name: "@shkriuss/app-template" }),
        app("tooling/app-template-no-data", "template-no-data", 4177, {
          name: "@shkriuss/app-template-no-data",
          keepsData: false,
        }),
      ),
    ).toStrictEqual([]);
  });

  it("asks for every file that the template has, and end-to-end tests", () => {
    const notes = app("apps/notes", "notes", 4200);
    notes.delete("apps/notes/src/router.ts");
    notes.delete("apps/notes/e2e/app.spec.ts");
    expect(check(notes)).toStrictEqual([
      "apps/notes/src/router.ts: Every app has this file, as its app template does; create apps with create-app.",
      "apps/notes/e2e: Every app has end-to-end tests.",
    ]);
  });

  it("asks an app with data for its schema, and an app without data for none", () => {
    const notes = app("apps/notes", "notes", 4200);
    notes.delete("apps/notes/src/schema.ts");
    const words = app("apps/words", "words", 4201, { keepsData: false });
    words.set("apps/words/src/schema.ts", "");
    expect(check(notes, words)).toStrictEqual([
      "apps/notes/src/schema.ts: Every app has this file, as its app template does; create apps with create-app.",
      "apps/words/src/schema.ts: An app without data has no schema, as the template without data; remove it, or keepsData: false from app.config.ts.",
    ]);
  });

  it("wants a line that says whether production gets the app, as the deploy reads it", () => {
    for (const said of ["  released: true,", "  released: false,"]) {
      const notes = app("apps/notes", "notes", 4200);
      notes.set("apps/notes/app.config.ts", config("notes", { said }));
      expect(check(notes)).toStrictEqual([]);
    }
    for (const [said, line] of [
      ["", undefined],
      ["  released: !beta,", 11],
      ["  released: true,\n  released: false,", 12],
      ["released: true,", 11],
      ["    released: true,", 11],
      // A property of another value, two spaces in as if of the configuration.
      ["  icon: { size: 24, paths: [],\n  released: true,\n  },", 12],
      // The word in a comment, beside the line: the deploy must not find two.
      ["  released: true, // released apps only", 11],
      // The one word in a string, with no line.
      ['  name: "released",', undefined],
    ] as const) {
      const notes = app("apps/notes", "notes", 4200);
      notes.set("apps/notes/app.config.ts", config("notes", { said }));
      expect(check(notes)).toStrictEqual(problem(ONCE, line));
    }
  });

  it("refuses a comment's line that the deploy would read, with a spread for the real value", () => {
    // The crafted file of the audit: the line that the deploy's grep finds is in a comment, and
    // the value that the hub reads comes from a spread.
    const crafted = [
      'import type { AppConfig } from "@shkriuss/shell/vite";',
      'import { m } from "./src/messages.ts";',
      "",
      "/*",
      "  released: true,",
      "*/",
      "const extra = { released: false };",
      'export const config = { ...extra, id: "notes", name: m.appName() } satisfies AppConfig;',
      "",
    ].join("\n");
    expect(crafted.split("\n")).toContain("  released: true,");
    expect(checkReleased("apps/notes/app.config.ts", crafted)).toStrictEqual([
      { file: "apps/notes/app.config.ts", line: 7, message: ONCE },
    ]);
  });

  it("holds the configuration to the template's shape, which nothing else can change", () => {
    const spread = {
      said: "  released: true,\n  ...extra,",
      imports:
        'import type { AppConfig } from "@shkriuss/shell/vite";\nimport { extra } from "./extra.ts";\n',
    };
    for (const [options, expected] of [
      // A spread from an import, which the one word cannot show.
      [spread, problem(SOUND, 12)],
      // A computed key.
      [{ said: '  released: true,\n  ["rel" + "eased"]: false,' }, problem(SOUND, 12)],
      // A statement after the configuration.
      [
        { said: "  released: true,", after: 'config["rel" + "eased"] = false;\n' },
        problem(SHAPE, 13),
      ],
      // A statement before it.
      [{ imports: 'import { m } from "./src/messages.ts";\nconst extra = {};\n' }, problem(SHAPE)],
      // An end that is not the template's.
      [{ said: "  released: true,", close: "};" }, problem(SHAPE)],
      // A second configuration.
      [{ said: "  released: true,", after: "export const config = {\n" }, problem(SHAPE)],
    ] as const) {
      const notes = app("apps/notes", "notes", 4200);
      notes.set("apps/notes/app.config.ts", config("notes", { ...options }));
      expect(check(notes)).toStrictEqual(expected);
    }
  });

  it("refuses what it cannot read as text, and a string or comment that does not end", () => {
    for (const said of [
      '  released: true,\n  accent: "#" + String(/x/),',
      "  released: true,\n  accent: `#fff`,",
      "  released: true,\n  size: 48 / 2,",
      "  released: true,\n  n\\u0061me: m.appName(),",
    ]) {
      const notes = app("apps/notes", "notes", 4200);
      notes.set("apps/notes/app.config.ts", config("notes", { said }));
      expect(check(notes)).toStrictEqual(problem(UNREADABLE, 12));
    }
    for (const said of [
      '  released: true,\n  accent: "#fff,',
      "  released: true,\n  /* accent",
      // A regular expression in which `/*` opens, for the check and not for TypeScript, a comment
      // that never ends.
      '  released: true,\n  accent: "#" + String(/[/*]/),',
    ]) {
      const notes = app("apps/notes", "notes", 4200);
      notes.set("apps/notes/app.config.ts", config("notes", { said }));
      expect(check(notes)).toStrictEqual(problem(OPEN));
    }
  });

  it("reads only keepsData: false, as the template without data says it", () => {
    for (const said of ["keepsData: true,", "keepsData: !online,", "keepsData: false && online,"]) {
      const notes = app("apps/notes", "notes", 4200);
      notes.set(
        "apps/notes/app.config.ts",
        `export const config = {\n  id: "notes",\n  ${said}\n};\n`,
      );
      expect(check(notes)).toStrictEqual([
        "apps/notes/app.config.ts:3: An app keeps data unless app.config.ts says keepsData: false, as the template without data; otherwise leave keepsData out.",
      ]);
    }
  });

  it("holds the package to the app's name and the template's scripts", () => {
    const notes = app("apps/notes", "notes", 4200, { name: "@shkriuss/memo" });
    notes.set("apps/notes/package.json", JSON.stringify({ name: "@shkriuss/memo", scripts: {} }));
    expect(check(notes)).toStrictEqual([
      "apps/notes/package.json: The app's package must be named @shkriuss/notes.",
      'apps/notes/package.json: Every app has the script "build" as its app template has it: "vite build".',
      'apps/notes/package.json: Every app has the script "typecheck" as its app template has it: "tsc && tsc -p tsconfig.browser.json".',
      'apps/notes/package.json: Every app has the script "e2e" as its app template has it: "playwright test".',
    ]);
    notes.set("apps/notes/package.json", "{");
    expect(check(notes)[0]).toMatch(/^apps\/notes\/package\.json: Invalid JSON/);
  });

  it("holds every app's scripts to the commands of the template, not only to having them", () => {
    // A build of the app's own would skip the platform's build, which makes what the deploy ships.
    const raw = app("apps/raw", "raw", 4202, {
      scripts: { ...SCRIPTS, build: "cp -r raw dist", e2e: "true" },
    });
    expect(
      check(raw, app("tooling/app-template", "template", 4176, { name: "@shkriuss/app-template" })),
    ).toStrictEqual([
      'apps/raw/package.json: Every app has the script "build" as its app template has it: "vite build".',
      'apps/raw/package.json: Every app has the script "e2e" as its app template has it: "playwright test".',
    ]);
    // The commands are the template's, read from it, so that the template leads; an app checked
    // on its own, without the template among the files, is held to what the templates have.
    const changed = { ...SCRIPTS, build: "vite build --mode next" };
    const template = app("tooling/app-template", "template", 4176, {
      name: "@shkriuss/app-template",
      scripts: changed,
    });
    expect(check(template, app("apps/notes", "notes", 4200))).toStrictEqual([
      'apps/notes/package.json: Every app has the script "build" as its app template has it: "vite build --mode next".',
    ]);
    expect(check(app("apps/notes", "notes", 4200, { scripts: changed }), template)).toStrictEqual(
      [],
    );
    expect(check(app("apps/notes", "notes", 4200, { scripts: changed }))).toStrictEqual([
      'apps/notes/package.json: Every app has the script "build" as its app template has it: "vite build".',
    ]);
    // The template without data follows the template with data.
    const noData = app("tooling/app-template-no-data", "template-no-data", 4177, {
      name: "@shkriuss/app-template-no-data",
      keepsData: false,
    });
    expect(check(template, noData)).toStrictEqual([
      'tooling/app-template-no-data/package.json: Every app has the script "build" as its app template has it: "vite build --mode next".',
    ]);
  });

  it("refuses a folder in apps/ that is no app, which the deploy would ship unchecked", () => {
    const evil = new Map([
      ["apps/evil/wrangler.json", "{}"],
      ["apps/evil/dist/index.html", ""],
      ["apps/evil/dist/assets/app.js", ""],
    ]);
    expect(check(evil, app("apps/notes", "notes", 4200))).toStrictEqual([
      "apps/evil/dist: Build output is never committed: the deploy ships whatever is in apps/<id>/dist, so only the build writes it. Remove it from git; .gitignore has dist/.",
      "apps/evil: Every folder in apps/ is an app, with a package.json, which the checks go by and the deploy ships; create apps with create-app.",
    ]);
  });

  it("keeps the app's id equal to its folder, which is its subdomain", () => {
    const renamed = app("apps/memo", "notes", 4200, { name: "@shkriuss/memo" });
    expect(check(renamed)).toStrictEqual([
      'apps/memo/app.config.ts:8: The app\'s id must be "memo", the name of its folder and its subdomain. App ids never change (CLAUDE.md, product rule 3).',
    ]);
    const twice = app("apps/notes", "notes", 4200);
    twice.set("apps/notes/app.config.ts", 'id: "notes",\nid: "notes",\n');
    expect(check(twice)).toStrictEqual([
      'apps/notes/app.config.ts: app.config.ts must give the app\'s id once, as id: "<id>",.',
    ]);
  });

  it("builds every app with the platform's build, which adds the security headers", () => {
    const notes = app("apps/notes", "notes", 4200);
    notes.set(
      "apps/notes/vite.config.ts",
      "export default defineConfig({ plugins: [react()] });\n",
    );
    expect(check(notes)).toStrictEqual([
      "apps/notes/vite.config.ts: Apps build with app(config) of @shkriuss/shell/vite, which adds the security headers.",
    ]);
  });
});

describe("checkBuildOutput", () => {
  it("refuses build output in git under an app or a tooling package, once per folder", () => {
    expect(
      checkBuildOutput([
        "apps/notes/dist/index.html",
        "apps/notes/dist/assets/app.js",
        "apps/notes/src/main.tsx",
        "tooling/checks/dist/cli.js",
        "packages/edge/src/dist/names.ts",
        "apps/dist/README.md",
      ]),
    ).toStrictEqual([
      {
        file: "apps/notes/dist",
        message:
          "Build output is never committed: the deploy ships whatever is in apps/<id>/dist, so only the build writes it. Remove it from git; .gitignore has dist/.",
      },
      {
        file: "tooling/checks/dist",
        message:
          "Build output is never committed: the deploy ships whatever is in apps/<id>/dist, so only the build writes it. Remove it from git; .gitignore has dist/.",
      },
    ]);
  });
});

describe("skeletonOf", () => {
  it("drops comments and the text of strings, and keeps every line where it is", () => {
    const source = [
      'import { m } from "./src/messages.ts"; // the app\'s text',
      "/* a block",
      "   comment */ const a = 'it\\'s';",
      'const b = "a \\"quoted\\" word // not a comment /* nor this";',
      "const c = 1; /* one line */ const d = 2;",
    ].join("\n");
    expect(skeletonOf(source)).toBe(
      [
        'import { m } from ""; ',
        "",
        " const a = '';",
        'const b = "";',
        "const c = 1;  const d = 2;",
      ].join("\n"),
    );
  });

  it("gives nothing for a string or comment that does not end", () => {
    expect(skeletonOf('const a = "open\nconst b = 1;')).toBeUndefined();
    expect(skeletonOf("const a = 'open")).toBeUndefined();
    expect(skeletonOf("const a = 1; /* open\nconst b = 2;")).toBeUndefined();
    expect(skeletonOf("const a = 1; // to the end")).toBe("const a = 1; ");
  });
});

describe("checkPorts", () => {
  it("gives every test server a port of its own, in apps and in tooling", () => {
    const files = new Map([
      ["apps/hub/playwright.config.ts", "playwrightConfig({ port: 4173 });"],
      ["apps/notes/playwright.config.ts", "playwrightConfig({ port: 4200 });"],
      ["tooling/pwa-e2e/playwright.config.ts", "const port = 4175;"],
      ["tooling/app-template/playwright.config.ts", "\n\nplaywrightConfig({ port: 4200 });"],
      ["tooling/other/playwright.config.ts", "playwrightConfig();"],
      ["tooling/other/e2e/playwright.config.ts", "playwrightConfig({ port: 4173 });"],
    ]);
    expect(checkPorts([...files.keys()], (file) => files.get(file) ?? "")).toStrictEqual([
      {
        file: "tooling/app-template/playwright.config.ts",
        line: 3,
        message:
          "Port 4200 is apps/notes/playwright.config.ts's already; every test server has its own.",
      },
      {
        file: "tooling/other/playwright.config.ts",
        message: "The test server's port must be given as port: <number>.",
      },
    ]);
  });
});
