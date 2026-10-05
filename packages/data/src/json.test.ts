import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataLayerError } from "./errors.ts";
import { MAX_DEPTH, canonicalJson, toJsonValue, utf8Length } from "./json.ts";
import { jsonValue } from "./test/arbitraries.ts";

/** An array whose first two items are missing. */
function holey(): unknown[] {
  const items: unknown[] = [];
  items[2] = 3;
  return items;
}

/** A value with `depth` levels of arrays. */
function nested(depth: number): unknown {
  let value: unknown = 1;
  for (let level = 0; level < depth; level++) {
    value = [value];
  }
  return value;
}

describe("toJsonValue (data model §2.3)", () => {
  // it.for passes each case as it is; it.each would spread the arrays into arguments.
  it.for<unknown>([
    null,
    true,
    false,
    0,
    -1.5,
    Number.MAX_SAFE_INTEGER,
    "",
    "Milk 🥛",
    [],
    [1, "two", null],
    {},
    { title: "Milk", tags: ["a"], when: { year: 2026 } },
    { constructor: 1, toString: 2, prototype: 3 },
  ])("keeps the JSON value %j", (value) => {
    expect(toJsonValue(value)).toStrictEqual(value);
  });

  it("stores -0 as 0, at any depth", () => {
    // toBe and toStrictEqual tell -0 and 0 apart.
    expect(toJsonValue(-0)).toBe(0);
    expect(toJsonValue({ list: [-0] })).toStrictEqual({ list: [0] });
  });

  it("copies instead of keeping a reference", () => {
    const value = { list: [1] };
    const copy = toJsonValue(value);
    value.list.push(2);
    expect(copy).toStrictEqual({ list: [1] });
  });

  it("accepts objects without a prototype", () => {
    const value: unknown = Object.assign(Object.create(null), { a: 1 });
    expect(toJsonValue(value)).toStrictEqual({ a: 1 });
  });

  it(`accepts ${MAX_DEPTH} levels of arrays and objects, and no more`, () => {
    expect(() => toJsonValue(nested(MAX_DEPTH))).not.toThrow();
    expect(() => toJsonValue(nested(MAX_DEPTH + 1))).toThrow(/more than 32 levels/);
  });

  it.each([
    ["undefined", undefined],
    ["a function", () => 1],
    ["a symbol", Symbol("x")],
    ["a bigint", 1n],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a lone surrogate", "\ud800"],
    ["a Date", new Date(0)],
    ["a Map", new Map()],
    ["binary data", new Uint8Array(1)],
    ["an array with a hole", holey()],
    ["undefined in an object", { a: undefined }],
    ["a nested NaN", { a: [Number.NaN] }],
    ["a member named __proto__", JSON.parse('{"a": {"__proto__": {}}}') as unknown],
    ["a member name with a lone surrogate", { "\udc00": 1 }],
  ])("refuses %s", (_case, value) => {
    expect(() => toJsonValue(value, "The field title")).toThrow(DataLayerError);
  });

  it("names the field in its message, but nothing inside the value", () => {
    expect(() => toJsonValue({ "secret name": [Number.NaN] }, "The field note")).toThrow(
      "The field note is or contains a number that is not finite.",
    );
  });

  it("returns every generated value unchanged", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        expect(toJsonValue(value)).toStrictEqual(value);
      }),
    );
  });
});

describe("canonicalJson (RFC 8785, data model §5.4)", () => {
  it("serializes the example of RFC 8785, section 3.2.2", () => {
    const input = toJsonValue(
      JSON.parse(
        String.raw`{
        "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
        "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
        "literals": [null, true, false]
      }`,
      ),
    );
    expect(canonicalJson(input)).toBe(
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
    );
  });

  it("sorts members by UTF-16 code units, as in RFC 8785, section 3.2.3", () => {
    const input = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "\ud83d\ude00": "Emoji: Grinning Face",
      "\u0080": "Control",
      "\u00f6": "Latin Small Letter O With Diaeresis",
    };
    expect(canonicalJson(input)).toBe(
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control",' +
        '"\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign",' +
        '"\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    );
  });

  it.each([
    [0, "0"],
    [1e21, "1e+21"],
    [1e-7, "1e-7"],
    [123456789012345680000, "123456789012345680000"],
    [Number.MAX_SAFE_INTEGER, "9007199254740991"],
    [5e-324, "5e-324"],
  ])("writes the number %d as %s", (value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
  });

  it("does not depend on the order of members", () => {
    expect(canonicalJson({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  });

  it("is valid JSON that reads back as the same value", () => {
    fc.assert(
      fc.property(jsonValue, (value) => {
        expect(JSON.parse(canonicalJson(value))).toStrictEqual(value);
      }),
    );
  });
});

describe("utf8Length", () => {
  it("counts bytes, not characters", () => {
    expect(utf8Length("a")).toBe(1);
    expect(utf8Length("ö")).toBe(2);
    expect(utf8Length("€")).toBe(3);
    expect(utf8Length("🥛")).toBe(4);
  });
});
