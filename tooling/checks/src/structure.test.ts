import { describe, expect, it } from "vitest";
import { APP_FILES, appsOf, checkAppStructure, checkPorts } from "./structure.ts";

/** The files of an app as the template has them, by path, with its contents. */
function app(
  folder: string,
  id: string,
  port: number,
  name = `@shkriuss/${id}`,
): Map<string, string> {
  const files = new Map<string, string>(APP_FILES.map((file) => [`${folder}/${file}`, ""]));
  files.set(
    `${folder}/package.json`,
    JSON.stringify({
      name,
      scripts: { build: "vite build", typecheck: "tsc", e2e: "playwright test" },
    }),
  );
  files.set(
    `${folder}/app.config.ts`,
    `export const config = {\n  id: "${id}",\n  name: m.appName(),\n};\n`,
  );
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
  it("finds the apps in apps/ and the template, but not the hub, which is a site", () => {
    const files = [
      "apps/hub/package.json",
      "apps/notes/package.json",
      "tooling/app-template/package.json",
    ];
    expect(appsOf(files).map(({ folder, id }) => `${folder} ${id}`)).toStrictEqual([
      "apps/notes notes",
      "tooling/app-template template",
    ]);
  });
});

describe("checkAppStructure", () => {
  it("accepts apps as the template is, and the template itself", () => {
    expect(
      check(
        app("apps/notes", "notes", 4200),
        app("tooling/app-template", "template", 4176, "@shkriuss/app-template"),
      ),
    ).toStrictEqual([]);
  });

  it("asks for every file that the template has, and end-to-end tests", () => {
    const notes = app("apps/notes", "notes", 4200);
    notes.delete("apps/notes/src/router.ts");
    notes.delete("apps/notes/e2e/app.spec.ts");
    expect(check(notes)).toStrictEqual([
      "apps/notes/src/router.ts: Every app has this file, as the app template does; create apps with create-app.",
      "apps/notes/e2e: Every app has end-to-end tests.",
    ]);
  });

  it("holds the package to the app's name and the template's scripts", () => {
    const notes = app("apps/notes", "notes", 4200, "@shkriuss/memo");
    notes.set("apps/notes/package.json", JSON.stringify({ name: "@shkriuss/memo", scripts: {} }));
    expect(check(notes)).toStrictEqual([
      "apps/notes/package.json: The app's package must be named @shkriuss/notes.",
      'apps/notes/package.json: Every app has the script "build", as the template.',
      'apps/notes/package.json: Every app has the script "typecheck", as the template.',
      'apps/notes/package.json: Every app has the script "e2e", as the template.',
    ]);
    notes.set("apps/notes/package.json", "{");
    expect(check(notes)[0]).toMatch(/^apps\/notes\/package\.json: Invalid JSON/);
  });

  it("keeps the app's id equal to its folder, which is its subdomain", () => {
    const renamed = app("apps/memo", "notes", 4200, "@shkriuss/memo");
    expect(check(renamed)).toStrictEqual([
      'apps/memo/app.config.ts:2: The app\'s id must be "memo", the name of its folder and its subdomain. App ids never change (CLAUDE.md, product rule 3).',
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
