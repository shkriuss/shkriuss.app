import { describe, expect, it } from "vitest";
import { checkHtml } from "./html.ts";

const messages = (html: string): string[] => checkHtml("index.html", html).map((v) => v.message);

describe("checkHtml", () => {
  it("accepts a page that loads everything from its own origin", () => {
    const html = [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="utf-8" />',
      '    <link rel="manifest" href="/manifest.webmanifest" />',
      '    <link rel="stylesheet" href="/assets/app.css" />',
      '    <script type="module" src="/assets/app.js" integrity="sha384-abc"></script>',
      "  </head>",
      '  <body><a href="https://github.com/shkriuss/shkriuss.app">Source code</a></body>',
      "</html>",
    ].join("\n");
    expect(checkHtml("index.html", html)).toEqual([]);
  });

  it("rejects inline scripts and styles", () => {
    expect(messages("<script>alert(1)</script>")).toEqual([
      "Inline <script> is not allowed; load a file with src (CSP script-src 'self').",
    ]);
    expect(messages("<style>p { color: red }</style>")).toHaveLength(1);
    expect(messages('<script src="/a.js">alert(1)</script>')).toEqual([
      "A <script> with src must not also contain inline code.",
    ]);
  });

  it("rejects style attributes, event handlers and javascript: URLs", () => {
    expect(messages('<p style="color: red">x</p>')).toHaveLength(1);
    expect(messages('<button onclick="go()">Go</button>')).toHaveLength(1);
    expect(messages('<a href="javascript:void(0)">x</a>')).toHaveLength(1);
  });

  it("rejects third-party resources but allows links to other sites", () => {
    expect(messages('<script src="https://cdn.example.com/x.js"></script>')).toHaveLength(1);
    expect(messages('<link rel="preconnect" href="//fonts.example.com" />')).toHaveLength(1);
    expect(messages('<img src="http://example.com/a.png" alt="" />')).toHaveLength(1);
    expect(messages('<a href="https://example.com">Example</a>')).toEqual([]);
  });

  it("sees attributes after a slash, and past a > that quotes hold", () => {
    expect(messages('<script/src="https://cdn.example.com/x.js"></script>')).toEqual([
      "Third-party resources are not allowed; bundle the file instead.",
    ]);
    expect(messages('<img alt=">" src="https://example.com/a.png" />')).toHaveLength(1);
    expect(messages("<img alt='>' src=https://example.com/a.png>")).toHaveLength(1);
    expect(messages('<p title="a > b">x</p>')).toEqual([]);
  });

  it("rejects <base> and a meta refresh", () => {
    expect(messages('<base href="/" />')).toEqual([
      "A <base> element is not allowed; it changes where relative URLs lead.",
    ]);
    expect(messages('<meta http-equiv="Refresh" content="0; url=https://example.com" />')).toEqual([
      "A meta refresh is not allowed; it navigates the page by itself.",
    ]);
    expect(messages('<meta http-equiv="content-language" content="en" />')).toEqual([]);
  });

  it("rejects every attribute that loads from another origin, on any tag", () => {
    expect(messages('<object data="https://example.com/x.swf"></object>')).toHaveLength(1);
    expect(messages('<video poster="https://example.com/p.png"></video>')).toHaveLength(1);
    expect(messages('<svg><image href="https://example.com/a.png" /></svg>')).toHaveLength(1);
    expect(messages('<svg><use xlink:href="https://example.com/s.svg#i" /></svg>')).toHaveLength(1);
    expect(
      messages('<img srcset="/a.png 1x, https://example.com/b.png 2x" alt="" />'),
    ).toHaveLength(1);
    expect(messages('<a href="/" ping="/count https://tracker.example.com">x</a>')).toHaveLength(1);
    expect(messages('<img srcset="/a.png 1x, /b.png 2x" alt="" />')).toEqual([]);
    expect(messages('<area href="https://example.com" alt="Example" />')).toEqual([]);
  });

  it("does not mistake text or attribute values for attributes", () => {
    expect(messages("<p>Someone said one = two, style = fine</p>")).toEqual([]);
    expect(messages('<meta name="description" content="Notes online = yes, style=x" />')).toEqual(
      [],
    );
  });

  it("ignores commented-out markup and reports correct line numbers", () => {
    const html = ["<!-- <script>old()</script> -->", "<p>ok</p>", "<div", '  style="x">'].join(
      "\n",
    );
    expect(checkHtml("page.html", html)).toEqual([
      {
        file: "page.html",
        line: 3,
        message: "style attributes are not allowed; use classes (CSP style-src 'self').",
      },
    ]);
  });
});
