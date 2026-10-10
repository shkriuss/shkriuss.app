import { isRecord, lineOf, type Violation } from "./report.ts";

/**
 * Every app keeps the structure of the app template that `create-app` copies (architecture §6):
 * the same files, its id in `app.config.ts` equal to its folder's name, which is its subdomain,
 * the platform's build and scripts, a line that says whether production gets it and is the value
 * the hub reads (ADR 0015), and a test server of its own. Every folder in `apps/` is such an app,
 * and git has no build output: the deploy ships `apps/<id>/dist` as it is. The templates are held
 * to the same, so that what `create-app` copies always passes.
 */

/**
 * The app templates, each checked as the app with its id: the one for apps that keep data, and
 * the one for apps without data.
 */
export const TEMPLATES = [
  { folder: "tooling/app-template", id: "template", packageName: "@shkriuss/app-template" },
  {
    folder: "tooling/app-template-no-data",
    id: "template-no-data",
    packageName: "@shkriuss/app-template-no-data",
  },
] as const;

/** The files that every app has, as the templates do, relative to its folder. */
export const APP_FILES = [
  "README.md",
  "app.config.ts",
  "index.html",
  "package.json",
  "playwright.config.ts",
  "tsconfig.json",
  "tsconfig.browser.json",
  "vite.config.ts",
  "wrangler.json",
  "src/main.tsx",
  "src/messages.ts",
  "src/router.ts",
  "src/routes/home.tsx",
  "src/routes/root.tsx",
  "src/routes/settings.tsx",
] as const;

/** Every version of an app's data, which an app has if it keeps data, and only then. */
export const SCHEMA_FILE = "src/schema.ts";

/** The scripts of every app that the platform runs, whose commands are the app template's. */
const PLATFORM_SCRIPTS = ["build", "typecheck", "e2e"] as const;

type Scripts = Readonly<Record<(typeof PLATFORM_SCRIPTS)[number], string>>;

/**
 * Their commands as both templates have them, for a check that sees no template among the
 * files, as `create-app` checks one new app on its own. With a template among the files, its
 * commands hold, so that every app follows the template.
 */
const TEMPLATE_SCRIPTS: Scripts = {
  build: "vite build",
  // Every file, then the browser code alone, with the browser's types only.
  typecheck: "tsc && tsc -p tsconfig.browser.json",
  e2e: "playwright test",
};

/** Build output under an app or a tooling package, which `.gitignore` keeps out of git. */
const BUILD_OUTPUT = /^((?:apps|tooling)\/[^/]+\/dist)\//;

/** An app's configuration that says that it keeps no data. */
const KEEPS_NO_DATA = /^\s*keepsData:\s*false,?$/m;

/** An app's folder and the id that it must have. */
interface App {
  readonly folder: string;
  readonly id: string;
  readonly packageName: string;
}

/** The apps in `apps/`, but the hub, which is a site and no app, and the templates. */
export function appsOf(files: readonly string[]): App[] {
  const apps = files.flatMap((file) => {
    const id = /^apps\/([^/]+)\/package\.json$/.exec(file)?.[1];
    return id === undefined || id === "hub"
      ? []
      : [{ folder: `apps/${id}`, id, packageName: `@shkriuss/${id}` }];
  });
  return [
    ...apps,
    ...TEMPLATES.filter((template) => files.includes(`${template.folder}/package.json`)),
  ];
}

/** The port of a test server in a `playwright.config.ts`, with its line. */
export function portOf(
  source: string,
): { readonly port: number; readonly line: number } | undefined {
  const match = /\bport(?::|\s*=)\s*(\d+)/.exec(source);
  return match?.[1] === undefined
    ? undefined
    : { port: Number(match[1]), line: lineOf(source, match.index) };
}

/** The commands of the platform's scripts in a `package.json`, those that it gives as strings. */
function scriptsOf(source: string): Partial<Scripts> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch {
    return {};
  }
  const scripts = isRecord(manifest) && isRecord(manifest["scripts"]) ? manifest["scripts"] : {};
  const found: Partial<Record<keyof Scripts, string>> = {};
  for (const script of PLATFORM_SCRIPTS) {
    const command = scripts[script];
    if (typeof command === "string") {
      found[script] = command;
    }
  }
  return found;
}

/**
 * The commands that every app's scripts must have: those of the app template, or of the template
 * without data if only that one is among the files, or else those that both templates have.
 */
