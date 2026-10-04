/**
 * Repository checks that linters and type checkers cannot do.
 *
 *   pnpm check                 run every check
 *   pnpm check doc-links html  run only the named checks
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { checkManifest, isWorkspaceManifest } from "./dependencies.ts";
import { checkDocLinks } from "./doc-links.ts";
import { checkHtml } from "./html.ts";
import { checkLicenses, parseLicensePolicy, readRuntimeLicenses } from "./licenses.ts";
import { formatViolation, type Violation } from "./report.ts";
import { listFiles, readText, repoRoot } from "./repo.ts";

interface Check {
  readonly description: string;
  readonly run: (files: readonly string[]) => Violation[];
}

const LICENSE_POLICY = "tooling/checks/license-policy.json";

const CHECKS: Readonly<Record<string, Check>> = {
  dependencies: {
    description: "package.json files are private, AGPL-3.0-only and take versions from the catalog",
    run: (files) =>
      files.filter(isWorkspaceManifest).flatMap((file) => checkManifest(file, readText(file))),
  },
  html: {
    description: "HTML files contain no inline scripts, styles, handlers or third-party resources",
    run: (files) =>
      files
        .filter((file) => file.endsWith(".html"))
        .flatMap((file) => checkHtml(file, readText(file))),
  },
  licenses: {
    description: "runtime dependencies have licenses compatible with AGPL-3.0-only",
    run: () =>
      checkLicenses(
        readRuntimeLicenses(repoRoot),
        parseLicensePolicy(readText(LICENSE_POLICY)),
        LICENSE_POLICY,
      ),
  },
  "doc-links": {
    description: "relative links and #anchors in Markdown files resolve",
    run: (files) => {
      const markdown = new Map(
        files.filter((file) => file.endsWith(".md")).map((file) => [file, readText(file)]),
      );
      return checkDocLinks({ markdown, exists: (file) => existsSync(path.join(repoRoot, file)) });
    },
  },
};

function main(names: readonly string[]): number {
  const unknown = names.filter((name) => !Object.hasOwn(CHECKS, name));
  if (unknown.length > 0) {
    console.error(
      `Unknown check: ${unknown.join(", ")}. Available: ${Object.keys(CHECKS).join(", ")}`,
    );
    return 2;
  }
  const selected = names.length > 0 ? names : Object.keys(CHECKS);
  const files = listFiles();
  let failed = false;
  for (const name of selected) {
    const check = CHECKS[name];
    if (check === undefined) {
      continue;
    }
    const violations = check.run(files);
    if (violations.length === 0) {
      console.log(`✓ ${name}: ${check.description}`);
      continue;
    }
    failed = true;
    console.log(`✗ ${name}: ${violations.length} problem(s)`);
    for (const violation of violations) {
      console.log(`  ${formatViolation(violation)}`);
    }
  }
  return failed ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
