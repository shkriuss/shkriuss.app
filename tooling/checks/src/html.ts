import { lineOf, type Violation } from "./report.ts";

/**
 * Security checks for the HTML files we ship (CLAUDE.md, security rules 1–3). Oxlint covers
 * scripts; this covers what it cannot see: markup that the Content-Security-Policy would block
 * or that would load third-party resources.
 *
 * Tags and attributes are found with regular expressions. That is enough for the small,
 * hand-written `index.html` files in this repository; it is not a general HTML parser.
 */

/** Tags whose `src`, `href` or `srcset` makes the browser fetch a resource. */
const RESOURCE_TAGS = new Set([
  "audio",
  "embed",
  "iframe",
  "img",
  "link",
  "object",
  "script",
  "source",
  "track",
  "video",
]);
const RESOURCE_ATTRIBUTES = new Set(["src", "href", "srcset"]);

const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^>]*)?)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const JAVASCRIPT_URL = /^\s*javascript:/i;
/** Absolute (`https://…`) or protocol-relative (`//…`) URLs point at another origin. */
const REMOTE_URL = /^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i;

interface Attribute {
  readonly name: string;
  readonly value: string;
}

function parseAttributes(source: string): Attribute[] {
  return [...source.matchAll(ATTRIBUTE)].map((match) => ({
    name: (match[1] ?? "").toLowerCase(),
    value: match[2] ?? match[3] ?? match[4] ?? "",
  }));
}

/** Replaces HTML comments with spaces, keeping offsets and line numbers intact. */
function blankComments(html: string): string {
  return html.replaceAll(/<!--[\s\S]*?-->/g, (comment) => comment.replaceAll(/[^\n]/g, " "));
}

export function checkHtml(file: string, source: string): Violation[] {
  const html = blankComments(source);
  const violations: Violation[] = [];
  const report = (offset: number, message: string): void => {
    violations.push({ file, line: lineOf(html, offset), message });
  };

  for (const match of html.matchAll(TAG)) {
    const name = (match[1] ?? "").toLowerCase();
    const attributes = parseAttributes(match[2] ?? "");
    const offset = match.index;

    if (name === "style") {
      report(
        offset,
        "Inline <style> is not allowed; use a stylesheet file (CSP style-src 'self').",
      );
    }
    if (name === "script") {
      if (!attributes.some((attribute) => attribute.name === "src")) {
        report(
          offset,
          "Inline <script> is not allowed; load a file with src (CSP script-src 'self').",
        );
      } else {
        const contentStart = offset + match[0].length;
        const end = html.indexOf("</script", contentStart);
        if (end !== -1 && html.slice(contentStart, end).trim() !== "") {
          report(offset, "A <script> with src must not also contain inline code.");
        }
      }
    }
    for (const attribute of attributes) {
      if (attribute.name === "style") {
        report(offset, "style attributes are not allowed; use classes (CSP style-src 'self').");
      }
      if (attribute.name.startsWith("on")) {
        report(offset, `Inline event handler attributes (${attribute.name}) are not allowed.`);
      }
      if (JAVASCRIPT_URL.test(attribute.value)) {
        report(offset, "URLs with the javascript: scheme are not allowed.");
      }
      if (
        RESOURCE_TAGS.has(name) &&
        RESOURCE_ATTRIBUTES.has(attribute.name) &&
        REMOTE_URL.test(attribute.value)
      ) {
        report(offset, "Third-party resources are not allowed; bundle the file instead.");
      }
    }
  }
  return violations;
}
