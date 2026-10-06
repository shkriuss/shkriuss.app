import { access, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

/** Where the source code of every app is, which its license file names. */
export const SOURCE_URL = "https://github.com/shkriuss/shkriuss.app";

/** The file in which every app lists the licenses of the software it includes. */
export const LICENSES_FILE = "licenses.txt";

/** A package of others whose code is in a build, with the texts that its license asks for. */
export interface ThirdPartyPackage {
  readonly name: string;
  readonly version: string;
  /** Its license, as its package.json states it. */
  readonly license: string;
  /** Its license files, such as LICENSE and NOTICE, by file name. */
  readonly files: readonly { readonly name: string; readonly text: string }[];
}

/** Material of others in a file of this repository, as the file's legal comment describes it. */
export interface Notice {
  /** The file, relative to the repository's root. */
  readonly file: string;
  /** Its legal comments, `/*! … *\/`, without their comment markers. */
  readonly text: string;
}

export interface Licenses {
  readonly packages: readonly ThirdPartyPackage[];
  readonly notices: readonly Notice[];
}

/**
 * The start of the ids of modules that this repository's own Vite plugins generate, such as the
 * hub's catalog of `@shkriuss/shell/vite`: this repository's code, under its license.
 */
export const OWN_GENERATED = "\0shkriuss:";

/** Code that bundlers generate, by the start of its module id, and the package it comes from. */
const GENERATED: readonly (readonly [string, string])[] = [
  ["\0vite/", "vite"],
  ["\0rolldown/", "rolldown"],
];

/** License files: LICENSE, LICENCE, COPYING, NOTICE and THIRD-PARTY-LICENSE, in any case. */
const LICENSE_FILE =
  /^(?:licen[cs]e|copying|notice|third[-_]party[-_]licen[cs]es?)(?:[-_.][\w.-]*)?$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** The directory of the package that `file` belongs to: the nearest with a named package.json. */
async function packageDirectory(file: string): Promise<string> {
  let directory = path.dirname(file);
  for (;;) {
    const manifest = path.join(directory, "package.json");
    if (await exists(manifest)) {
      const json: unknown = JSON.parse(await readFile(manifest, "utf8"));
      if (isRecord(json) && typeof json["name"] === "string") {
        return directory;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`${file} belongs to no package.`);
    }
    directory = parent;
  }
}

function plain(text: string): string {
  return text.replaceAll("\r\n", "\n").trim();
}

/** Where a bundler's license file starts to list the licenses of what it bundles for itself. */
const BUNDLED_DEPENDENCIES = /^#+ Licenses of bundled dependencies\s*$/im;

/**
 * A package of others, read from its directory. Throws if it has no license file. For code
 * that a bundler generates, `own` keeps only the bundler's own license, not the licenses of the
 * packages it bundles for its own use, which the generated code does not contain.
 */
async function readPackage(directory: string, own = false): Promise<ThirdPartyPackage> {
  const json: unknown = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (!isRecord(json) || typeof json["name"] !== "string" || typeof json["version"] !== "string") {
    throw new Error(`${directory}/package.json has no name and version.`);
  }
  const { name, version } = json;
  const license = typeof json["license"] === "string" ? json["license"] : "unknown";
  const names = (await readdir(directory)).filter((file) => LICENSE_FILE.test(file)).toSorted();
  if (names.length === 0) {
    throw new Error(`${name}@${version} has no license file, which its license may require.`);
  }
  const files = await Promise.all(
    names.map(async (file) => {
      const text = await readFile(path.join(directory, file), "utf8");
      return {
        name: file,
        text: plain(own ? (text.split(BUNDLED_DEPENDENCIES)[0] ?? text) : text),
      };
    }),
  );
  return { name, version, license, files };
}

/** The text of the legal comments in `source`, without their comment markers. */
export function legalComments(source: string): string {
  const comments: string[] = [];
  // A legal comment starts with "/*!" and ends at the first "*/" after it. Found with indexOf,
  // not a regular expression, so that even a file of comments that never end takes linear time.
  let start = source.indexOf("/*!");
  while (start !== -1) {
    const end = source.indexOf("*/", start + 3);
    if (end === -1) {
      break;
    }
    const text = plain(
      source
        .slice(start + 3, end)
        .split("\n")
        .map((line) => line.replace(/^\s*\* ?/, ""))
        .join("\n"),
    );
    if (text !== "") {
      comments.push(text);
    }
    start = source.indexOf("/*!", end + 2);
  }
  return comments.join("\n\n");
}

/** `css` without its comments, which may mention rules that are not there. */
function withoutComments(css: string): string {
  let kept = "";
  let index = 0;
  for (;;) {
    const start = css.indexOf("/*", index);
    if (start === -1) {
      return kept + css.slice(index);
    }
    kept += css.slice(index, start);
    const end = css.indexOf("*/", start + 2);
    if (end === -1) {
      return kept;
    }
    index = end + 2;
  }
}

/** The index of the first character of `css` from `index` on that is not white space. */
function skipSpace(css: string, index: number): number {
  let at = index;
  while (/\s/.test(css.charAt(at))) {
    at += 1;
  }
  return at;
}

/**
 * What the `@import` and `@plugin` rules of a stylesheet name, quoted or in `url()`, quoted or
 * not, outside its comments. Found with indexOf, not a regular expression, so that it takes linear time.
 */
export function stylesheetImports(css: string): string[] {
  const source = withoutComments(css);
  const specifiers: string[] = [];
  for (const rule of ["@import", "@plugin"]) {
    for (let index = source.indexOf(rule); index !== -1; index = source.indexOf(rule, index + 1)) {
      let at = skipSpace(source, index + rule.length);
      const url = source.startsWith("url(", at);
      if (url) {
        at = skipSpace(source, at + 4);
      }
      const quote = source.charAt(at);
      if (quote === '"' || quote === "'") {
        const end = source.indexOf(quote, at + 1);
        if (end !== -1) {
          specifiers.push(source.slice(at + 1, end));
        }
      } else if (url) {
        const end = source.indexOf(")", at);
        if (end !== -1) {
          specifiers.push(source.slice(at, end).trim());
        }
      }
    }
  }
  return specifiers;
}

/** The package that a bare specifier such as `@scope/name/file.css` imports from. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return (specifier.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1)).join("/");
}

/** The real directory of the package `name`, found from `file` as Node.js finds packages. */
async function installedPackage(file: string, name: string): Promise<string> {
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, "node_modules", name);
    if (await exists(path.join(candidate, "package.json"))) {
      return realpath(candidate);
    }
    if (path.dirname(directory) === directory) {
      throw new Error(`${file} imports ${name}, which is not installed.`);
    }
  }
}

