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
  /** The URL path of every file that the build serves, such as `/assets/index-1a2b3c4d.js`. */
  readonly files: readonly string[];
}

/**
 * The `_headers` rules for an app:
 *
 * - the security headers on every response;
 * - long-lived caching for each file in `/assets/`, whose name contains a hash of its content,
 *   by its exact path. A request for a file that the build does not have, as from a page of
 *   another version, gets the single-page fallback, the app's HTML, which must not be kept for
 *   a year in the file's place. Every other file, such as `index.html`, keeps Cloudflare's
 *   default of revalidating on each load;
 * - UTF-8 for text files, which Cloudflare serves as `text/plain` without a charset, which
 *   browsers then read in another encoding, and which RFC 9116 asks of `security.txt`;
 * - `X-Robots-Tag: noindex` on the staging host only, so that production and staging deploy
 *   the very same files.
 */
export function appHeaderRules(options: AppHeaderOptions): HeaderRule[] {
  const files = options.files.toSorted();
  return [
    { pattern: "/*", headers: securityHeaders(options) },
    ...files
      .filter((file) => file.startsWith("/assets/"))
      .map((file): HeaderRule => ({
        pattern: file,
        headers: [["Cache-Control", "public, max-age=31536000, immutable"]],
      })),
    ...files
      .filter((file) => file.endsWith(".txt"))
      .map((file): HeaderRule => ({
        pattern: file,
        headers: [["Content-Type", "text/plain; charset=utf-8"]],
      })),
    { pattern: `https://${options.stagingHost}/*`, headers: [["X-Robots-Tag", "noindex"]] },
  ];
}

/** Whether `pattern` matches one path only: no splat, no placeholder and no host. */
function isExactPath(pattern: string): boolean {
  return pattern.startsWith("/") && !pattern.includes("*") && !pattern.includes(":");
}

/**
 * Writes rules in Cloudflare's `_headers` format.
 *
 * Cloudflare applies every rule whose pattern matches and joins the values of a header that
 * several rules set, and a repeated pattern replaces the earlier rule. So each pattern may
 * appear in only one rule, and each header name too, except in rules for exact paths, of which
 * no request matches two.
 */
export function headersFile(rules: readonly HeaderRule[]): string {
  if (rules.length > MAX_RULES) {
    throw new Error(`There are ${rules.length} _headers rules; Cloudflare allows ${MAX_RULES}.`);
  }
  const patterns = new Set<string>();
  // The pattern of each header name's rule, or of its first rule for exact paths.
  const names = new Map<string, string>();
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
      const other = names.get(name.toLowerCase());
      if (other !== undefined && !(isExactPath(other) && isExactPath(rule.pattern))) {
        throw new Error(
          `${name} is set by more than one rule, so Cloudflare would join the values.`,
        );
      }
      names.set(name.toLowerCase(), other ?? rule.pattern);
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
