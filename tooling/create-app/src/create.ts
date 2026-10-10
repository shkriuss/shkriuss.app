import { PRODUCTION_DOMAIN, STAGING_DOMAIN, appHost, assertAppId } from "@shkriuss/edge";

/**
 * What `create-app` makes of an app template (architecture §6): the files of a new app, which
 * are the template's with the app's id, names, accent color and test port, and the README and
 * the Cloudflare configuration of its own.
 */

/** What a new app is. */
export interface NewApp {
  /**
   * The app's permanent id: its subdomain, its folder in `apps/`, and the app that its backups
   * belong to. It never changes, and is never used again (`CLAUDE.md`, product rule 3).
   */
  readonly id: string;
  /** The app's name, as its frame, its page's title and installed apps show it. */
  readonly name: string;
  /** The name under the icon on a home screen: at most 12 characters; the name if left out. */
  readonly shortName?: string;
  /** What the app does, in one sentence. */
  readonly description: string;
  /** The color of the app's icons, as `#rrggbb`; the template's if left out. */
  readonly accent?: string;
  /**
   * Whether the app keeps data, in a database that backups save, as most apps do: true if left
   * out. An app without data starts from the template without data.
   */
  readonly keepsData?: boolean;
}

/** The app template, relative to the repository's root. */
export const TEMPLATE = "tooling/app-template";

/** The app template without data: no database, no backups. */
export const TEMPLATE_WITHOUT_DATA = "tooling/app-template-no-data";

/** The template that `app` starts from, relative to the repository's root. */
export function templateOf(app: NewApp): string {
  return app.keepsData === false ? TEMPLATE_WITHOUT_DATA : TEMPLATE;
}

/** The test servers of apps listen from this port up, those of the platform's tests below it. */
export const FIRST_APP_PORT = 4200;

/** The longest short name that home screens show whole under an icon, as `@shkriuss/pwa` has it. */
const SHORT_NAME_LENGTH = 12;

/** What builds and tests leave in the template's folder, which a new app does not get. */
const LEFT_BY_TOOLS = new Set([
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
  ".wrangler",
]);

/** The template's files that `create-app` writes itself for the app. */
const WRITTEN = new Set(["README.md", "wrangler.json"]);

function graphemes(text: string): number {
  return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].length;
}

/** Throws unless `text` is one line of text, as names and descriptions are. */
function assertLine(text: string, what: string): void {
  if (text.trim() === "" || text !== text.trim() || /\p{Cc}/v.test(text)) {
    throw new Error(`The ${what} must be one line of text, without spaces around it.`);
  }
}

/** Throws unless `app` can be an app: a valid id, names that fit, and a color. */
export function checkNewApp(app: NewApp): void {
  assertAppId(app.id);
  assertLine(app.name, "name");
  assertLine(app.description, "description");
  const shortName = app.shortName ?? app.name;
  assertLine(shortName, "short name");
  if (graphemes(shortName) > SHORT_NAME_LENGTH) {
    throw new Error(
      `"${shortName}" is longer than ${SHORT_NAME_LENGTH} characters, which home screens cut short: give a short name of at most ${SHORT_NAME_LENGTH}.`,
    );
  }
  if (app.accent !== undefined && !/^#[0-9a-f]{6}$/v.test(app.accent)) {
    throw new Error(
      `The accent color must be written as #rrggbb, in lowercase, not "${app.accent}".`,
    );
  }
}

/** What the repository says about a new app's id, which `create-app` asks git and the disk. */
export interface IdFacts {
  /** Whether `apps/<id>` exists. */
  readonly exists: boolean;
  /** Whether `apps/<id>` is anywhere in the history that the clone has. */
  readonly existedBefore: boolean;
  /** Whether the clone has only part of the history, which may lack an app that was removed. */
  readonly shallow: boolean;
  /** The names of the workspace's packages, such as `@shkriuss/ui`. */
  readonly packages: ReadonlySet<string>;
}

/**
 * Why `id` cannot be a new app's, or undefined if it can: an id is never used again (`CLAUDE.md`,
 * product rule 3), and an app's package name, `@shkriuss/<id>`, must be its own.
 */
export function idProblem(id: string, facts: IdFacts): string | undefined {
  const folder = `apps/${id}`;
  if (facts.exists) {
    return `${folder} exists already.`;
  }
  if (facts.packages.has(`@shkriuss/${id}`)) {
    return `@shkriuss/${id} is a package of the workspace already: choose another id.`;
  }
  if (facts.shallow) {
    return `This clone has only part of the repository's history, so it cannot tell whether an app had the id ${id} before. Fetch the rest with git fetch --unshallow, then try again.`;
  }
  if (facts.existedBefore) {
    return `${folder} existed before: an app's id is never used again (CLAUDE.md, product rule 3).`;
  }
  return undefined;
}

/** Whether a file of the template, by its path in the template's folder, goes into a new app. */
export function isCopied(file: string): boolean {
  return !LEFT_BY_TOOLS.has(file.split("/")[0] ?? "") && !WRITTEN.has(file);
}

