import path from "node:path";
import type { Violation } from "./report.ts";

/**
 * The pnpm settings that ADR 0007 decides, and what could undo them: a catalog or override
 * entry that points at a git repository or a tarball instead of a version, a patch, an install
 * script allowed, or a `.npmrc` or pnpmfile that changes what pnpm installs.
 *
 * `pnpm-workspace.yaml` is read line by line, as its top-level keys and the entries indented
 * under them. That covers the file as it is written, one key per line, with comments; it is not a
 * YAML parser, and a flow mapping (`key: { … }`) is refused, so that nothing hides in one.
 */

export const WORKSPACE_FILE = "pnpm-workspace.yaml";

/** The settings of ADR 0007, and the value each must have. */
const REQUIRED_SETTINGS: Readonly<Record<string, string>> = {
  trustPolicy: "no-downgrade",
  blockExoticSubdeps: "true",
  strictDepBuilds: "true",
  engineStrict: "true",
};
/** `minimumReleaseAge` is in minutes; ADR 0007 asks for at least three days. */
const MINIMUM_RELEASE_AGE = 3 * 24 * 60;

/** Keys that list versions: each entry is an exact version, a `^` or `~` range or a catalog reference. */
const VERSION_SECTIONS = ["catalog", "catalogs", "overrides"];
/** Keys that are not allowed at all, with the reason. */
const FORBIDDEN_KEYS: Readonly<Record<string, string>> = {
  patchedDependencies:
    "patchedDependencies is not allowed; a patch changes what a dependency runs. Fix it upstream, or record the exception in an ADR (ADR 0007).",
  pnpmfile: "pnpmfile is not allowed; its hooks change what pnpm installs (ADR 0007).",
  onlyBuiltDependencies:
    "onlyBuiltDependencies is not allowed; install scripts stay blocked (ADR 0007).",
  dangerouslyAllowAllBuilds:
    "dangerouslyAllowAllBuilds is not allowed; install scripts stay blocked (ADR 0007).",
};
/** Packages whose install scripts an ADR allows; none so far. */
const ALLOWED_BUILDS: ReadonlySet<string> = new Set<string>();

const VERSION =
  /^(?:[\^~]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?|catalog:[\w.-]*)$/;

/** Files that configure pnpm outside `pnpm-workspace.yaml`, by their name. */
const PNPM_FILES: Readonly<Record<string, string>> = {
  ".npmrc":
    ".npmrc is not allowed; pnpm's settings live in pnpm-workspace.yaml, where `pnpm check` reads them (ADR 0007).",
  ".pnpmfile.cjs": "A pnpmfile is not allowed; its hooks change what pnpm installs (ADR 0007).",
  ".pnpmfile.mjs": "A pnpmfile is not allowed; its hooks change what pnpm installs (ADR 0007).",
  ".pnpmfile.js": "A pnpmfile is not allowed; its hooks change what pnpm installs (ADR 0007).",
};

export interface Entry {
  /** The key, unquoted; `-` for a list item. */
  readonly key: string;
  /** The value on the key's line, unquoted and without its comment; empty for a nested mapping. */
  readonly value: string;
  readonly line: number;
}

export interface Section extends Entry {
  /** Every entry indented under the key, at any depth, in order. */
  readonly entries: readonly Entry[];
}

const KEY_LINE = /^( *)(?:"([^"]*)"|'([^']*)'|([^\s"'#-][^:]*?))\s*:(?:\s+(.*))?$/;
const LIST_LINE = /^( *)-(?:\s+(.*))?$/;

/** A YAML scalar without its trailing comment or quotes. */
function scalar(raw: string): string {
  const unquoted = raw.replace(/\s+#.*$/, "").trim();
  const quoted = /^"([^"]*)"$|^'([^']*)'$/.exec(unquoted);
  return quoted === null ? unquoted : (quoted[1] ?? quoted[2] ?? "");
}