function templateScripts(files: readonly string[], read: (file: string) => string): Scripts {
  const template = TEMPLATES.find(({ folder }) => files.includes(`${folder}/package.json`));
  return template === undefined
    ? TEMPLATE_SCRIPTS
    : { ...TEMPLATE_SCRIPTS, ...scriptsOf(read(`${template.folder}/package.json`)) };
}

function checkPackage(app: App, source: string, expected: Scripts): Violation[] {
  const file = `${app.folder}/package.json`;
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch (error) {
    return [{ file, message: `Invalid JSON: ${String(error)}` }];
  }
  if (!isRecord(manifest)) {
    return [{ file, message: "package.json must contain a JSON object." }];
  }
  const violations: Violation[] = [];
  if (manifest["name"] !== app.packageName) {
    violations.push({ file, message: `The app's package must be named ${app.packageName}.` });
  }
  const scripts = isRecord(manifest["scripts"]) ? manifest["scripts"] : {};
  for (const script of PLATFORM_SCRIPTS) {
    if (scripts[script] !== expected[script]) {
      violations.push({
        file,
        message: `Every app has the script "${script}" as its app template has it: "${expected[script]}".`,
      });
    }
  }
  return violations;
}

/** The line of `app.config.ts` that says whether production gets the app (ADR 0015). */
const RELEASED = /^ {2}released: (?:true|false),$/;

/** The lines that open and close the app's configuration, as the template has them. */
const CONFIG_OPENS = /^export const config = \{$/gm;
const CONFIG_CLOSES = /^\} satisfies AppConfig;$/gm;

/** Imports, and nothing else, which is all that the template has before its configuration. */
const ONLY_IMPORTS = /^(?:\s*import\b[^;]*;)*\s*$/;

