import { type Header, type HeaderOptions, securityHeaders } from "./headers.ts";

/** Headers for the responses whose URL matches `pattern` (a `_headers` rule). */
export interface HeaderRule {
  readonly pattern: string;
  readonly headers: readonly Header[];
}

/** Cloudflare's limits for `_headers`. Going over them only logs a warning there. */
const MAX_RULES = 100;
const MAX_LINE_LENGTH = 2000;

/**
 * A path (`/assets/*`), or an `https` URL whose host labels are names or placeholders
 * (`https://:app.example.dev/*`). Cloudflare does not support ports in these URLs.
 */
const PATTERN = /^(?:https:\/\/(?::[a-z]+|[a-z0-9-]+)(?:\.(?::[a-z]+|[a-z0-9-]+))*)?\/\S*$/;
const HEADER_NAME = /^[A-Za-z0-9-]+$/;

export interface AppHeaderOptions extends HeaderOptions {
  /** The app's staging host, such as `notes.shkriuss.dev`. */
  readonly stagingHost: string;
}

/**
 * The `_headers` rules for an app:
 *
 * - the security headers on every response;
 * - long-lived caching for the files in `/assets/`, whose names contain a hash of their
 *   content; every other file, such as `index.html`, keeps Cloudflare's default of
 *   revalidating on each load;
 * - `X-Robots-Tag: noindex` on the staging host only, so that production and staging deploy
 *   the very same files.
 */
export function appHeaderRules(options: AppHeaderOptions): HeaderRule[] {
  return [
    { pattern: "/*", headers: securityHeaders(options) },
    {
      pattern: "/assets/*",
      headers: [["Cache-Control", "public, max-age=31536000, immutable"]],
    },
    { pattern: `https://${options.stagingHost}/*`, headers: [["X-Robots-Tag", "noindex"]] },
  ];
}

/**
 * Writes rules in Cloudflare's `_headers` format.
 *
 * Cloudflare applies every rule whose pattern matches and joins the values of a header that
 * several rules set, and a repeated pattern replaces the earlier rule. So each pattern and
 * each header name may appear in only one rule.
 */
export function headersFile(rules: readonly HeaderRule[]): string {
  if (rules.length > MAX_RULES) {
    throw new Error(`There are ${rules.length} _headers rules; Cloudflare allows ${MAX_RULES}.`);
  }
  const patterns = new Set<string>();
  const names = new Set<string>();
  const lines: string[] = [];
  for (const rule of rules) {
    if (!PATTERN.test(rule.pattern)) {
      throw new Error(
        `"${rule.pattern}" is not a path such as "/assets/*" or an https URL such as "https://example.dev/*".`,
      );
    }
    if (patterns.has(rule.pattern)) {
      throw new Error(`"${rule.pattern}" has more than one rule.`);
    }
    patterns.add(rule.pattern);
    lines.push(rule.pattern);

    for (const [name, value] of rule.headers) {
      if (!HEADER_NAME.test(name)) {
        throw new Error(`"${name}" is not a valid header name.`);
      }
      if (names.has(name.toLowerCase())) {
        throw new Error(
          `${name} is set by more than one rule, so Cloudflare would join the values.`,
        );
      }
      names.add(name.toLowerCase());
      if (/[\r\n]/.test(value) || value.trim() !== value || value === "") {
        throw new Error(`The value of ${name} must be one non-empty line without outer spaces.`);
      }
      lines.push(`  ${name}: ${value}`);
    }
  }
  for (const line of lines) {
    if (line.length > MAX_LINE_LENGTH) {
      throw new Error(
        `A _headers line is ${line.length} characters long; Cloudflare allows ${MAX_LINE_LENGTH}.`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