/** The first port from `FIRST_APP_PORT` up that no test server uses yet. */
export function nextPort(used: readonly number[]): number {
  let port = FIRST_APP_PORT;
  while (used.includes(port)) {
    port += 1;
  }
  return port;
}

/** The JSON object in a file of the template. */
function objectIn(source: string, file: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The template's ${file} must hold a JSON object.`);
  }
  return { ...value };
}

/** `text` as a string in TypeScript or JSON. */
function literal(text: string): string {
  return JSON.stringify(text);
}

/**
 * Replaces the one string that `pattern` finds after its first group, in a file of the
 * template. It throws if the pattern finds none or more than one: the template has changed in
 * a way that `create-app` must follow.
 */
function replaceString(source: string, pattern: RegExp, value: string, file: string): string {
  const matches = [...source.matchAll(new RegExp(pattern, "gm"))];
  if (matches.length !== 1) {
    throw new Error(`The template's ${file} must have exactly one match of ${pattern}.`);
  }
  return source.replace(pattern, (_match, before: string) => `${before}${value}`);
}

/** A file of the template, as it is in the new app. */
function transform(file: string, source: string, app: NewApp, port: number): string {
  switch (file) {
    case "package.json": {
      return `${JSON.stringify({ ...objectIn(source, file), name: `@shkriuss/${app.id}` }, null, 2)}\n`;
    }
    case "app.config.ts": {
      const withId = replaceString(source, /^(\s*id: )"[^"]*"/m, literal(app.id), file);
      return app.accent === undefined
        ? withId
        : replaceString(withId, /^(\s*accent: )"[^"]*"/m, literal(app.accent), file);
    }
    case "src/messages.ts": {
      const string = String.raw`"(?:[^"\\]|\\.)*"`;
      let messages = source;
      for (const [message, value] of [
        ["appName", app.name],
        ["appShortName", app.shortName ?? app.name],
        ["appDescription", app.description],
      ] as const) {
        messages = replaceString(
          messages,
          new RegExp(String.raw`^(\s*${message}: \(\) =>\s*)${string}`, "m"),
          literal(value),
          file,
        );
      }
      return messages;
    }
    case "playwright.config.ts":
      return replaceString(source, /^(.*\bport: )\d+/m, String(port), file);
    default:
      return source;
  }
}

/** The new app's README. */
function readme(app: NewApp): string {
  const name = `@shkriuss/${app.id}`;
  const id =
    app.keepsData === false
      ? "it is the app's subdomain and folder"
      : "it is the app's subdomain and folder, and the app that its backups belong to";
  const template =
    app.keepsData === false
      ? `the [app template without data](../../${TEMPLATE_WITHOUT_DATA}/README.md)`
      : `the [app template](../../${TEMPLATE}/README.md)`;
  return `# ${app.name}

${app.description}

- **Address:** \`https://${appHost(PRODUCTION_DOMAIN, app.id)}\`, and \`https://${appHost(STAGING_DOMAIN, app.id)}\` for staging.
- **Id:** \`${app.id}\`, which never changes: ${id}.
- **Made** with \`create-app\` from ${template}, which says what each file is.

| Command | What it does |
| --- | --- |
| \`pnpm --filter ${name} dev\` | Development server, without the production headers and the service worker |
| \`pnpm --filter ${name} build\` | Production build in \`dist/\` |
| \`pnpm --filter ${name} e2e\` | End-to-end tests against the build, served by Wrangler with the real headers |
`;
}

/**
 * The new app's Cloudflare configuration, as the repository's checks require it (ADR 0017):
 * static assets only, staging and production each on the app's subdomain, never `workers.dev`.
 * It keeps the template's settings for the assets and Wrangler.
 */
function wranglerConfig(app: NewApp, template: string): string {
  const base = objectIn(template, "wrangler.json");
  const environment = (name: string, domain: string) => ({
    name: `shkriuss-${app.id}-${name}`,
    routes: [{ pattern: appHost(domain, app.id), custom_domain: true }],
    workers_dev: false,
    preview_urls: false,
  });
  return `${JSON.stringify(
    {
      ...base,
      name: `shkriuss-${app.id}`,
      env: {
        staging: environment("staging", STAGING_DOMAIN),
        production: environment("production", PRODUCTION_DOMAIN),
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * The files of the new app, by their path in the repository, from the files of its template, as
 * from `templateOf()`, by their path in its folder. `port` is its test server's, as from
 * `nextPort()`.
 */
export function appFiles(
  app: NewApp,
  template: ReadonlyMap<string, string>,
  port: number,
): Map<string, string> {
  checkNewApp(app);
  const folder = `apps/${app.id}`;
  const files = new Map<string, string>();
  for (const [file, source] of template) {
    if (isCopied(file)) {
      files.set(`${folder}/${file}`, transform(file, source, app, port));
    }
  }
  const wrangler = template.get("wrangler.json");
  if (wrangler === undefined) {
    throw new Error("The template has no wrangler.json, which the new app's starts from.");
  }
  files.set(`${folder}/wrangler.json`, wranglerConfig(app, wrangler));
  files.set(`${folder}/README.md`, readme(app));
  return files;
}