/** A computed key, `[…]:`, which starts a property: after `{` or `,`, or on a line of its own. */
const COMPUTED_KEY = /(?:^|[{,])\s*\[/m;

const RELEASED_ONCE =
  "app.config.ts must say once whether production gets the app, on a line of its own in export const config = { … }: released: true, or released: false, and the word released nowhere else, not in a comment: the deploy reads that line as it is (ADR 0015).";

const AS_TEMPLATE =
  "app.config.ts has only imports and export const config = { … } satisfies AppConfig;, as the template, so that nothing else changes what the deploy and the hub read (ADR 0015).";

const NO_SPREAD =
  "export const config = { … } has no spread (...) and no computed key ([…]:), as the template, so that released: is the value the hub reads (ADR 0015).";

/** The index of the quote that ends the string opened at `start`, past any escaped character. */
function endOfString(source: string, start: number): number | undefined {
  const quote = source[start];
  for (let at = start + 1; at < source.length; at += 1) {
    const char = source[at];
    if (char === "\\") {
      at += 1;
    } else if (char === quote) {
      return at;
    } else if (char === "\n") {
      return undefined;
    }
  }
  return undefined;
}

/**
 * The source as the check reads it: without its comments, and without the text of its strings,
 * so that neither can pass for code. Both keep their line breaks, so every line stays where it
 * is. Undefined if a string or comment does not end.
 */
export function skeletonOf(source: string): string | undefined {
  let skeleton = "";
  let at = 0;
  while (at < source.length) {
    const char = source[at] ?? "";
    const pair = source.slice(at, at + 2);
    if (char === '"' || char === "'") {
      const end = endOfString(source, at);
      if (end === undefined) {
        return undefined;
      }
      skeleton += char + source.slice(at + 1, end).replaceAll(/[^\n]/g, "") + char;
      at = end + 1;
    } else if (pair === "//") {
      const end = source.indexOf("\n", at);
      at = end === -1 ? source.length : end;
    } else if (pair === "/*") {
      const end = source.indexOf("*/", at + 2);
      if (end === -1) {
        return undefined;
      }
      skeleton += source.slice(at, end + 2).replaceAll(/[^\n]/g, "");
      at = end + 2;
    } else {
      skeleton += char;
      at += 1;
    }
  }
  return skeleton;
}

/** How many brackets `code` opens and does not close. */
function depthOf(code: string): number {
  let depth = 0;
  for (const char of code) {
    if ("{[(".includes(char)) {
      depth += 1;
    } else if ("}])".includes(char)) {
      depth -= 1;
    }
  }
  return depth;
}

/**
 * Checks that `app.config.ts` says whether production gets the app as the template does, on a
 * line that is the value the hub reads (ADR 0015): the word `released` once in the whole file,
 * comments included; the file only imports and `export const config = { … } satisfies
 * AppConfig;`, so that no later statement changes the value; no spread or computed key in that
 * literal, which could set it without the word; and the line itself a direct property with
 * `true` or `false`. The check reads the file as text, so it refuses what it cannot read: a
 * template literal, a regular expression, a division or an escape in an identifier.
 */
export function checkReleased(file: string, source: string): Violation[] {
  const words = [...source.matchAll(/\breleased\b/g)];
  if (words.length !== 1) {
    const second = words[1];
    return [
      {
        file,
        ...(second === undefined ? {} : { line: lineOf(source, second.index) }),
        message: RELEASED_ONCE,
      },
    ];
  }
  const skeleton = skeletonOf(source);
  if (skeleton === undefined) {
    return [{ file, message: "app.config.ts has a string or a comment that does not end." }];
  }
  const unreadable = /[`/\\]/.exec(skeleton);
  if (unreadable !== null) {
    return [
      {
        file,
        line: lineOf(skeleton, unreadable.index),
        message:
          "app.config.ts has no template literals, regular expressions, divisions or escapes in identifiers, which the check cannot read; write it as the template, with plain strings.",
      },
    ];
  }
  const opens = [...skeleton.matchAll(CONFIG_OPENS)];
  const closes = [...skeleton.matchAll(CONFIG_CLOSES)];
  const [open] = opens;
  const [close] = closes;
  if (opens.length !== 1 || closes.length !== 1 || open === undefined || close === undefined) {
    return [{ file, message: AS_TEMPLATE }];
  }
  const bodyAt = open.index + open[0].length;
  const after = skeleton.slice(close.index + close[0].length);
  if (close.index < bodyAt || !ONLY_IMPORTS.test(skeleton.slice(0, open.index))) {
    return [{ file, message: AS_TEMPLATE }];
  }
  if (after.trim() !== "") {
    const at = close.index + close[0].length + after.search(/\S/);
    return [{ file, line: lineOf(skeleton, at), message: AS_TEMPLATE }];
  }
  const body = skeleton.slice(bodyAt, close.index);
  const spread = body.indexOf("...");
  const computed = COMPUTED_KEY.exec(body);
  const unsound =
    spread === -1
      ? computed === null
        ? undefined
        : computed.index + computed[0].length - 1
      : spread;
  if (unsound !== undefined) {
    return [{ file, line: lineOf(skeleton, bodyAt + unsound), message: NO_SPREAD }];
  }
  const said = /^.*\breleased\b.*$/m.exec(body);
  if (said === null || !RELEASED.test(said[0]) || depthOf(body.slice(0, said.index)) !== 0) {
    return [
      {
        file,
        ...(said === null ? {} : { line: lineOf(skeleton, bodyAt + said.index) }),
        message: RELEASED_ONCE,
      },
    ];
  }
  return [];
}

/**
 * Whether the app keeps data, as its configuration says: unless it says `keepsData: false`, as
 * the template without data does.
 */
export function keepsData(config: string): boolean {
  return !KEEPS_NO_DATA.test(config);
}

function checkConfig(app: App, source: string): Violation[] {
  const file = `${app.folder}/app.config.ts`;
  const said = /^\s*keepsData:.*$/m.exec(source);
  if (said !== null && keepsData(source)) {
    return [
      {
        file,
        line: lineOf(source, said.index),
        message:
          "An app keeps data unless app.config.ts says keepsData: false, as the template without data; otherwise leave keepsData out.",
      },
    ];
  }
  const ids = [...source.matchAll(/^\s*id:\s*"([^"]*)",?$/gm)];
  if (ids.length !== 1) {
    return [{ file, message: 'app.config.ts must give the app\'s id once, as id: "<id>",.' }];
  }
  const [match] = ids;
  if (match?.[1] !== app.id) {
    return [
      {
        file,
        line: lineOf(source, match?.index ?? 0),
        message: `The app's id must be "${app.id}", the name of its folder and its subdomain. App ids never change (CLAUDE.md, product rule 3).`,
      },
    ];
  }
  return checkReleased(file, source);
}

