import { describe, expect, it } from "vitest";
import { checkMarkdown, parseMarkdownConfig } from "./markdown.ts";

const config = { default: true, MD013: false };

describe("checkMarkdown", () => {
  it("accepts well-formed documents, including YAML front matter", () => {
    const files = new Map([
      ["README.md", "# Title\n\nSome text.\n"],
      [".claude/skills/x/SKILL.md", "---\nname: x\ndescription: y\n---\n\n# Skill\n"],
    ]);
    expect(checkMarkdown(files, config)).toEqual([]);
  });

  it("reports the file, line and rule of each problem", () => {
    const files = new Map([["docs/a.md", "# Title\n\n### Skipped a level\n"]]);
    const violations = checkMarkdown(files, config);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ file: "docs/a.md", line: 3 });
    expect(violations[0]?.message).toMatch(/^MD001\/heading-increment: /);
  });

  it("does not let a document disable rules for itself", () => {
    const files = new Map([
      ["docs/b.md", "# Title\n\n<!-- markdownlint-disable -->\n\n### Skipped\n"],
    ]);
    const rules = checkMarkdown(files, config).map((violation) => violation.message);
    expect(rules.some((message) => message.startsWith("MD001/"))).toBe(true);
  });
});

describe("parseMarkdownConfig", () => {
  it("parses a JSON object and rejects anything else", () => {
    expect(parseMarkdownConfig('{"default": true}')).toEqual({ default: true });
    expect(() => parseMarkdownConfig("[]")).toThrow(/must contain a JSON object/);
  });
});
