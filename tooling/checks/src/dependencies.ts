import { isRecord, type Violation } from "./report.ts";

/**
 * Package manifest policy (ADR 0002, ADR 0007):
 * - every workspace package is private, so nothing is ever published by accident;
 * - every package carries the repository license;
 * - every dependency comes from the pnpm catalog (one version for the whole repo) or the workspace.
 */

export const REPO_LICENSE = "AGPL-3.0-only";

const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;

function isAllowedSpec(spec: string): boolean {
  return spec === "catalog:" || spec.startsWith("catalog:") || spec.startsWith("workspace:");
}

export function checkManifest(file: string, source: string): Violation[] {
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
  if (manifest["private"] !== true) {
    violations.push({
      file,
      message: 'Set "private": true; packages in this repository are never published.',
    });
  }
  if (manifest["license"] !== REPO_LICENSE) {
    violations.push({ file, message: `Set "license": "${REPO_LICENSE}".` });
  }

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (dependencies === undefined) {
      continue;
    }
    if (!isRecord(dependencies)) {
      violations.push({ file, message: `"${field}" must be an object.` });
      continue;
    }
    for (const [name, spec] of Object.entries(dependencies)) {
      if (typeof spec !== "string" || !isAllowedSpec(spec)) {
        violations.push({
          file,
          message: `${field}.${name} is "${String(spec)}"; use "catalog:" (add the version to pnpm-workspace.yaml) or "workspace:*".`,
        });
      }
    }
  }
  return violations;
}

/** The manifests this check applies to: the root and every workspace package. */
export function isWorkspaceManifest(file: string): boolean {
  return file === "package.json" || /^(?:apps|packages|tooling)\/[^/]+\/package\.json$/.test(file);
}
