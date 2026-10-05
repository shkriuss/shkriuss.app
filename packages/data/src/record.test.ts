import { describe, expect, it } from "vitest";
import { DataLayerError, type DataLayerErrorCode } from "./errors.ts";
import { MAX_CLOCK_AHEAD, formatHlc } from "./hlc.ts";
import { SETTINGS_ID } from "./ids.ts";
import {
  MAX_FIELDS,
  MAX_RECORD_BYTES,
  type RecordContext,
  assertWithinLimits,
  checkRecord,
  isDeleted,
  lastChange,
  toJson,
} from "./record.ts";

const NOW = 1_791_200_000_000;
const CONTEXT: RecordContext = { store: "notes", version: 2, now: NOW };

// The examples of data model §2.1.
const LIVE = {
  id: "01a10307-b840-78aa-ab29-1a1138faaff6",
  v: 1,
  data: { title: "Milk", done: true },
  clock: {
    title: "001791052200000:00000:9f86d081884c7d65",
    done: "001791101700000:00000:3c2b1a0f9e8d7c6b",
  },
};
const TOMBSTONE = {
  id: "01a10307-cbc8-73e0-98ab-ae848aa1d694",
  v: 1,
  data: {},
  clock: {},
  deleted: "001791104400000:00000:9f86d081884c7d65",
};

function refusal(value: unknown, context: RecordContext = CONTEXT): DataLayerErrorCode | undefined {
  try {
    checkRecord(value, context);
    return undefined;
  } catch (error) {
    if (error instanceof DataLayerError) {
      return error.code;
    }
    throw error;
  }
}

describe("deleted or alive (data model §2.2)", () => {
  it("tells a tombstone from a live record", () => {
    expect(isDeleted(LIVE)).toBe(false);
    expect(isDeleted(TOMBSTONE)).toBe(true);
  });

  it("counts a record changed after its deletion as alive", () => {
    const revived = { ...LIVE, deleted: "001791000000000:00000:9f86d081884c7d65" };
    expect(isDeleted(revived)).toBe(false);
  });

  it("finds the last change among the clocks and the tombstone", () => {
    expect(lastChange(LIVE)).toBe(LIVE.clock.done);
    expect(lastChange(TOMBSTONE)).toBe(TOMBSTONE.deleted);
    expect(lastChange({ id: LIVE.id, v: 1, data: {}, clock: {} })).toBeUndefined();
  });
});