function isInside(directory: string, file: string): boolean {
  return !path.relative(directory, file).startsWith("..");
}

/**
 * Follows the imports of this repository's stylesheets, which the build inlines, so that its
 * modules do not show them: adds the packages they import to `packages`, and the stylesheets
 * of the repository they import, and those that these import, to `files`.
 */
async function followStylesheets(
  root: string,
  files: Set<string>,
  packages: Set<string>,
): Promise<void> {
  const queue = [...files].filter((file) => file.endsWith(".css"));
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const specifier of stylesheetImports(await readFile(file, "utf8"))) {
      const from = path.relative(root, file);
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const imported = path.resolve(path.dirname(file), specifier);
        if (!isInside(root, imported)) {
          throw new Error(`${from} imports ${specifier}, which is outside ${root}.`);
        }
        if (!files.has(imported)) {
          files.add(imported);
          queue.push(imported);
        }
      } else if (/^[@a-z0-9]/i.test(specifier) && !specifier.includes(":")) {
        const directory = await installedPackage(file, packageName(specifier));
        if (!directory.split(path.sep).includes("node_modules")) {
          throw new Error(
            `${from} imports ${specifier}, a package of this repository. Import its stylesheet from a script instead, so that the build lists it.`,
          );
        }
        packages.add(directory);
      } else {
        throw new Error(
          `${from} imports ${specifier}, which is neither a package nor a file of the repository.`,
        );
      }
    }
  }
}

