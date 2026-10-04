import { createHash } from "node:crypto";

/**
 * Script integrity (ADR 0007, ADR 0010). Every script the browser loads must match a hash
 * that was fixed at build time:
 *
 * - `<script src>` and `<link rel="modulepreload">` tags get `integrity` attributes;
 * - an import map lists the hash of every JavaScript file, which covers modules that are
 *   loaded later with `import()`;
 * - `Integrity-Policy: blocked-destinations=(script)` makes the browser refuse any script
 *   that has no hash at all.
 *
 * The import map is the only inline script. The Content-Security-Policy allows exactly that
 * map by its SHA-256 hash.
 *
 * The HTML is Vite's output for our own `index.html`. Tags are found with regular expressions,
 * which is enough for that controlled input; anything unexpected fails the build instead of
 * shipping a script without a hash.
 */

/** The `integrity` attribute value (SHA-384, as browsers recommend) for a file's bytes. */
export function subresourceIntegrity(content: string | Uint8Array): string {
  return `sha384-${createHash("sha384").update(content).digest("base64")}`;
}

/** The CSP source expression that allows one inline script with exactly this text. */
export function cspHashSource(inlineScript: string): string {
  return `'sha256-${createHash("sha256").update(inlineScript, "utf8").digest("base64")}'`;
}

export interface IntegrityResult {
  /** The HTML with integrity attributes and the import map. */
  readonly html: string;
  /** The text of the inserted import map; its hash goes into the CSP. */
  readonly importMap: string;
}

const TAG = /<(script|link)\b((?:\s[^>]*)?)>/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const HEAD_END = /<\/head\s*>/i;

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? "").toLowerCase();
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function withIntegrity(tag: string, hash: string): string {
  return tag.replace(/\s*\/?>$/, (end) => ` integrity="${hash}"${end}`);
}

/** The whitespace that indents the line `offset` is on, so inserted tags line up. */
function indentationAt(html: string, offset: number): string {
  const lineStart = html.lastIndexOf("\n", offset - 1) + 1;
  const prefix = html.slice(lineStart, offset);
  return /^[ \t]*$/.test(prefix) ? prefix : "";
}

/**
 * Adds integrity attributes and the import map to a built `index.html`.
 *
 * @param hashes Integrity values of the built JavaScript and CSS files, keyed by the URL path
 *   the HTML uses for them (for example `/assets/index-a1b2c3.js`).
 * @throws if the HTML has an inline script, an import map of its own, or a script or module
 *   preload that is not a file from this build.
 */
export function addScriptIntegrity(
  html: string,
  hashes: ReadonlyMap<string, string>,
): IntegrityResult {
  const headEnd = html.search(HEAD_END);
  if (headEnd === -1) {
    throw new Error("index.html has no </head>, so the import map has nowhere to go.");
  }

  const edits: Edit[] = [];
  let importMapAt = headEnd;

  for (const match of html.matchAll(TAG)) {
    const tag = match[0];
    const name = (match[1] ?? "").toLowerCase();
    const attributes = parseAttributes(match[2] ?? "");
    const rel = attributes.get("rel")?.toLowerCase();
    const isScript = name === "script";
    const isModulePreload = name === "link" && rel === "modulepreload";
    const url = isScript ? attributes.get("src") : attributes.get("href");

    if (isScript && attributes.get("type")?.toLowerCase() === "importmap") {
      throw new Error("index.html has its own import map; the build generates the only one.");
    }
    if (isScript && url === undefined) {
      throw new Error(
        "index.html has an inline <script>; only the generated import map may be inline.",
      );
    }

    let hash: string | undefined;
    if (isScript || isModulePreload) {
      hash = url === undefined ? undefined : hashes.get(url);
      if (hash === undefined) {
        throw new Error(
          `<${name}> loads "${url ?? ""}", which is not a file from this build, so it cannot get an integrity hash.`,
        );
      }
      importMapAt = Math.min(importMapAt, match.index);
    } else if (name === "link" && rel === "stylesheet" && url !== undefined) {
      hash = hashes.get(url);
    }
    if (hash === undefined) {
      continue;
    }

    const existing = attributes.get("integrity");
    if (existing !== undefined && existing !== hash) {
      throw new Error(
        `<${name}> for "${url ?? ""}" has an integrity value that does not match the file.`,
      );
    }
    if (existing === undefined) {
      edits.push({
        start: match.index,
        end: match.index + tag.length,
        text: withIntegrity(tag, hash),
      });
    }
  }

  // Sorted, so the same build always produces the same map and the same CSP hash.
  const integrity: Record<string, string> = {};
  for (const path of [...hashes.keys()].toSorted()) {
    const hash = hashes.get(path);
    if (path.endsWith(".js") && hash !== undefined) {
      integrity[path] = hash;
    }
  }
  const importMap = JSON.stringify({ integrity });
  if (importMap.includes("<")) {
    throw new Error(
      "The import map would contain '<', which could end the <script> element early.",
    );
  }
  edits.push({
    start: importMapAt,
    end: importMapAt,
    text: `<script type="importmap">${importMap}</script>\n${indentationAt(html, importMapAt)}`,
  });

  // An insertion sorts before a replacement that starts at the same offset.
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let output = "";
  let position = 0;
  for (const edit of edits) {
    output += html.slice(position, edit.start) + edit.text;
    position = edit.end;
  }
  output += html.slice(position);

  return { html: output, importMap };
}
