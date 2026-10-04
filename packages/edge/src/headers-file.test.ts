import { describe, expect, it } from "vitest";
import { appHeaderRules, headersFile, type HeaderRule } from "./headers-file.ts";

function rule(pattern: string, name: string, value: string): HeaderRule[] {
  return [{ pattern, headers: [[name, value]] }];
}

describe("headersFile", () => {
  it("writes each rule as a pattern followed by indented headers", () => {
    expect(
      headersFile([
        { pattern: "/*", headers: [["X-Frame-Options", "DENY"]] },
        { pattern: "/assets/*", headers: [["Cache-Control", "public, max-age=31536000"]] },
        { pattern: "https://shkriuss.dev/*", headers: [["X-Robots-Tag", "noindex"]] },
      ]),
    ).toBe(
      "/*\n  X-Frame-Options: DENY\n" +
        "/assets/*\n  Cache-Control: public, max-age=31536000\n" +
        "https://shkriuss.dev/*\n  X-Robots-Tag: noindex\n",
    );
  });

  it.each(["assets/*", "/a b", "http://shkriuss.dev/*", "https://shkriuss.dev:8443/*"])(
    "rejects %s, which Cloudflare would not read as a path or an https URL",
    (pattern) => {
      expect(() => headersFile(rule(pattern, "A", "b"))).toThrow(/is not a path/);
    },
  );

  it.each(["/assets/*", "https://shkriuss.dev/*", "https://:app.shkriuss.dev/*"])(
    "accepts %s",
    (pattern) => {
      expect(() => headersFile(rule(pattern, "A", "b"))).not.toThrow();
    },
  );

  it("rejects header lines that would change the meaning of the file", () => {
    expect(() => headersFile(rule("/*", "Bad Name", "b"))).toThrow(/not a valid header name/);
    expect(() => headersFile(rule("/*", "A", "b\n/*\n  X-Other: c"))).toThrow(/one non-empty line/);
    expect(() => headersFile(rule("/*", "A", ""))).toThrow(/one non-empty line/);
    expect(() => headersFile(rule("/*", "A", " b"))).toThrow(/one non-empty line/);
  });

  it("rejects rules that Cloudflare would merge or replace", () => {
    expect(() => headersFile([...rule("/*", "A", "1"), ...rule("/*", "B", "2")])).toThrow(
      /more than one rule/,
    );
    expect(() => headersFile([...rule("/*", "A", "1"), ...rule("/x/*", "a", "2")])).toThrow(
      /would join the values/,
    );
  });

  it("enforces Cloudflare's limits", () => {
    expect(() => headersFile(rule("/*", "A", "b".repeat(2000)))).toThrow(/Cloudflare allows 2000/);
    const tooMany = Array.from({ length: 101 }, (_, index) => rule(`/${index}`, `H${index}`, "x"));
    expect(() => headersFile(tooMany.flat())).toThrow(/Cloudflare allows 100/);
  });
});

describe("appHeaderRules", () => {
  const rules = appHeaderRules({ scriptHashes: [], stagingHost: "notes.shkriuss.dev" });

  it("sends the security headers with every response", () => {
    const all = rules.find((candidate) => candidate.pattern === "/*");
    expect(all?.headers.map(([name]) => name)).toContain("Content-Security-Policy");
  });

  it("caches hashed assets for a year and nothing else", () => {
    expect(
      rules.filter((candidate) => candidate.headers.some(([name]) => name === "Cache-Control")),
    ).toEqual([
      { pattern: "/assets/*", headers: [["Cache-Control", "public, max-age=31536000, immutable"]] },
    ]);
  });

  it("keeps search engines out of staging only", () => {
    expect(
      rules.filter((candidate) => candidate.headers.some(([name]) => name === "X-Robots-Tag")),
    ).toEqual([
      { pattern: "https://notes.shkriuss.dev/*", headers: [["X-Robots-Tag", "noindex"]] },
    ]);
  });

  it("is a valid file", () => {
    expect(() => headersFile(rules)).not.toThrow();
  });
});
