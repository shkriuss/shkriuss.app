import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkAppStructure, checkPorts } from "@shkriuss/checks/structure";
import { checkWranglerConfig } from "@shkriuss/checks/wrangler";
import * as prettier from "prettier";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type NewApp,
  TEMPLATE,
  TEMPLATE_WITHOUT_DATA,
  appFiles,
  checkNewApp,
  isCopied,
  nextPort,
  templateOf,
} from "./create.ts";

const root = path.resolve(import.meta.dirname, "../../..");

/** The files of the template in `folder`, by their path in it, as `create-app` reads them. */
async function readTemplate(folder: string): Promise<Map<string, string>> {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", folder],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter((file) => file !== "");
  const files = new Map<string, string>();
  for (const file of listed) {
    files.set(path.posix.relative(folder, file), await readFile(path.join(root, file), "utf8"));
  }
  return files;
}

/** The app template's files, and those of the template without data. */
let template: Map<string, string>;
let templateWithoutData: Map<string, string>;

beforeAll(async () => {
  template = await readTemplate(TEMPLATE);
  templateWithoutData = await readTemplate(TEMPLATE_WITHOUT_DATA);
});

const NOTES: NewApp = {
  id: "notes",
  name: "Notes",
  description: "Notes that stay on this device.",
  accent: "#0f766e",
};

/** The files of the template that make each app itself, which `create-app` changes. */
const CHANGED = ["package.json", "app.config.ts", "src/messages.ts", "playwright.config.ts"];

function get(files: ReadonlyMap<string, string>, file: string): string {
  const source = files.get(file);
  if (source === undefined) {
    throw new Error(`No ${file}.`);
  }
  return source;
}

describe("appFiles", () => {
  it("copies the template into apps/<id>, and changes only what makes the app itself", () => {
    const files = appFiles(NOTES, template, 4200);
    const copied = [...template.keys()].filter(isCopied);
    expect(copied).toEqual(expect.arrayContaining(["src/main.tsx", "e2e/app.spec.ts"]));
    const differing = copied.filter(
      (file) => !CHANGED.includes(file) && get(files, `apps/notes/${file}`) !== template.get(file),
    );
    expect(differing).toStrictEqual([]);
    expect([...files.keys()].toSorted()).toStrictEqual(
      [...copied, "README.md", "wrangler.json"].map((file) => `apps/notes/${file}`).toSorted(),
    );

    expect(JSON.parse(get(files, "apps/notes/package.json"))).toMatchObject({
      name: "@shkriuss/notes",
    });
    const config = get(files, "apps/notes/app.config.ts");
    expect(config).toContain('  id: "notes",\n');
    expect(config).toContain('  accent: "#0f766e",\n');
    const messages = get(files, "apps/notes/src/messages.ts");
    expect(messages).toContain('  appName: () => "Notes",\n');
    expect(messages).toContain('  appShortName: () => "Notes",\n');
    expect(messages).toMatch(/appDescription: \(\) =>\s*"Notes that stay on this device\.",\n/);
    expect(get(files, "apps/notes/playwright.config.ts")).toContain("port: 4200 ");
    expect(get(files, "apps/notes/README.md")).toMatch(
      /^# Notes\n\nNotes that stay on this device\.\n/,
    );
  });

  it("keeps the template's accent color if the app gives none", () => {
    const { accent: _accent, ...withoutAccent } = NOTES;
    const config = get(appFiles(withoutAccent, template, 4200), "apps/notes/app.config.ts");
    expect(config).toBe(template.get("app.config.ts")?.replace('id: "template"', 'id: "notes"'));
  });

  it("makes an app that the repository's checks accept: structure, test port and Cloudflare", () => {
    const files = appFiles(NOTES, template, 4200);
    const read = (file: string): string => get(files, file);
    expect(checkAppStructure([...files.keys()], read)).toStrictEqual([]);
    expect(
      checkWranglerConfig("apps/notes/wrangler.json", read("apps/notes/wrangler.json")),
    ).toStrictEqual([]);
    expect(JSON.parse(read("apps/notes/wrangler.json"))).toMatchObject({
      name: "shkriuss-notes",
      env: {
        staging: { routes: [{ pattern: "notes.shkriuss.dev", custom_domain: true }] },
        production: { routes: [{ pattern: "notes.shkriuss.app", custom_domain: true }] },
      },
    });
    const configs = new Map([
      ["apps/notes/playwright.config.ts", read("apps/notes/playwright.config.ts")],
      ["tooling/app-template/playwright.config.ts", get(template, "playwright.config.ts")],
      [
        "tooling/app-template-no-data/playwright.config.ts",
        get(templateWithoutData, "playwright.config.ts"),
      ],
    ]);
    expect(checkPorts([...configs.keys()], (file) => get(configs, file))).toStrictEqual([]);
  });

  it("makes an app without data from the template without data, which the checks accept", () => {
    const words: NewApp = {
      id: "words",
      name: "Words",
      description: "Counts the words of a text.",
      keepsData: false,
    };
    expect(templateOf(words)).toBe(TEMPLATE_WITHOUT_DATA);
    expect(templateOf(NOTES)).toBe(TEMPLATE);
    const files = appFiles(words, templateWithoutData, 4200);
    const copied = [...templateWithoutData.keys()].filter(isCopied);
    expect(
      copied.filter(
        (file) =>
          !CHANGED.includes(file) &&
          get(files, `apps/words/${file}`) !== templateWithoutData.get(file),
      ),
    ).toStrictEqual([]);
    expect([...files.keys()]).not.toContain("apps/words/src/schema.ts");
    const config = get(files, "apps/words/app.config.ts");
    expect(config).toContain('  id: "words",\n');
    expect(config).toContain("  keepsData: false,\n");
    const readme = get(files, "apps/words/README.md");
    expect(readme).toContain(
      "[app template without data](../../tooling/app-template-no-data/README.md)",
    );
    expect(readme).not.toContain("backup");

    const read = (file: string): string => get(files, file);
    expect(checkAppStructure([...files.keys()], read)).toStrictEqual([]);
    expect(
      checkWranglerConfig("apps/words/wrangler.json", read("apps/words/wrangler.json")),
    ).toStrictEqual([]);
  });

  it("writes any name and description as strings that the app reads back as they were", async () => {
    const name = 'Ann\'s "Lists" \\ 📝';
    const description = "Lists with “quotes”, a back\\slash and a ${placeholder}.";
    const files = appFiles(
      { ...NOTES, name, shortName: "Ann's lists", description },
      template,
      4200,
    );
    const messages = get(files, "apps/notes/src/messages.ts");
    const value = (message: string): unknown =>
      JSON.parse(
        new RegExp(String.raw`${message}: \(\) =>\s*("(?:[^"\\]|\\.)*")`).exec(messages)?.[1] ?? "",
      );
    expect(value("appName")).toBe(name);
    expect(value("appShortName")).toBe("Ann's lists");
    expect(value("appDescription")).toBe(description);
    // Still TypeScript, which Prettier formats as create-app does.
    await expect(prettier.format(messages, { filepath: "messages.ts" })).resolves.toContain(
      "appName",
    );
  });

  it("follows the template's tests' port, and fails if the template changed in a way it does not know", () => {
    const changed = new Map(template);
    changed.set("app.config.ts", "export const config = {};\n");
    expect(() => appFiles(NOTES, changed, 4200)).toThrow(
      "The template's app.config.ts must have exactly one match of",
    );
    const noWrangler = new Map(template);
    noWrangler.delete("wrangler.json");
    expect(() => appFiles(NOTES, noWrangler, 4200)).toThrow("The template has no wrangler.json");
  });
});

