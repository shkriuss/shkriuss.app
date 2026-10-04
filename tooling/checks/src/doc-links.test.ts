import { describe, expect, it } from "vitest";
import { blankCode, checkDocLinks, extractLinks, githubSlug, headingAnchors } from "./doc-links.ts";

describe("githubSlug", () => {
  it.each([
    ["12. Security", "12-security"],
    ["ADR 0001: Domains and environments", "adr-0001-domains-and-environments"],
    ["Phase 0 — Foundations", "phase-0--foundations"],
    ["`@shkriuss/ui` and [links](x.md)", "shkriussui-and-links"],
    ["What’s next?", "whats-next"],
    ["snake_case stays", "snake_case-stays"],
    ["Ünïcode Lëtters", "ünïcode-lëtters"],
  ])("%j → %j", (heading, slug) => {
    expect(githubSlug(heading)).toBe(slug);
  });
});

describe("headingAnchors", () => {
  it("numbers repeated headings and ignores code blocks", () => {
    const markdown = [
      "# Setup",
      "## Setup",
      "```md",
      "# Not a heading",
      "```",
      "### C# #",
      "#NoSpace",
    ].join("\n");
    expect([...headingAnchors(markdown)]).toEqual(["setup", "setup-1", "c"]);
  });
});

describe("extractLinks", () => {
  it("finds inline links, images and reference definitions with line numbers", () => {
    const markdown = [
      'See [the docs](docs/a.md#intro "Title") and ![logo](img/logo.svg).',
      "",
      "[ref]: <docs/b.md>",
    ].join("\n");
    expect(extractLinks(markdown)).toEqual([
      { target: "docs/a.md#intro", line: 1 },
      { target: "img/logo.svg", line: 1 },
      { target: "docs/b.md", line: 3 },
    ]);
  });

  it("ignores links inside code", () => {
    expect(extractLinks("`[x](missing.md)`\n\n```\n[y](missing.md)\n```")).toEqual([]);
    expect(blankCode("a `b` c")).toBe("a     c");
  });
});

describe("checkDocLinks", () => {
  const markdown = new Map([
    [
      "README.md",
      ["# Project", "[Arch](docs/architecture.md#2-principles)", "[Self](#project)"].join("\n"),
    ],
    [
      "docs/architecture.md",
      ["# Architecture", "## 2. Principles", "[Back](../README.md)"].join("\n"),
    ],
  ]);
  const existing = new Set(["README.md", "docs/architecture.md", "docs"]);
  const exists = (file: string): boolean => existing.has(file);

  it("accepts valid relative links and anchors", () => {
    expect(checkDocLinks({ markdown, exists })).toEqual([]);
  });

  it("reports missing files, missing anchors and links outside the repo", () => {
    const broken = new Map([
      [
        "docs/x.md",
        [
          "[a](missing.md)",
          "[b](architecture.md#nope)",
          "[c](../../outside.md)",
          "[d](https://example.com/missing.md)",
          "[e](#)",
        ].join("\n"),
      ],
      ...markdown,
    ]);
    const violations = checkDocLinks({ markdown: broken, exists: (file) => existing.has(file) });
    expect(violations.map((v) => [v.file, v.line])).toEqual([
      ["docs/x.md", 1],
      ["docs/x.md", 2],
      ["docs/x.md", 3],
    ]);
  });
});
