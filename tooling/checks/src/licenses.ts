import { execFileSync } from "node:child_process";
import { isRecord, type Violation } from "./report.ts";

/**
 * License policy for runtime dependencies (ADR 0002). Runtime dependencies ship to users inside
 * the AGPL-3.0-only apps, so their licenses must be compatible. Development-only dependencies
 * are not distributed and are not checked.
 */

export interface LicensePolicy {
  /** SPDX license identifiers that are always acceptable. */
  readonly allowed: readonly string[];
  /** Reviewed exceptions, keyed by `name@version`, with the reason as the value. */
  readonly exceptions: Readonly<Record<string, string>>;
}

export type SpdxNode =
  | { readonly kind: "license"; readonly id: string }
  | { readonly kind: "with"; readonly license: SpdxNode; readonly exception: string }
  | { readonly kind: "and" | "or"; readonly left: SpdxNode; readonly right: SpdxNode };

const TOKEN = /\s*(\(|\)|[A-Za-z0-9.+:-]+)/y;

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < expression.length) {
    if (expression.slice(TOKEN.lastIndex).trim() === "") {
      break;
    }
    const match = TOKEN.exec(expression);
    if (match?.[1] === undefined) {
      throw new Error(`Unexpected character in license expression "${expression}"`);
    }
    tokens.push(match[1]);
  }
  return tokens;
}

/**
 * Parses an SPDX license expression such as `(MIT OR Apache-2.0) AND BSD-3-Clause`.
 * `AND` binds tighter than `OR`; operators are case-insensitive. Throws on invalid input.
 */
export function parseSpdx(expression: string): SpdxNode {
  const tokens = tokenize(expression);
  let position = 0;

  const peekOperator = (): string | undefined => tokens[position]?.toUpperCase();

  const parseAtom = (): SpdxNode => {
    const token = tokens[position];
    if (token === undefined) {
      throw new Error(`Unexpected end of license expression "${expression}"`);
    }
    position += 1;
    if (token === "(") {
      const inner = parseOr();
      if (tokens[position] !== ")") {
        throw new Error(`Missing ")" in license expression "${expression}"`);
      }
      position += 1;
      return inner;
    }
    if (token === ")" || ["AND", "OR", "WITH"].includes(token.toUpperCase())) {
      throw new Error(`Unexpected "${token}" in license expression "${expression}"`);
    }
    return { kind: "license", id: token };
  };

  const parseWith = (): SpdxNode => {
    const license = parseAtom();
    if (peekOperator() === "WITH") {
      position += 1;
      const exception = tokens[position];
      if (exception === undefined || exception === "(" || exception === ")") {
        throw new Error(`Missing exception after WITH in license expression "${expression}"`);
      }
      position += 1;
      return { kind: "with", license, exception };
    }
    return license;
  };

  const parseAnd = (): SpdxNode => {
    let left = parseWith();
    while (peekOperator() === "AND") {
      position += 1;
      left = { kind: "and", left, right: parseWith() };
    }
    return left;
  };

  const parseOr = (): SpdxNode => {
    let left = parseAnd();
    while (peekOperator() === "OR") {
      position += 1;
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  };

  const tree = parseOr();
  if (position !== tokens.length) {
    throw new Error(`Unexpected "${tokens[position] ?? ""}" in license expression "${expression}"`);
  }
  return tree;
}

function evaluate(node: SpdxNode, allowed: ReadonlySet<string>): boolean {
  switch (node.kind) {
    case "license":
      return allowed.has(node.id);
    case "with":
      // An exception only adds permissions to the base license.
      return evaluate(node.license, allowed);
    case "and":
      return evaluate(node.left, allowed) && evaluate(node.right, allowed);
    case "or":
      return evaluate(node.left, allowed) || evaluate(node.right, allowed);
    default: {
      const unexpected: never = node;
      throw new Error(`Unknown license expression node: ${JSON.stringify(unexpected)}`);
    }
  }
}

/** Whether an SPDX expression can be satisfied with allowed licenses only. Invalid → false. */
export function isLicenseAllowed(expression: string, allowed: ReadonlySet<string>): boolean {
  try {
    return evaluate(parseSpdx(expression), allowed);
  } catch {
    return false;
  }
}

export interface LicensedPackage {
  readonly name: string;
  readonly versions: readonly string[];
  readonly license: string;
}

/** Parses the output of `pnpm licenses list --json`, which groups packages by license. */
export function parseLicenseReport(output: string): LicensedPackage[] {
  const trimmed = output.trim();
  if (trimmed === "" || trimmed.startsWith("No licenses")) {
    return [];
  }
  const report: unknown = JSON.parse(trimmed);
  if (!isRecord(report)) {
    throw new Error("Unexpected `pnpm licenses` output: expected an object.");
  }
  const packages: LicensedPackage[] = [];
  for (const [groupLicense, entries] of Object.entries(report)) {
    if (!Array.isArray(entries)) {
      throw new Error(`Unexpected \`pnpm licenses\` output for "${groupLicense}".`);
    }
    for (const entry of entries) {
      if (
        !isRecord(entry) ||
        typeof entry["name"] !== "string" ||
        !Array.isArray(entry["versions"])
      ) {
        throw new Error(`Unexpected \`pnpm licenses\` entry under "${groupLicense}".`);
      }
      const versions = entry["versions"].filter(
        (version): version is string => typeof version === "string",
      );
      const license = typeof entry["license"] === "string" ? entry["license"] : groupLicense;
      packages.push({ name: entry["name"], versions, license });
    }
  }
  return packages;
}

export function checkLicenses(
  packages: readonly LicensedPackage[],
  policy: LicensePolicy,
  policyFile: string,
): Violation[] {
  const allowed = new Set(policy.allowed);
  const violations: Violation[] = [];
  for (const pkg of packages) {
    if (isLicenseAllowed(pkg.license, allowed)) {
      continue;
    }
    for (const version of pkg.versions) {
      const key = `${pkg.name}@${version}`;
      if (Object.hasOwn(policy.exceptions, key)) {
        continue;
      }
      violations.push({
        file: policyFile,
        message: `Runtime dependency ${key} has license "${pkg.license}", which is not allowed. Replace it, or review it and add a reasoned exception for "${key}".`,
      });
    }
  }
  return violations;
}

export function parseLicensePolicy(source: string): LicensePolicy {
  const invalid = new Error(
    'License policy needs "allowed" (string[]) and "exceptions" ({ "name@version": "reason" }).',
  );
  const policy: unknown = JSON.parse(source);
  if (!isRecord(policy) || !Array.isArray(policy["allowed"]) || !isRecord(policy["exceptions"])) {
    throw invalid;
  }
  const rawAllowed: unknown[] = policy["allowed"];
  const allowed = rawAllowed.filter((id): id is string => typeof id === "string");
  const exceptions: Record<string, string> = {};
  for (const [key, reason] of Object.entries(policy["exceptions"])) {
    if (typeof reason !== "string" || reason.trim() === "") {
      throw invalid;
    }
    exceptions[key] = reason;
  }
  if (allowed.length !== rawAllowed.length) {
    throw invalid;
  }
  return { allowed, exceptions };
}

/** Runs `pnpm licenses list` for runtime dependencies of every workspace package. */
export function readRuntimeLicenses(root: string): LicensedPackage[] {
  const output = execFileSync("pnpm", ["licenses", "list", "--prod", "--json", "--recursive"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseLicenseReport(output);
}