describe("checkNewApp", () => {
  it("asks for a short name when the name is longer than home screens show", () => {
    const long = { ...NOTES, name: "Shopping for the week" };
    expect(() => {
      checkNewApp(long);
    }).toThrow('"Shopping for the week" is longer than 12 characters');
    expect(() => {
      checkNewApp({ ...long, shortName: "Shopping" });
    }).not.toThrow();
    // Twelve characters as people see them, whatever their code points.
    expect(() => {
      checkNewApp({ ...NOTES, name: "Café crème 👩‍👩‍👧" });
    }).not.toThrow();
  });

  it("refuses what cannot be an app", () => {
    for (const [app, error] of [
      [{ ...NOTES, id: "Notes" }, '"Notes" is not a valid app id'],
      [{ ...NOTES, id: "www" }, '"www" is reserved'],
      [{ ...NOTES, name: "" }, "The name must be one line of text"],
      [{ ...NOTES, name: " Notes" }, "The name must be one line of text"],
      [{ ...NOTES, description: "Two\nlines." }, "The description must be one line of text"],
      [{ ...NOTES, shortName: "\t" }, "The short name must be one line of text"],
      [{ ...NOTES, accent: "#0F766E" }, "The accent color must be written as #rrggbb"],
      [{ ...NOTES, accent: "teal" }, "The accent color must be written as #rrggbb"],
    ] as const) {
      expect(() => {
        checkNewApp(app);
      }).toThrow(error);
    }
  });
});

describe("nextPort", () => {
  it("takes the first port from 4200 up that no test server has", () => {
    expect(nextPort([4173, 4174, 4175, 4176])).toBe(4200);
    expect(nextPort([4200, 4201, 4203])).toBe(4202);
  });
});

describe("isCopied", () => {
  it("leaves out what tools leave in the template, and what create-app writes itself", () => {
    expect(["src/main.tsx", "e2e/app.spec.ts", "index.html"].every(isCopied)).toBe(true);
    expect(
      [
        "node_modules/x/index.js",
        "dist/index.html",
        "test-results/a",
        "README.md",
        "wrangler.json",
      ].filter(isCopied),
    ).toStrictEqual([]);
  });
});
