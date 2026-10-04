import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addScriptIntegrity, cspHashSource, subresourceIntegrity } from "./integrity.ts";

const ENTRY = "sha384-entry";
const LAZY = "sha384-lazy";
const VENDOR = "sha384-vendor";
const STYLES = "sha384-styles";

const hashes = new Map([
  ["/assets/index-a1.js", ENTRY],
  ["/assets/lazy-b2.js", LAZY],
  ["/assets/vendor-c3.js", VENDOR],
  ["/assets/index-d4.css", STYLES],
]);

const built = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Test</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <script type="module" crossorigin src="/assets/index-a1.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-c3.js">
    <link rel="stylesheet" crossorigin href="/assets/index-d4.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

describe("subresourceIntegrity", () => {
  it("is the base64 SHA-384 digest with its algorithm prefix", () => {
    const expected = createHash("sha384").update("console.log(1)").digest("base64");
    expect(subresourceIntegrity("console.log(1)")).toBe(`sha384-${expected}`);
    expect(subresourceIntegrity(new TextEncoder().encode("console.log(1)"))).toBe(
      `sha384-${expected}`,
    );
  });
});

describe("cspHashSource", () => {
  it("is a quoted SHA-256 source expression of the exact text", () => {
    const expected = createHash("sha256").update('{"a":1}').digest("base64");
    expect(cspHashSource('{"a":1}')).toBe(`'sha256-${expected}'`);
  });
});

describe("addScriptIntegrity", () => {
  it("adds integrity to scripts, module preloads and stylesheets", () => {
    const { html } = addScriptIntegrity(built, hashes);
    expect(html).toContain(
      `<script type="module" crossorigin src="/assets/index-a1.js" integrity="${ENTRY}"></script>`,
    );
    expect(html).toContain(
      `<link rel="modulepreload" crossorigin href="/assets/vendor-c3.js" integrity="${VENDOR}">`,
    );
    expect(html).toContain(
      `<link rel="stylesheet" crossorigin href="/assets/index-d4.css" integrity="${STYLES}">`,
    );
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
  });

  it("lists every JavaScript file, sorted by path, in an import map", () => {
    const { importMap } = addScriptIntegrity(built, hashes);
    expect(importMap).toBe(
      JSON.stringify({
        integrity: {
          "/assets/index-a1.js": ENTRY,
          "/assets/lazy-b2.js": LAZY,
          "/assets/vendor-c3.js": VENDOR,
        },
      }),
    );
  });

  it("inserts the import map before the first script, at the same indentation", () => {
    const { html, importMap } = addScriptIntegrity(built, hashes);
    const mapTag = `    <script type="importmap">${importMap}</script>\n`;
    expect(html).toContain(`${mapTag}    <script type="module"`);
    expect(html.indexOf(mapTag)).toBeLessThan(html.indexOf('<script type="module"'));
    expect(html.match(/<script\b/g)).toHaveLength(2);
  });

  it("puts the import map at the end of the head when the scripts are in the body", () => {
    const bodyScript = built
      .replace('    <script type="module" crossorigin src="/assets/index-a1.js"></script>\n', "")
      .replace('<link rel="modulepreload" crossorigin href="/assets/vendor-c3.js">\n    ', "")
      .replace(
        '<div id="root"></div>',
        '<div id="root"></div>\n    <script type="module" src="/assets/index-a1.js"></script>',
      );
    const { html } = addScriptIntegrity(bodyScript, hashes);
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf("</head>"));
    expect(html).toContain(`<script type="module" src="/assets/index-a1.js" integrity="${ENTRY}">`);
  });

  it("produces the same output for the same input", () => {
    const reversed = new Map([...hashes].toReversed());
    expect(addScriptIntegrity(built, reversed)).toEqual(addScriptIntegrity(built, hashes));
  });

  it("keeps a matching integrity attribute and rejects a wrong one", () => {
    const withMatching = built.replace(
      'src="/assets/index-a1.js"',
      `src="/assets/index-a1.js" integrity="${ENTRY}"`,
    );
    expect(addScriptIntegrity(withMatching, hashes).html.match(/integrity="/g)).toHaveLength(3);

    const withWrong = built.replace(
      'src="/assets/index-a1.js"',
      'src="/assets/index-a1.js" integrity="sha384-other"',
    );
    expect(() => addScriptIntegrity(withWrong, hashes)).toThrow(/does not match/);
  });

  it("rejects inline scripts", () => {
    const inline = built.replace("</head>", "<script>alert(1)</script>\n  </head>");
    expect(() => addScriptIntegrity(inline, hashes)).toThrow(/inline <script>/);
  });

  it("rejects an import map that is already in the HTML", () => {
    const withMap = built.replace("</head>", '<script type="importmap">{}</script>\n  </head>');
    expect(() => addScriptIntegrity(withMap, hashes)).toThrow(/its own import map/);
  });

  it("rejects scripts and module preloads that are not files from the build", () => {
    const external = built.replace("/assets/index-a1.js", "https://cdn.example/x.js");
    expect(() => addScriptIntegrity(external, hashes)).toThrow(/not a file from this build/);

    const unknownPreload = built.replace("/assets/vendor-c3.js", "/assets/unknown.js");
    expect(() => addScriptIntegrity(unknownPreload, hashes)).toThrow(/not a file from this build/);
  });

  it("handles self-closing tags", () => {
    const selfClosing = built.replace(
      '<link rel="modulepreload" crossorigin href="/assets/vendor-c3.js">',
      '<link rel="modulepreload" crossorigin href="/assets/vendor-c3.js" />',
    );
    expect(addScriptIntegrity(selfClosing, hashes).html).toContain(
      `<link rel="modulepreload" crossorigin href="/assets/vendor-c3.js" integrity="${VENDOR}" />`,
    );
  });

  it("takes linear time on long runs of spaces inside a tag", () => {
    // Regression test: a backtracking regular expression once took seconds here (CodeQL).
    const spaced = built.replace(
      '<script type="module" crossorigin src=',
      `<script type="module"${" ".repeat(200_000)}src=`,
    );
    const start = performance.now();
    const { html } = addScriptIntegrity(spaced, hashes);
    expect(performance.now() - start).toBeLessThan(500);
    expect(html).toContain(`src="/assets/index-a1.js" integrity="${ENTRY}"></script>`);
  });

  it("rejects HTML without a head", () => {
    expect(() => addScriptIntegrity("<p>hi</p>", hashes)).toThrow(/no <\/head>/);
  });
});
