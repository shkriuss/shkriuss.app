import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appIconSvg } from "@shkriuss/pwa/vite";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOG_MODULE, catalog, readCatalog } from "./catalog.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const ICON = { size: 24, paths: [{ d: "M4 4H20V20H4Z" }] };

const NOTES = {
  id: "notes",
  name: "Notes",
  description: "Notes that stay on this device.",
  accent: "#1d4ed8",
  icon: ICON,
};

async function directory(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "shkriuss-catalog-"));
  roots.push(root);
  return root;
}

/** An `apps/` folder with these files in each app's folder, and the hub, which has none. */
async function appsWith(files: Readonly<Record<string, Readonly<Record<string, string>>>>) {
  const apps = path.join(await directory(), "apps");
  await mkdir(path.join(apps, "hub", "src"), { recursive: true });
  for (const [folder, contents] of Object.entries(files)) {
    await mkdir(path.join(apps, folder));
    for (const [file, text] of Object.entries(contents)) {
      await writeFile(path.join(apps, folder, file), text);
    }
  }
  return apps;
}

/** An app.config.ts that exports `config`. */
function configFile(config: unknown): Record<string, string> {
  return { "app.config.ts": `export const config = ${JSON.stringify(config)};\n` };
}

const iconUrl = (accent: string): string =>
  `data:image/svg+xml,${encodeURIComponent(appIconSvg({ accent, icon: ICON }))}`;

describe("readCatalog", () => {
  it("reads every app but the hub, sorted by name, with its icon and features", async () => {
    const apps = await appsWith({
      notes: configFile(NOTES),
      checklists: configFile({
        ...NOTES,
        id: "checklists",
        name: " Checklists ",
        accent: "#15803d",
        allowedFeatures: ["camera"],
      }),
    });
    expect(await readCatalog(apps)).toStrictEqual([
      {
        id: "checklists",
        name: "Checklists",
        description: NOTES.description,
        icon: iconUrl("#15803d"),
        allowedFeatures: ["camera"],
      },
      {
        id: "notes",
        name: "Notes",
        description: NOTES.description,
        icon: iconUrl("#1d4ed8"),
        allowedFeatures: [],
      },
    ]);
  });

  it.each<[string, Readonly<Record<string, Readonly<Record<string, string>>>>, RegExp | string]>([
    [
      "no exported configuration",
      { notes: { "app.config.ts": "export const settings = {};\n" } },
      'apps/notes/app.config.ts must export the app\'s configuration as "config".',
    ],
    [
      "an id that is not its folder's",
      { notes: configFile({ ...NOTES, id: "memo" }) },
      "apps/notes/app.config.ts must give its folder's name, \"notes\", as the app's id.",
    ],
    ["an id that cannot be an app's", { www: configFile({ ...NOTES, id: "www" }) }, /reserved/],
    [
      "a blank name",
      { notes: configFile({ ...NOTES, name: "  " }) },
      "must give the app's name and description",
    ],
    [
      "no description",
      { notes: configFile({ ...NOTES, description: undefined }) },
      "must give the app's name and description",
    ],
    [
      "an icon without paths",
      { notes: configFile({ ...NOTES, icon: { size: 24 } }) },
      "must give the app's accent color and icon",
    ],
    ["an accent that is no color", { notes: configFile({ ...NOTES, accent: "blue" }) }, /color/],
    [
      "a browser feature that does not exist",
      { notes: configFile({ ...NOTES, allowedFeatures: ["telepathy"] }) },
      "must list only browser features that exist",
    ],
  ])("refuses an app with %s", async (_case, files, error) => {
    await expect(readCatalog(await appsWith(files))).rejects.toThrow(error);
  });
});

describe("catalog", () => {
  it("puts the apps' values into the bundle, and none of their code", async () => {
    const apps = await appsWith({
      notes: {
        "app.config.ts":
          'import { appName } from "./messages.ts";\n' +
          `export const config = { ...${JSON.stringify(NOTES)}, name: appName() };\n`,
        "messages.ts":
          'export const MARKER = "code of the app";\n' +
          'export function appName() { return MARKER === "" ? "" : "Notes"; }\n',
      },
    });
    const site = await directory();
    await writeFile(
      path.join(site, "index.html"),
      '<!doctype html><title>Hub</title><script type="module" src="/main.js"></script>',
    );
    await writeFile(
      path.join(site, "main.js"),
      `import { apps } from "${CATALOG_MODULE}";\n` +
        "document.title = apps.map((app) => `${app.name} ${app.icon}`).join();\n",
    );
    await build({ root: site, configFile: false, logLevel: "silent", plugins: [catalog(apps)] });
    const assets = path.join(site, "dist", "assets");
    const [script] = (await readdir(assets)).filter((file) => file.endsWith(".js"));
    const code = await readFile(path.join(assets, script ?? ""), "utf8");
    // The minifier quotes strings as it likes.
    expect(code).toMatch(/name:.Notes./v);
    expect(code).toContain(NOTES.description);
    expect(code).toContain(iconUrl(NOTES.accent));
    expect(code).not.toContain("code of the app");
  });
});
