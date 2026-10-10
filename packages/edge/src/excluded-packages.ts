import { readFile } from "node:fs/promises";
import path from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The name in the package.json of `directory`, if it has one with a name. */
async function manifestName(directory: string): Promise<string | undefined> {
  let source: string;
  try {
    source = await readFile(path.join(directory, "package.json"), "utf8");
  } catch {
    return undefined;
  }
  const json: unknown = JSON.parse(source);
  return isRecord(json) && typeof json["name"] === "string" ? json["name"] : undefined;
}

/**
 * The name of the package that the files of `directory` belong to: that of the nearest named
 * package.json, from `directory` up, or none. `names` keeps what each directory gave.
 */
async function packageNameOf(
  directory: string,
  names: Map<string, string | undefined>,
): Promise<string | undefined> {
  if (names.has(directory)) {
    return names.get(directory);
  }
  const parent = path.dirname(directory);
  const name =
    (await manifestName(directory)) ??
    (parent === directory ? undefined : await packageNameOf(parent, names));
  names.set(directory, name);
  return name;
}

/**
 * Throws if the build has the code of a package in `excluded`, by name: if one of `modules`, the
 * ids of the modules whose code the build includes, is a file of such a package. Code that
 * bundlers and plugins generate belongs to no package. An app without data excludes the packages
 * that keep data, so that its build cannot have their code, not even through another package.
 * The files that it names are relative to `root`, the repository's root.
 */
export async function assertExcludedPackages(
  modules: Iterable<string>,
  excluded: readonly string[],
  root: string,
): Promise<void> {
  if (excluded.length === 0) {
    return;
  }
  const names = new Map<string, string | undefined>();
  const found = new Map<string, string>();
  for (const id of modules) {
    if (id.startsWith("\0")) {
      continue;
    }
    const file = id.split("?", 1)[0] ?? id;
    const name = await packageNameOf(path.dirname(file), names);
    if (name !== undefined && excluded.includes(name) && !found.has(name)) {
      found.set(name, path.relative(root, file).split(path.sep).join("/"));
    }
  }
  if (found.size > 0) {
    const packages = [...found].map(([name, file]) => `${name} (${file})`);
    throw new Error(
      `The build has the code of ${packages.join(" and ")}, which this app excludes.`,
    );
  }
}

/**
 * Throws if the build has one of `files`, by absolute path: if one of `modules`, the ids of the
 * modules whose code the build includes, is such a file. An app without data excludes the
 * shell's text for apps with data, and so every part of the shell that shows it, though they
 * belong to a package that it has. The files that it names are relative to `root`, the
 * repository's root.
 */
export function assertExcludedFiles(
  modules: Iterable<string>,
  files: readonly string[],
  root: string,
): void {
  if (files.length === 0) {
    return;
  }
  const excluded = new Set(files.map((file) => path.resolve(file)));
  const found = new Set<string>();
  for (const id of modules) {
    if (id.startsWith("\0")) {
      continue;
    }
    const file = path.resolve(id.split("?", 1)[0] ?? id);
    if (excluded.has(file)) {
      found.add(path.relative(root, file).split(path.sep).join("/"));
    }
  }
  if (found.size > 0) {
    throw new Error(`The build has ${[...found].join(" and ")}, which this app excludes.`);
  }
}
