import { access, readFile, readdir } from "node:fs/promises";
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

export interface CollectOptions {
  /** The repository's root, which every file of its own lies in. */
  readonly root: string;
  /** The directory of the package with this name, for code that bundlers generate. */
  readonly packageOf: (name: string) => string;
}

/**
 * The licenses of a build, from the ids of the modules whose code it includes: every package of
 * others, from `node_modules` or generated by a bundler, and every legal comment in this
 * repository's own files. Throws for generated code of an unknown origin, and for a package
 * without a license file, so that a build never ships code without its license.
 */
export async function collectLicenses(
  modules: Iterable<string>,
  { root, packageOf }: CollectOptions,
): Promise<Licenses> {
  const packageDirectories = new Set<string>();
  const generators = new Set<string>();
  const ownFiles = new Set<string>();
  for (const id of modules) {
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
    } else if (path.relative(root, file).startsWith("..")) {
      throw new Error(`The build includes ${file}, which is neither a package nor in ${root}.`);
    } else {
      ownFiles.add(file);
    }
  }

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