describe("checkRecord (data model §8, step 1)", () => {
  it("accepts the examples of the data model and returns a copy", () => {
    expect(checkRecord(LIVE, CONTEXT)).toStrictEqual(LIVE);
    expect(checkRecord(TOMBSTONE, CONTEXT)).toStrictEqual(TOMBSTONE);
    expect(checkRecord(LIVE, CONTEXT)).not.toBe(LIVE);
  });

  it("accepts records parsed from JSON, and stores -0 as 0", () => {
    const parsed: unknown = JSON.parse(JSON.stringify({ ...LIVE, data: { title: "x", done: 0 } }));
    const withNegativeZero: unknown = JSON.parse(
      JSON.stringify(parsed).replace('"done":0', '"done":-0'),
    );
    expect(checkRecord(withNegativeZero, CONTEXT).data).toStrictEqual({ title: "x", done: 0 });
  });

  it("accepts the settings record with its fixed id, and only that id", () => {
    const settings = { ...LIVE, id: SETTINGS_ID };
    expect(checkRecord(settings, { ...CONTEXT, store: "settings" }).id).toBe(SETTINGS_ID);
    expect(refusal(LIVE, { ...CONTEXT, store: "settings" })).toBe("invalid");
  });

  it("refuses a deleted settings record, alive again or not: settings are never deleted", () => {
    const context = { ...CONTEXT, store: "settings" };
    expect(refusal({ ...TOMBSTONE, id: SETTINGS_ID }, context)).toBe("invalid");
    const revived = { ...LIVE, id: SETTINGS_ID, deleted: "001791000000000:00000:9f86d081884c7d65" };
    expect(refusal(revived, context)).toBe("invalid");
    expect(refusal({ ...TOMBSTONE }, CONTEXT)).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ["something other than an object", "record"],
    ["null", null],
    ["an array", [LIVE]],
    ["an unknown member", { ...LIVE, extra: 1 }],
    ["an id in upper case", { ...LIVE, id: LIVE.id.toUpperCase() }],
    ["a UUIDv4", { ...LIVE, id: "01a10307-b840-48aa-ab29-1a1138faaff6" }],
    ["a missing id", { v: 1, data: {}, clock: {} }],
    ["schema version 0", { ...LIVE, v: 0 }],
    ["a schema version above the app's", { ...LIVE, v: 3 }],
    ["a fractional schema version", { ...LIVE, v: 1.5 }],
    ["a schema version as a string", { ...LIVE, v: "1" }],
    ["data that is an array", { ...LIVE, data: [] }],
    ["a missing clock", { id: LIVE.id, v: 1, data: {} }],
    ["a field without a clock", { ...LIVE, clock: { title: LIVE.clock.title } }],
    ["a clock without a field", { ...LIVE, data: { title: "Milk" } }],
    [
      "a clock for another field",
      { ...LIVE, clock: { title: LIVE.clock.title, note: LIVE.clock.done } },
    ],
    [
      "a field name in upper case",
      { ...LIVE, data: { Title: "x" }, clock: { Title: LIVE.clock.title } },
    ],
    [
      "a field named like an Object member",
      { ...LIVE, data: { valueOf: 1 }, clock: { valueOf: LIVE.clock.title } },
    ],
    ["a clock that is not an HLC", { ...LIVE, clock: { ...LIVE.clock, done: "yesterday" } }],
    ["a tombstone that is not an HLC", { ...TOMBSTONE, deleted: 1_791_104_400_000 }],
    ["a tombstone that is null", { ...TOMBSTONE, deleted: null }],
    ["a clock before the tombstone", { ...LIVE, deleted: LIVE.clock.done }],
    [
      "a clock equal to the tombstone",
      { ...LIVE, data: { done: true }, clock: { done: LIVE.clock.done }, deleted: LIVE.clock.done },
    ],
    ["a value that is not JSON", { ...LIVE, data: { ...LIVE.data, done: Number.NaN } }],
  ])("refuses %s", (_case, value) => {
    expect(refusal(value)).toBe("invalid");
  });

  it("refuses a member named __proto__ inside a value", () => {
    const crafted: unknown = JSON.parse(
      `{"id":"${LIVE.id}","v":1,"data":{"title":{"__proto__":{"admin":true}}},"clock":{"title":"${LIVE.clock.title}"}}`,
    );
    expect(refusal(crafted)).toBe("invalid");
  });

  it("refuses clocks more than 24 hours after this device's time (data model §3.5)", () => {
    const tomorrow = formatHlc({
      wall: NOW + MAX_CLOCK_AHEAD + 1,
      counter: 0,
      device: "0000000000000001",
    });
    const limit = formatHlc({
      wall: NOW + MAX_CLOCK_AHEAD,
      counter: 0,
      device: "0000000000000001",
    });
    expect(refusal({ ...LIVE, clock: { ...LIVE.clock, done: tomorrow } })).toBe("future-clock");
    expect(refusal({ ...TOMBSTONE, deleted: tomorrow })).toBe("future-clock");
    expect(refusal({ ...LIVE, clock: { ...LIVE.clock, done: limit } })).toBeUndefined();
  });

  it(`refuses more than ${MAX_FIELDS} fields`, () => {
    const fields = Array.from({ length: MAX_FIELDS + 1 }, (_, index) => `f${index}`);
    const data = Object.fromEntries(fields.map((field) => [field, 1]));
    const clock = Object.fromEntries(fields.map((field) => [field, LIVE.clock.title]));
    expect(refusal({ ...LIVE, data, clock })).toBe("too-large");
    const allowed = fields.slice(1);
    expect(
      refusal({
        ...LIVE,
        data: Object.fromEntries(allowed.map((field) => [field, 1])),
        clock: Object.fromEntries(allowed.map((field) => [field, LIVE.clock.title])),
      }),
    ).toBeUndefined();
  });

  it("refuses a record larger than 1 MiB as canonical JSON", () => {
    const overhead = JSON.stringify(
      toJson({ ...LIVE, data: { title: "" }, clock: { title: LIVE.clock.title } }),
    ).length;
    const fits = "x".repeat(MAX_RECORD_BYTES - overhead);
    const record = { ...LIVE, data: { title: fits }, clock: { title: LIVE.clock.title } };
    expect(refusal(record)).toBeUndefined();
    expect(refusal({ ...record, data: { title: `${fits}x` } })).toBe("too-large");
  });

  it("measures the size in UTF-8 bytes", () => {
    const overhead = JSON.stringify(
      toJson({ ...LIVE, data: { title: "" }, clock: { title: LIVE.clock.title } }),
    ).length;
    // "ö" takes two bytes in UTF-8, one code unit in JavaScript.
    const title = "ö".repeat(Math.ceil((MAX_RECORD_BYTES - overhead) / 2) + 1);
    expect(refusal({ ...LIVE, data: { title }, clock: { title: LIVE.clock.title } })).toBe(
      "too-large",
    );
  });
});

describe("toJson and assertWithinLimits", () => {
  it("writes the members of data model §2.1, and deleted only if there is one", () => {
    expect(toJson(LIVE)).toStrictEqual(LIVE);
    expect(toJson(TOMBSTONE)).toStrictEqual(TOMBSTONE);
    expect(Object.keys(toJson(LIVE))).not.toContain("deleted");
  });

  it("accepts a record within the limits", () => {
    expect(() => {
      assertWithinLimits(LIVE);
    }).not.toThrow();
  });
});
