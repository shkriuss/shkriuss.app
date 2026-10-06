import { isRecord, lineOf, type Violation } from "./report.ts";

/**
 * Every app keeps the structure of the app template, which `create-app` copies (architecture
 * §6): the same files, its id in `app.config.ts` equal to its folder's name, which is its
 * subdomain, the platform's build, and a test server of its own. The template is held to the
 * same, so that what `create-app` copies always passes.
 */

/** The app template, which is checked as the app with this id. */
export const TEMPLATE = { folder: "tooling/app-template", id: "template" } as const;

/** The files that every app has, as the template does, relative to its folder. */
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
  "src/schema.ts",
] as const;

/** An app's folder and the id that it must have. */
interface App {
  readonly folder: string;
  readonly id: string;
  readonly packageName: string;
}

/** The apps in `apps/`, but the hub, which is a site and no app, and the template. */
export function appsOf(files: readonly string[]): App[] {
  const apps = files.flatMap((file) => {
    const id = /^apps\/([^/]+)\/package\.json$/.exec(file)?.[1];
    return id === undefined || id === "hub"
      ? []
      : [{ folder: `apps/${id}`, id, packageName: `@shkriuss/${id}` }];
  });
  return files.includes(`${TEMPLATE.folder}/package.json`)
    ? [...apps, { folder: TEMPLATE.folder, id: TEMPLATE.id, packageName: "@shkriuss/app-template" }]
    : apps;
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

function checkConfig(app: App, source: string): Violation[] {
  const file = `${app.folder}/app.config.ts`;
  const ids = [...source.matchAll(/^\s*id:\s*"([^"]*)",?$/gm)];
  if (ids.length !== 1) {
    return [{ file, message: 'app.config.ts must give the app\'s id once, as id: "<id>",.' }];
  }
  const [match] = ids;
  if (match?.[1] === app.id) {
    return [];
  }
  return [
    {
      file,
      line: lineOf(source, match?.index ?? 0),
      message: `The app's id must be "${app.id}", the name of its folder and its subdomain. App ids never change (CLAUDE.md, product rule 3).`,
    },
  ];
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
    const missing = APP_FILES.filter((file) => !present.has(`${app.folder}/${file}`));
    for (const file of missing) {
      violations.push({
        file: `${app.folder}/${file}`,
        message: "Every app has this file, as the app template does; create apps with create-app.",
      });
    }
    if (!files.some((file) => file.startsWith(`${app.folder}/e2e/`) && file.endsWith(".spec.ts"))) {
      violations.push({ file: `${app.folder}/e2e`, message: "Every app has end-to-end tests." });
    }
    const has = (file: string): boolean => present.has(`${app.folder}/${file}`);
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
