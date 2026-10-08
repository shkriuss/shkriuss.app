import { lineOf, type Violation } from "./report.ts";

/**
 * Security checks for the HTML files we ship (CLAUDE.md, security rules 1–3). Oxlint covers
 * scripts; this covers what it cannot see: markup that the Content-Security-Policy would block
 * or that would load third-party resources.
 *
 * Tags and attributes are found with regular expressions. That is enough for the small,
 * hand-written `index.html` files in this repository; it is not a general HTML parser.
 */

/**
 * Attributes whose URL the browser fetches, on any tag: an image's `src`, an object's `data`, a
 * video's `poster`, an SVG image's `xlink:href`, and the `ping` of a link, which reports a click.
 */
const RESOURCE_ATTRIBUTES = new Set([
  "background",
  "data",
  "manifest",
  "ping",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);
/** Tags whose `href` is a link that the user may follow, not a resource that the page loads. */
const LINK_TAGS = new Set(["a", "area"]);

/**
 * A start tag: its name, then attributes up to the first `>` that no quotes hold. A `/` may
 * separate the name from the first attribute, as browsers accept in `<script/src=…>`.
 */
const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
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

    if (name === "base") {
      report(offset, "A <base> element is not allowed; it changes where relative URLs lead.");
    }
    if (
      name === "meta" &&
      attributes.some(
        (attribute) =>
          attribute.name === "http-equiv" && attribute.value.trim().toLowerCase() === "refresh",
      )
    ) {
      report(offset, "A meta refresh is not allowed; it navigates the page by itself.");
    }
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
      const loads =
        RESOURCE_ATTRIBUTES.has(attribute.name) ||
        (attribute.name === "href" && !LINK_TAGS.has(name));
      // A srcset lists several URLs, each followed by its size.
      const urls =
        attribute.name === "srcset" || attribute.name === "ping"
          ? attribute.value.split(/[,\s]+/)
          : [attribute.value];
      if (loads && urls.some((url) => REMOTE_URL.test(url))) {
        report(offset, "Third-party resources are not allowed; bundle the file instead.");
      }
    }
  }
  return violations;
}