export interface CollectOptions {
  /** The repository's root, which every file of its own lies in. */
  readonly root: string;
  /** The directory of the package with this name, for code that bundlers generate. */
  readonly packageOf: (name: string) => string;
}

/**
 * The licenses of a build, from the ids of the modules whose code it includes: every package of
 * others, from `node_modules` or generated by a bundler, and every legal comment in this
 * repository's own files. The imports of its stylesheets count too, though the build inlines
 * them. Modules that this repository's plugins generate (`OWN_GENERATED`) are its own code.
 * Throws for generated code of an unknown origin, for a package without a license file and for
 * a stylesheet import it cannot follow, so that a build never ships code without its license.
 */
export async function collectLicenses(
  modules: Iterable<string>,
  { root, packageOf }: CollectOptions,
): Promise<Licenses> {
  const packageDirectories = new Set<string>();
  const generators = new Set<string>();
  const ownFiles = new Set<string>();
  for (const id of modules) {
    if (id.startsWith(OWN_GENERATED)) {
      continue;
    }
    if (id.startsWith("\0")) {
      const generator = GENERATED.find(([prefix]) => id.startsWith(prefix));
      if (generator === undefined) {
        throw new Error(`The build includes generated code of unknown origin: ${id.slice(1)}.`);
      }
      generators.add(packageOf(generator[1]));
      continue;
    }
    const file = id.split("?", 1)[0] ?? id;
    if (file.split(path.sep).includes("node_modules")) {
      packageDirectories.add(await packageDirectory(file));
    } else if (!isInside(root, file)) {
      throw new Error(`The build includes ${file}, which is neither a package nor in ${root}.`);
    } else {
      ownFiles.add(file);
    }
  }

  await followStylesheets(root, ownFiles, packageDirectories);
  const packages = await Promise.all([
    ...[...packageDirectories].map(async (directory) => readPackage(directory)),
    ...[...generators]
      .filter((directory) => !packageDirectories.has(directory))
      .map(async (directory) => readPackage(directory, true)),
  ]);
  const notices: Notice[] = [];
  for (const file of [...ownFiles].toSorted()) {
    const text = legalComments(await readFile(file, "utf8"));
    if (text !== "") {
      notices.push({ file: path.relative(root, file).split(path.sep).join("/"), text });
    }
  }
  return {
    packages: packages.toSorted(
      (a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"),
    ),
    notices,
  };
}

const RULE = "=".repeat(80);

/**
 * The license file of an app (`app` its id) or of the hub: that it is free software and where its
 * source is, then the license texts of every package of others and every notice that it
 * includes.
 */
export function licensesFile(app: string | undefined, { packages, notices }: Licenses): string {
  const name = app === undefined ? "shkriuss.app" : `${app}.shkriuss.app`;
  const sections = [
    [
      `Licenses of ${name}`,
      "",
      `${name} is free software under the GNU Affero General Public License, version 3 only`,
      `(AGPL-3.0-only). Its source code is at ${SOURCE_URL}.`,
      "",
      "It includes the following software and material of others, under their own licenses.",
    ].join("\n"),
    ...packages.map((thirdParty) =>
      [
        RULE,
        `${thirdParty.name} ${thirdParty.version} (${thirdParty.license})`,
        RULE,
        ...thirdParty.files.flatMap((file) => ["", `--- ${file.name} ---`, "", file.text]),
      ].join("\n"),
    ),
    ...notices.map((notice) =>
      [RULE, `Material in ${notice.file}`, RULE, "", notice.text].join("\n"),
    ),
  ];
  return `${sections.join("\n\n")}\n`;
}
