/**
 * Repository checks that linters and type checkers cannot do.
 *
 *   pnpm check                 run every check
 *   pnpm check doc-links html  run only the named checks
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { checkCode } from "./code.ts";
import { checkManifest, isWorkspaceManifest } from "./dependencies.ts";
import { checkDocLinks } from "./doc-links.ts";
import { checkHtml } from "./html.ts";
import { checkImports } from "./imports.ts";
import { checkLicenses, parseLicensePolicy, readRuntimeLicenses } from "./licenses.ts";
import { checkMarkdown, parseMarkdownConfig } from "./markdown.ts";
import { formatViolation, type Violation } from "./report.ts";
import { listFiles, readText, repoRoot } from "./repo.ts";
import { checkAppStructure } from "./structure.ts";
import { checkWorkspace } from "./workspace.ts";
import { checkWranglerConfig, isWranglerConfig, missingWranglerConfigs } from "./wrangler.ts";

interface Check {
  readonly description: string;
  readonly run: (files: readonly string[]) => Violation[];
}

const LICENSE_POLICY = "tooling/checks/license-policy.json";
const MARKDOWN_CONFIG = ".markdownlint.json";

const markdownFiles = (files: readonly string[]): Map<string, string> =>
  new Map(files.filter((file) => file.endsWith(".md")).map((file) => [file, readText(file)]));

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
  markdown: {
    description: `Markdown files follow the markdownlint rules in ${MARKDOWN_CONFIG}`,
    run: (files) =>
      checkMarkdown(markdownFiles(files), parseMarkdownConfig(readText(MARKDOWN_CONFIG))),
  },
  wrangler: {
    description:
      "apps deploy static assets only, each environment on its own domain, never via workers.dev, with no other settings",
    run: (files) => [
      ...missingWranglerConfigs(files),
      ...files
        .filter(isWranglerConfig)
        .flatMap((file) => checkWranglerConfig(file, readText(file))),
    ],
  },
  structure: {
    description:
      "apps keep the files of their app template, their id, build and scripts, and a test server of their own; every folder in apps/ is an app, and git has no build output",
    run: (files) => checkAppStructure(files, (file) => readText(file)),
  },
  imports: {
    description: "relative imports stay in their package, and nothing imports an app",
    run: (files) => checkImports(files, (file) => readText(file)),
  },
  "doc-links": {
    description: "relative links and #anchors in Markdown files resolve",
    run: (files) =>
      checkDocLinks({
        markdown: markdownFiles(files),
        exists: (file) => existsSync(path.join(repoRoot, file)),
      }),
  },
  code: {
    description:
      "sources set no inline styles, and use no HTML sink, worker start or UI text that lint cannot see",
    run: (files) => checkCode(files, (file) => readText(file)),
  },
  workspace: {
    description:
      "pnpm-workspace.yaml keeps the settings of ADR 0007, with plain versions and no install scripts, and no .npmrc or pnpmfile exists",
    run: (files) => checkWorkspace(files, (file) => readText(file)),
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