/** The top-level keys of a workspace file, each with the entries indented under it. */
export function readSections(source: string): Section[] {
  const sections: Section[] = [];
  let entries: Entry[] = [];
  source.split("\n").forEach((text, index) => {
    if (/^\s*(?:#|$)/.test(text)) {
      return;
    }
    const line = index + 1;
    const key = KEY_LINE.exec(text);
    const item = LIST_LINE.exec(text);
    const entry: Entry | undefined =
      key === null
        ? item === null
          ? undefined
          : { key: "-", value: scalar(item[2] ?? ""), line }
        : { key: key[2] ?? key[3] ?? (key[4] ?? "").trim(), value: scalar(key[5] ?? ""), line };
    if (entry === undefined) {
      return;
    }
    if (key !== null && (key[1] ?? "").length === 0) {
      entries = [];
      sections.push({ ...entry, entries });
    } else {
      entries.push(entry);
    }
  });
  return sections;
}

export function checkWorkspaceConfig(file: string, source: string): Violation[] {
  const sections = readSections(source);
  const violations: Violation[] = [];
  const report = (line: number | undefined, message: string): void => {
    violations.push(line === undefined ? { file, message } : { file, line, message });
  };

  for (const [key, expected] of Object.entries(REQUIRED_SETTINGS)) {
    const section = sections.find((candidate) => candidate.key === key);
    if (section === undefined) {
      report(undefined, `Set ${key}: ${expected} (ADR 0007).`);
    } else if (section.value !== expected) {
      report(section.line, `${key} is "${section.value}"; ADR 0007 requires ${expected}.`);
    }
  }
  const age = sections.find((section) => section.key === "minimumReleaseAge");
  if (age === undefined) {
    report(undefined, `Set minimumReleaseAge: ${MINIMUM_RELEASE_AGE} (three days, ADR 0007).`);
  } else if (!/^\d+$/.test(age.value) || Number(age.value) < MINIMUM_RELEASE_AGE) {
    report(
      age.line,
      `minimumReleaseAge is "${age.value}"; ADR 0007 requires at least ${MINIMUM_RELEASE_AGE} (three days).`,
    );
  }

  for (const section of sections) {
    const forbidden = FORBIDDEN_KEYS[section.key];
    if (forbidden !== undefined) {
      report(section.line, forbidden);
    }
    if (VERSION_SECTIONS.includes(section.key)) {
      if (section.value !== "") {
        report(section.line, `Write ${section.key} as a mapping, one entry per line.`);
      }
      for (const entry of section.entries) {
        if (entry.key === "-") {
          report(entry.line, `${section.key} is a mapping of names to versions, not a list.`);
        } else if (entry.value !== "" && !VERSION.test(entry.value)) {
          report(
            entry.line,
            `${section.key}.${entry.key} is "${entry.value}"; use an exact version, a ^ or ~ range, or a catalog: reference, never a URL, a file or a tag (ADR 0007).`,
          );
        }
      }
    }
    if (section.key === "allowBuilds") {
      if (section.value !== "" && section.value !== "{}") {
        report(section.line, "Write allowBuilds as a mapping, one package per line.");
      }
      for (const entry of section.entries) {
        if (entry.value !== "false" && !ALLOWED_BUILDS.has(entry.key)) {
          report(
            entry.line,
            `allowBuilds.${entry.key} is "${entry.value}"; install scripts stay blocked (ADR 0007). An exception needs the maintainer's review, an ADR, and a place in tooling/checks/src/workspace.ts.`,
          );
        }
      }
    }
  }
  return violations;
}

/** Files that would configure pnpm outside `pnpm-workspace.yaml`, anywhere in the repository. */
export function pnpmConfigFiles(files: readonly string[]): Violation[] {
  return files.flatMap((file) => {
    const message = PNPM_FILES[path.posix.basename(file)];
    return message === undefined ? [] : [{ file, message }];
  });
}

export function checkWorkspace(
  files: readonly string[],
  read: (file: string) => string,
): Violation[] {
  const config = files.includes(WORKSPACE_FILE)
    ? checkWorkspaceConfig(WORKSPACE_FILE, read(WORKSPACE_FILE))
    : [{ file: WORKSPACE_FILE, message: "Missing; it holds pnpm's settings (ADR 0007)." }];
  return [...config, ...pnpmConfigFiles(files)];
}
