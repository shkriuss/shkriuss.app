import type { Configuration } from "markdownlint";
import { lint } from "markdownlint/sync";
import { isRecord, type Violation } from "./report.ts";

/**
 * Markdown structure checks with the markdownlint library. Formatting is Prettier's job.
 * Inline `<!-- markdownlint-disable -->` comments are ignored, so a document cannot switch a
 * rule off for itself; rule changes belong in `.markdownlint.json`.
 */
export function checkMarkdown(
  files: ReadonlyMap<string, string>,
  config: Configuration,
): Violation[] {
  const results = lint({ strings: Object.fromEntries(files), config, noInlineConfig: true });
  const violations: Violation[] = [];
  for (const [file, errors] of Object.entries(results)) {
    for (const error of errors) {
      const detail = error.errorDetail === null ? "" : ` (${error.errorDetail})`;
      violations.push({
        file,
        line: error.lineNumber,
        message: `${error.ruleNames.join("/")}: ${error.ruleDescription}${detail}`,
      });
    }
  }
  return violations;
}

function isConfiguration(value: unknown): value is Configuration {
  return isRecord(value);
}

export function parseMarkdownConfig(source: string): Configuration {
  const config: unknown = JSON.parse(source);
  if (!isConfiguration(config)) {
    throw new Error(".markdownlint.json must contain a JSON object.");
  }
  return config;
}
