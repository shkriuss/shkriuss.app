import { describe, expect, it } from "vitest";
import {
  checkLicenses,
  isLicenseAllowed,
  parseLicensePolicy,
  parseLicenseReport,
  parseSpdx,
} from "./licenses.ts";

const allowed = new Set(["MIT", "Apache-2.0", "BSD-3-Clause"]);

describe("parseSpdx", () => {
  it("gives AND higher precedence than OR", () => {
    expect(parseSpdx("MIT OR Apache-2.0 AND GPL-3.0-only")).toEqual({
      kind: "or",
      left: { kind: "license", id: "MIT" },
      right: {
        kind: "and",
        left: { kind: "license", id: "Apache-2.0" },
        right: { kind: "license", id: "GPL-3.0-only" },
      },
    });
  });

  it("parses parentheses, WITH exceptions and lowercase operators", () => {
    expect(parseSpdx("(MIT or BSD-3-Clause) and Apache-2.0 WITH LLVM-exception")).toEqual({
      kind: "and",
      left: {
        kind: "or",
        left: { kind: "license", id: "MIT" },
        right: { kind: "license", id: "BSD-3-Clause" },
      },
      right: {
        kind: "with",
        license: { kind: "license", id: "Apache-2.0" },
        exception: "LLVM-exception",
      },
    });
  });

  it.each(["", "MIT OR", "(MIT", "MIT)", "AND MIT", "MIT WITH", "SEE LICENSE IN LICENSE.txt"])(
    "rejects invalid expression %j",
    (expression) => {
      expect(() => parseSpdx(expression)).toThrow(/license expression/);
    },
  );
});

describe("isLicenseAllowed", () => {
  it.each([
    ["MIT", true],
    ["GPL-3.0-only", false],
    ["MIT OR GPL-3.0-only", true],
    ["MIT AND GPL-3.0-only", false],
    ["(MIT OR GPL-3.0-only) AND BSD-3-Clause", true],
    ["Apache-2.0 WITH LLVM-exception", true],
    ["UNKNOWN", false],
    ["SEE LICENSE IN LICENSE.txt", false],
  ])("%s → %s", (expression, expected) => {
    expect(isLicenseAllowed(expression, allowed)).toBe(expected);
  });
});

describe("parseLicenseReport", () => {
  it("reads the JSON that pnpm prints", () => {
    const output = JSON.stringify({
      MIT: [{ name: "a", versions: ["1.0.0", "1.1.0"], license: "MIT" }],
      "GPL-3.0-only": [{ name: "b", versions: ["2.0.0"], license: "GPL-3.0-only" }],
    });
    expect(parseLicenseReport(output)).toEqual([
      { name: "a", versions: ["1.0.0", "1.1.0"], license: "MIT" },
      { name: "b", versions: ["2.0.0"], license: "GPL-3.0-only" },
    ]);
  });

  it("treats pnpm’s plain-text message as an empty report", () => {
    expect(parseLicenseReport("No licenses in packages found\n")).toEqual([]);
  });
});

describe("checkLicenses", () => {
  const policy = {
    allowed: ["MIT"],
    exceptions: { "b@2.0.0": "Reviewed: only used for its data files." },
  };

  it("reports disallowed licenses unless an exact version is excepted", () => {
    const violations = checkLicenses(
      [
        { name: "a", versions: ["1.0.0"], license: "MIT" },
        { name: "b", versions: ["2.0.0", "2.1.0"], license: "GPL-3.0-only" },
      ],
      policy,
      "policy.json",
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("b@2.1.0");
  });
});

describe("parseLicensePolicy", () => {
  it("accepts a valid policy", () => {
    expect(parseLicensePolicy('{"allowed":["MIT"],"exceptions":{"x@1.0.0":"why"}}')).toEqual({
      allowed: ["MIT"],
      exceptions: { "x@1.0.0": "why" },
    });
  });

  it.each([
    '{"allowed":"MIT","exceptions":{}}',
    '{"allowed":["MIT", 1],"exceptions":{}}',
    '{"allowed":["MIT"],"exceptions":{"x@1.0.0":""}}',
  ])("rejects %s", (source) => {
    expect(() => parseLicensePolicy(source)).toThrow(/License policy needs/);
  });
});