function checkBuild(app: App, source: string): Violation[] {
  const usesApp =
    /^import \{ app \} from "@shkriuss\/shell\/vite";$/m.test(source) &&
    /^export default app\(config\b/m.test(source);
  return usesApp
    ? []
    : [
        {
          file: `${app.folder}/vite.config.ts`,
          message:
            "Apps build with app(config) of @shkriuss/shell/vite, which adds the security headers.",
        },
      ];
}

/**
 * Build output that git has, under an app or a tooling package, by its folder. The deploy ships
 * whatever is in `apps/<id>/dist`, so only the build may write it; `.gitignore` has `dist/`, so
 * such a file was added by force.
 */
export function checkBuildOutput(files: readonly string[]): Violation[] {
  const folders = new Set(files.flatMap((file) => BUILD_OUTPUT.exec(file)?.[1] ?? []));
  return [...folders].map((folder) => ({
    file: folder,
    message:
      "Build output is never committed: the deploy ships whatever is in apps/<id>/dist, so only the build writes it. Remove it from git; .gitignore has dist/.",
  }));
}

/**
 * Every folder in `apps/` is an app, with a `package.json`: the checks go by that file, and the
 * deploy ships every folder.
 */
function checkAppFolders(files: readonly string[]): Violation[] {
  const folders = new Set(files.flatMap((file) => /^apps\/([^/]+)\//.exec(file)?.[1] ?? []));
  return [...folders]
    .filter((id) => !files.includes(`apps/${id}/package.json`))
    .map((id) => ({
      file: `apps/${id}`,
      message:
        "Every folder in apps/ is an app, with a package.json, which the checks go by and the deploy ships; create apps with create-app.",
    }));
}

/** Checks that every app, and the template, keeps the standard structure. */
export function checkAppStructure(
  files: readonly string[],
  read: (file: string) => string,
): Violation[] {
  const violations: Violation[] = [...checkBuildOutput(files), ...checkAppFolders(files)];
  const present = new Set(files);
  const scripts = templateScripts(files, read);
  for (const app of appsOf(files)) {
    const has = (file: string): boolean => present.has(`${app.folder}/${file}`);
    const withData = !has("app.config.ts") || keepsData(read(`${app.folder}/app.config.ts`));
    const missing = [...APP_FILES, ...(withData ? [SCHEMA_FILE] : [])].filter((file) => !has(file));
    for (const file of missing) {
      violations.push({
        file: `${app.folder}/${file}`,
        message: "Every app has this file, as its app template does; create apps with create-app.",
      });
    }
    if (!withData && has(SCHEMA_FILE)) {
      violations.push({
        file: `${app.folder}/${SCHEMA_FILE}`,
        message:
          "An app without data has no schema, as the template without data; remove it, or keepsData: false from app.config.ts.",
      });
    }
    if (!files.some((file) => file.startsWith(`${app.folder}/e2e/`) && file.endsWith(".spec.ts"))) {
      violations.push({ file: `${app.folder}/e2e`, message: "Every app has end-to-end tests." });
    }
    if (has("package.json")) {
      violations.push(...checkPackage(app, read(`${app.folder}/package.json`), scripts));
    }
    if (has("app.config.ts")) {
      violations.push(...checkConfig(app, read(`${app.folder}/app.config.ts`)));
    }
    if (has("vite.config.ts")) {
      violations.push(...checkBuild(app, read(`${app.folder}/vite.config.ts`)));
    }
  }
  return [...violations, ...checkPorts(files, read)];
}

/**
 * The test server of every app and every test package listens on a port of its own, so that
 * their tests can run at once: `pnpm e2e` runs them together.
 */
export function checkPorts(files: readonly string[], read: (file: string) => string): Violation[] {
  const configs = files.filter((file) =>
    /^(?:apps|tooling)\/[^/]+\/playwright\.config\.ts$/.test(file),
  );
  const owners = new Map<number, string>();
  const violations: Violation[] = [];
  for (const file of configs) {
    const source = read(file);
    const found = portOf(source);
    if (found === undefined) {
      violations.push({ file, message: "The test server's port must be given as port: <number>." });
      continue;
    }
    const owner = owners.get(found.port);
    if (owner === undefined) {
      owners.set(found.port, file);
    } else {
      violations.push({
        file,
        line: found.line,
        message: `Port ${found.port} is ${owner}'s already; every test server has its own.`,
      });
    }
  }
  return violations;
}
