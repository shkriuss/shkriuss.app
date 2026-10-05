import { describe, expect, expectTypeOf, it } from "vitest";
import { type FieldType, type TypeOf, field } from "./fields.ts";

const ID = "01a10307-b840-78aa-ab29-1a1138faaff6";

function check(
  type: FieldType<unknown>,
  valid: readonly unknown[],
  invalid: readonly unknown[],
): void {
  // Each value with its verdict, so that a failure shows which value was misjudged.
  const judged = (values: readonly unknown[]): unknown[] =>
    values.map((value) => [value, type.isValid(value)]);
  expect(judged(valid)).toStrictEqual(valid.map((value) => [value, true]));
  expect(judged(invalid)).toStrictEqual(invalid.map((value) => [value, false]));
}

describe("field types (data model §2.3)", () => {
  it("string: lengths in UTF-16 code units, as HTML counts them", () => {
    const type = field.string({ minLength: 1, maxLength: 3 });
    check(type, ["a", "abc", "😀"], ["", "abcd", "😀😀", 1, null, ["a"]]);
    expect(type.description).toBe("a string of 1 to 3 characters");
    expect(type.defaultValue).toBeUndefined();
    expect(field.string().defaultValue).toBe("");
    expectTypeOf<TypeOf<typeof type>>().toEqualTypeOf<string>();
    expect(field.string().description).toBe("a string of any number of characters");
    expect(field.string({ maxLength: 200 }).description).toBe("a string of at most 200 characters");
    expect(field.string({ minLength: 2 }).description).toBe("a string of at least 2 characters");
    expect(field.string({ minLength: 2, maxLength: 2 }).description).toBe(
      "a string of exactly 2 characters",
    );
  });

  it("number: finite, within its bounds, and whole if asked", () => {
    check(field.number(), [0, -1.5, 1e300], ["1", null, true]);
    const type = field.number({ min: 1, max: 10, integer: true });
    check(type, [1, 10, 5], [0, 11, 1.5, Number.NaN]);
    expect(type.description).toBe("a whole number from 1 to 10");
    expect(type.defaultValue).toBeUndefined();
    expect(field.number().defaultValue).toBe(0);
    check(field.number({ integer: true }), [2 ** 53 - 1], [2 ** 53]);
  });

  it("boolean: true or false, false by default", () => {
    check(field.boolean(), [true, false], [0, "true", null]);
    expect(field.boolean().defaultValue).toBe(false);
  });

  it("enum: one of its values, the first by default", () => {
    const type = field.enum(["low", "normal", "high"]);
    check(type, ["low", "high"], ["LOW", "", 0, null]);
    expect(type.defaultValue).toBe("low");
    expectTypeOf(type).toEqualTypeOf<FieldType<"low" | "normal" | "high">>();
    expect(type.description).toBe('one of "low", "normal", "high"');
    expect(() => field.enum(["a", "a"])).toThrow(/must be different/);
  });

  it("reference: a record id or null, null by default", () => {
    const type = field.reference("lists");
    check(type, [ID, null], ["", ID.toUpperCase(), 1]);
    expect(type.defaultValue).toBeNull();
    expect(type.references).toBe("lists");
    expectTypeOf(type).toEqualTypeOf<FieldType<string | null>>();
    expect(() => field.reference("Lists")).toThrow(/not a store name/);
    expect(() => field.reference("meta")).toThrow(/not a store name/);
  });

  it("date: a real calendar date, with no default", () => {
    check(
      field.date(),
      ["2026-10-05", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"],
      [
        "2026-02-29",
        "1900-02-29",
        "2026-13-01",
        "2026-00-10",
        "2026-04-31",
        "0000-01-01",
        "2026-1-5",
        "20261005",
        20261005,
      ],
    );
    expect(field.date().defaultValue).toBeUndefined();
  });

  it("timestamp: whole milliseconds, also before 1970, with no default", () => {
    check(field.timestamp(), [0, 1_791_052_200_000, -86_400_000], [1.5, "0", null, 2 ** 53]);
    expect(field.timestamp().defaultValue).toBeUndefined();
  });

  it("array: items of one type, within its bounds", () => {
    const type = field.array(field.string({ maxLength: 2 }), { maxItems: 2 });
    check(type, [[], ["a"], ["ab", "cd"]], [["abc"], ["a", "b", "c"], "a", null, [1]]);
    expect(type.defaultValue).toStrictEqual([]);
    expectTypeOf(type).toEqualTypeOf<FieldType<readonly string[]>>();
    expect(type.description).toBe(
      "a list of at most 2 items, each a string of at most 2 characters",
    );
    expect(field.array(field.boolean(), { minItems: 1 }).defaultValue).toBeUndefined();
  });

  it("object: exactly its members, each of its type", () => {
    const type = field.object({
      amount: field.number({ min: 0 }),
      currency: field.string({ maxLength: 3 }),
    });
    check(
      type,
      [{ amount: 1, currency: "EUR" }],
      [
        { amount: 1 },
        { amount: 1, currency: "EUR", extra: 1 },
        { amount: -1, currency: "EUR" },
        [1, "EUR"],
        null,
      ],
    );
    expect(type.defaultValue).toStrictEqual({ amount: 0, currency: "" });
    expectTypeOf<TypeOf<typeof type>>().toEqualTypeOf<{
      readonly amount: number;
      readonly currency: string;
    }>();
    expect(field.object({ when: field.date() }).defaultValue).toBeUndefined();
    expect(() => field.object({ "Bad-name": field.boolean() })).toThrow(/not allowed/);
  });

  it("refuses objects that are not plain JSON objects", () => {
    const type = field.object({ a: field.number() });
    class Point {
      a = 1;
    }
    expect(type.isValid(JSON.parse('{"a": 1}'))).toBe(true);
    expect(type.isValid(new Point())).toBe(false);
    expect(type.isValid(new Map([["a", 1]]))).toBe(false);
  });

  it("nullable: also null, which becomes the default", () => {
    const type = field.date().nullable();
    check(type, ["2026-10-05", null], ["", 0]);
    expect(type.defaultValue).toBeNull();
    expect(type.description).toBe("a date (YYYY-MM-DD), or null");
    expectTypeOf(type).toEqualTypeOf<FieldType<string | null>>();
    expect(field.reference("lists").nullable().references).toBe("lists");
  });

  it("default: replaces the default, which must be valid", () => {
    expect(field.enum(["a", "b"]).default("b").defaultValue).toBe("b");
    expect(field.date().default("2026-01-01").defaultValue).toBe("2026-01-01");
    expect(() => field.date().default("tomorrow")).toThrow(/default is not a date/);
    expect(() => field.number().default(Number.NaN)).toThrow(/not finite/);
  });

  it("freezes defaults, so that no reader can change them for every other", () => {
    const type = field.array(field.string()).default(["a"]);
    expect(Object.isFrozen(type.defaultValue)).toBe(true);
    const nested = field.object({ tags: field.array(field.string()) });
    expect(Object.isFrozen(nested.defaultValue)).toBe(true);
    expect(Object.isFrozen(nested.defaultValue?.tags)).toBe(true);
  });

  it("refuses bounds that make no sense", () => {
    expect(() => field.string({ minLength: 5, maxLength: 2 })).toThrow(/bounds/);
    expect(() => field.string({ minLength: -1 })).toThrow(/bounds/);
    expect(() => field.array(field.boolean(), { maxItems: Number.NaN })).toThrow(/bounds/);
    expect(() => field.number({ min: 2, max: 1 })).toThrow(/min/);
  });
});
