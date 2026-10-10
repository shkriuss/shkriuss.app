import { isRecord, lineOf, type Violation } from "./report.ts";

/**
 * Every app keeps the structure of the app template that `create-app` copies (architecture §6):
 * the same files, its id in `app.config.ts` equal to its folder's name, which is its subdomain,
 * the platform's build, and a test server of its own. The templates are held to the same, so
 * that what `create-app` copies always passes.
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

function checkPackage(app: App, source: string): Violation[] {
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
  for (const script of ["build", "typecheck", "e2e"]) {
    if (typeof scripts[script] !== "string") {
      violations.push({ file, message: `Every app has the script "${script}", as the template.` });
    }
  }
  return violations;
}

/** The line of `app.config.ts` that says whether production gets the app (ADR 0015). */
const RELEASED = /^ {2}released: (?:true|false),$/;

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
  // The deploy reads this line as it is (ADR 0015).
  const released = [...source.matchAll(/^\s*released:.*$/gm)];
  if (released.length !== 1 || !RELEASED.test(released[0]?.[0] ?? "")) {
    return [
      {
        file,
        line: lineOf(source, released[0]?.index ?? 0),
        message:
          "app.config.ts must say once whether production gets the app, on a line of its own: released: true, or released: false, (ADR 0015).",
      },
    ];
  }
  return [];
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

/** Checks that every app, and the template, keeps the standard structure. */
export function checkAppStructure(
  files: readonly string[],
  read: (file: string) => string,
): Violation[] {
  const violations: Violation[] = [];
  const present = new Set(files);
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
      violations.push(...checkPackage(app, read(`${app.folder}/package.json`)));
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
