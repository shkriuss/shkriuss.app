import path from "node:path";
import { isRecord, lineOf, type Violation } from "./report.ts";

/**
 * Code reaches another package only through that package's public entry points, by its name,
 * and nothing imports an app (`CLAUDE.md`, structure rule 1; architecture §5). A package's
 * `exports` already refuse any other path through its name; this check adds what they cannot
 * see: relative imports that leave their package, and imports of an app by its name.
 */

/** Source files whose imports are checked. */
const SOURCE = /\.(?:[cm]?[jt]s|tsx)$/;

/** The specifiers of a module's imports and re-exports, static and dynamic, with their offsets. */
export function importsOf(source: string): { readonly specifier: string; readonly at: number }[] {
  const patterns = [
    // import … from "x", export … from "x", across the lines that Prettier breaks them into.
    /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"/gm,
    // import "x", for its side effects.
    /^[ \t]*import\s*"([^"]+)"/gm,
    // import("x")
    /\bimport\(\s*"([^"]+)"\s*\)/g,
  ];
  return patterns
    .flatMap((pattern) =>
      [...source.matchAll(pattern)].map((match) => ({
        specifier: match[1] ?? "",
        at: match.index + match[0].lastIndexOf(`"${match[1] ?? ""}"`),
      })),
    )
    .toSorted((a, b) => a.at - b.at);
}

/** The workspace packages: their folders, and the names of those that are apps. */
function workspaceOf(
  files: readonly string[],
  read: (file: string) => string,
): { readonly roots: string[]; readonly apps: Map<string, string> } {
  const manifests = files.filter((file) =>
    /^(?:apps|packages|tooling)\/[^/]+\/package\.json$/.test(file),
  );
  const apps = new Map<string, string>();
  for (const manifest of manifests.filter((file) => file.startsWith("apps/"))) {
    const parsed: unknown = JSON.parse(read(manifest));
    if (isRecord(parsed) && typeof parsed["name"] === "string") {
      apps.set(parsed["name"], path.posix.dirname(manifest));
    }
  }
  return { roots: manifests.map((manifest) => path.posix.dirname(manifest)), apps };
}

export function checkImports(
  files: readonly string[],
  read: (file: string) => string,
): Violation[] {
  const { roots, apps } = workspaceOf(files, read);
  const violations: Violation[] = [];
  for (const root of roots) {
    for (const file of files.filter(
      (candidate) => candidate.startsWith(`${root}/`) && SOURCE.test(candidate),
    )) {
      const source = read(file);
      for (const { specifier, at } of importsOf(source)) {
        const line = lineOf(source, at);
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          const target = path.posix.join(path.posix.dirname(file), specifier.split("?")[0] ?? "");
          if (!target.startsWith(`${root}/`)) {
            violations.push({
              file,
              line,
              message: `"${specifier}" leaves ${root}: import other packages by their name, through their entry points.`,
            });
          }
          continue;
        }
        const name = /^(@shkriuss\/[^/]+)/.exec(specifier)?.[1];
        const app = name === undefined ? undefined : apps.get(name);
        if (app !== undefined && app !== root) {
          violations.push({
            file,
            line,
            message: `"${specifier}" is an app, which nothing imports: shared code goes into packages/.`,
          });
        }
      }
    }
  }
  return violations;
}
