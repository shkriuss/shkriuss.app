import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DataLayerError } from "./errors.ts";
import { field } from "./fields.ts";
import { MAX_RECEIVED_WALL, formatHlc } from "./hlc.ts";
import type { JsonValue } from "./json.ts";
import { mergeRecords } from "./merge.ts";
import { checkIncomingRecord, migrateRecord } from "./migrate.ts";
import { type DataRecord, MAX_RECORD_BYTES, checkRecord } from "./record.ts";
import { type SchemaVersion, checkData, defineSchemas } from "./schema.ts";
import { RECORD_ID, hlc } from "./test/arbitraries.ts";

const LIST_ID = "01a10307-cbc8-73e0-98ab-ae848aa1d694";

/** The HLC of a change `minute` minutes into the test's day. */
function at(minute: number, device = "aaaaaaaaaaaaaaaa"): string {
  return formatHlc({ wall: 1_791_052_200_000 + minute * 60_000, counter: 0, device });
}

const v1 = {
  version: 1,
  stores: {
    notes: {
      fields: {
        title: field.string({ maxLength: 100 }),
        done: field.boolean(),
        list: field.reference("lists"),
      },
    },
    drafts: { fields: { text: field.string({ maxLength: 100 }) } },
    lists: { fields: { name: field.string({ maxLength: 50 }) } },
    settings: { fields: { sortBy: field.enum(["title", "date"]) } },
  },
} satisfies SchemaVersion;

const v2 = {
  version: 2,
  stores: {
    notes: {
      fields: {
        name: field.string({ maxLength: 100 }),
        status: field.enum(["open", "done"]),
        label: field.string({ maxLength: 120 }),
        list: field.reference("lists"),
      },
    },
    lists: { fields: { name: field.string({ maxLength: 50 }) } },
    settings: v1.stores.settings,
  },
  migrate: {
    notes: {
      rename: { title: "name" },
      compute: {
        // From one field: it keeps that field's clock.
        status: { from: ["done"], value: ({ done }) => (done === true ? "done" : "open") },
        // From two: it gets the later of their clocks.
        label: {
          from: ["title", "done"],
          value: ({ title, done }) =>
            `${typeof title === "string" ? title : ""}${done === true ? " ✓" : ""}`,
        },
      },
      remove: ["done"],
    },
    drafts: { store: "notes", rename: { text: "name" } },
    lists: { convert: { name: (name) => (typeof name === "string" ? name.trim() : name) } },
  },
} satisfies SchemaVersion;

const v3 = {
  version: 3,
  stores: {
    ...v2.stores,
    lists: {
      fields: { name: field.string({ maxLength: 50 }), color: field.enum(["grey", "blue"]) },
    },
  },
} satisfies SchemaVersion;

const schemas = defineSchemas(v1, v2, v3);

function note(
  data: Record<string, JsonValue>,
  clock: Record<string, string>,
  deleted?: string,
): DataRecord {
  return deleted === undefined
    ? { id: RECORD_ID, v: 1, data, clock }
    : { id: RECORD_ID, v: 1, data, clock, deleted };
}

/** A list as the data layer stores it, which a migration function may try to change in place. */
function isList(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

describe("migrateRecord (data model §6)", () => {
  it("carries clocks over as the spec requires", () => {
    const record = note(
      { title: "Milk", done: true, list: LIST_ID },
      { title: at(1), done: at(5), list: at(2) },
    );
    expect(migrateRecord(schemas, { store: "notes", record })).toStrictEqual({
      store: "notes",
      record: {
        id: RECORD_ID,
        v: 3,
        // Renamed: value and clock. Kept: as it was. Computed from one field: its clock;
        // from two: the later clock. Removed: gone, with its clock.
        data: { name: "Milk", list: LIST_ID, status: "done", label: "Milk ✓" },
        clock: { name: at(1), list: at(2), status: at(5), label: at(5) },
      },
    });
  });

  it("leaves a computed field missing if all its sources are, and fills in defaults otherwise", () => {
    const record = note({ title: "Milk" }, { title: at(1) });
    const { record: migrated } = migrateRecord(schemas, { store: "notes", record });
    // `done` is missing: status stays missing, and label sees done's default, false.
    expect(migrated.data).toStrictEqual({ name: "Milk", label: "Milk" });
    expect(migrated.clock).toStrictEqual({ name: at(1), label: at(1) });
  });

  it("gives a computation each missing source as its default", () => {
    const counters = defineSchemas(
      {
        version: 1,
        stores: { counters: { fields: { a: field.number().default(5), b: field.number() } } },
      },
      {
        version: 2,
        stores: { counters: { fields: { total: field.number() } } },
        migrate: {
          counters: {
            compute: {
              total: {
                from: ["a", "b"],
                value: ({ a, b }) => (typeof a === "number" && typeof b === "number" ? a + b : -1),
              },
            },
            remove: ["a", "b"],
          },
        },
      },
    );
    const record: DataRecord = { id: RECORD_ID, v: 1, data: { b: 2 }, clock: { b: at(7) } };
    expect(migrateRecord(counters, { store: "counters", record }).record).toStrictEqual({
      id: RECORD_ID,
      v: 2,
      data: { total: 7 },
      clock: { total: at(7) },
    });
  });

  it("converts a value and keeps its clock", () => {
    const record: DataRecord = {
      id: LIST_ID,
      v: 1,
      data: { name: "  Food " },
      clock: { name: at(3) },
    };
    expect(migrateRecord(schemas, { store: "lists", record }).record).toStrictEqual({
      id: LIST_ID,
      v: 3,
      data: { name: "Food" },
      clock: { name: at(3) },
    });
  });

  it("moves every record of a store, deleted ones included", () => {
    const draft: DataRecord = {
      id: RECORD_ID,
      v: 1,
      data: { text: "Idea" },
      clock: { text: at(1) },
    };
    expect(migrateRecord(schemas, { store: "drafts", record: draft })).toStrictEqual({
      store: "notes",
      record: { id: RECORD_ID, v: 3, data: { name: "Idea" }, clock: { name: at(1) } },
    });
    const tombstone: DataRecord = { id: RECORD_ID, v: 1, data: {}, clock: {}, deleted: at(4) };
    expect(migrateRecord(schemas, { store: "drafts", record: tombstone })).toStrictEqual({
      store: "notes",
      record: { id: RECORD_ID, v: 3, data: {}, clock: {}, deleted: at(4) },
    });
  });

  it("gives a tombstone only the new version, and keeps a record that came back alive", () => {
    const revived = note({ done: false }, { done: at(6) }, at(4));
    expect(migrateRecord(schemas, { store: "notes", record: revived }).record).toStrictEqual({
      id: RECORD_ID,
      v: 3,
      data: { status: "open", label: "" },
      clock: { status: at(6), label: at(6) },
      deleted: at(4),
    });
  });

  it("gives the same result whatever the order of a record's fields", () => {
    const record = note(
      { title: "Milk", done: true, list: LIST_ID },
      { title: at(1), done: at(5), list: at(2) },
    );
    const reordered = note(
      { list: LIST_ID, done: true, title: "Milk" },
      { list: at(2), done: at(5), title: at(1) },
    );
    expect(migrateRecord(schemas, { store: "notes", record: reordered })).toStrictEqual(
      migrateRecord(schemas, { store: "notes", record }),
    );
  });

  it("gives a migration function a copy of each value, so that one which changes it changes nothing else", () => {
    const fields = { tags: field.array(field.string()), label: field.string() };
    const mutating = defineSchemas(
      { version: 1, stores: { notes: { fields } } },
      {
        version: 2,
        stores: { notes: { fields: { ...fields, count: field.number() } } },
        migrate: {
          notes: {
            convert: {
              tags: (tags) => {
                if (isList(tags)) {
                  tags.push("x");
                }
                return tags;
              },
            },
            compute: {
              count: {
                from: ["tags"],
                value: ({ tags }) => {
                  if (!isList(tags)) {
                    return 0;
                  }
                  tags.push("y");
                  return tags.length;
                },
              },
            },
          },
        },
      },
    );
    const record: DataRecord = {
      id: RECORD_ID,
      v: 1,
      data: { tags: ["a"] },
      clock: { tags: at(1) },
    };
    const first = migrateRecord(mutating, { store: "notes", record });
    // The record keeps its value, and each function changed a copy of its own.
    expect(record.data).toStrictEqual({ tags: ["a"] });
    expect(first.record.data).toStrictEqual({ tags: ["a", "x"], count: 2 });
    expect(migrateRecord(mutating, { store: "notes", record })).toStrictEqual(first);
  });

  it("returns a record of the current version as it is", () => {
    const stored = { store: "lists", record: { id: LIST_ID, v: 3, data: {}, clock: {} } };
    expect(migrateRecord(schemas, stored)).toStrictEqual(stored);
  });

  it("refuses a record newer than the current version", () => {
    const record = { id: LIST_ID, v: 4, data: {}, clock: {} };
    expect(() => migrateRecord(schemas, { store: "lists", record })).toThrow(/newer than 3/);
  });

  it("refuses a result that does not fit the next version's schema", () => {
    const faulty = defineSchemas(v1, {
      ...v2,
      migrate: { ...v2.migrate, lists: { convert: { name: (name) => [name] } } },
    });
    const record: DataRecord = {
      id: LIST_ID,
      v: 1,
      data: { name: "Food" },
      clock: { name: at(3) },
    };
    expect(() => migrateRecord(faulty, { store: "lists", record })).toThrow(
      "The field name of record 01a10307-cbc8-73e0-98ab-ae848aa1d694 of lists is not a string of at most 50 characters.",
    );
  });

  it("refuses a result beyond the limits", () => {
    const huge = defineSchemas(
      { version: 1, stores: { notes: { fields: { text: field.string() } } } },
      {
        version: 2,
        stores: { notes: { fields: { text: field.string() } } },
        migrate: { notes: { convert: { text: () => "x".repeat(MAX_RECORD_BYTES) } } },
      },
    );
    const record = note({ text: "x" }, { text: at(1) });
    expect(() => migrateRecord(huge, { store: "notes", record })).toThrow(
      expect.objectContaining({ code: "too-large" }),
    );
  });

  it("turns a failing migration function into a refusal of the record", () => {
    const failure = new Error("bug");
    const throwing = defineSchemas(v1, {
      ...v2,
      migrate: {
        ...v2.migrate,
        lists: {
          convert: {
            name: () => {
              throw failure;
            },
          },
        },
      },
    });
    const record: DataRecord = {
      id: LIST_ID,
      v: 1,
      data: { name: "Food" },
      clock: { name: at(3) },
    };
    expect(() => migrateRecord(throwing, { store: "lists", record })).toThrow(
      expect.objectContaining({ code: "invalid", cause: failure }),
    );
  });

  it("refuses a migration function that returns something other than JSON", () => {
    const notJson = defineSchemas(v1, {
      ...v2,
      migrate: { ...v2.migrate, lists: { convert: { name: () => Number.NaN } } },
    });
    const record: DataRecord = {
      id: LIST_ID,
      v: 1,
      data: { name: "Food" },
      clock: { name: at(3) },
    };
    expect(() => migrateRecord(notJson, { store: "lists", record })).toThrow(DataLayerError);
  });
});

describe("checkIncomingRecord (data model §8)", () => {
  const incoming = {
    id: RECORD_ID,
    v: 1,
    data: { title: "Milk", done: false },
    clock: { title: at(1), done: at(2) },
  };

  it("checks a record from outside and migrates it to the current version", () => {
    expect(
      checkIncomingRecord(schemas, "notes", JSON.parse(JSON.stringify(incoming))),
    ).toStrictEqual({
      store: "notes",
      record: {
        id: RECORD_ID,
        v: 3,
        data: { name: "Milk", status: "open", label: "Milk" },
        clock: { name: at(1), status: at(2), label: at(2) },
      },
    });
  });

  it.each<[string, unknown, string, string]>([
    ["a malformed record", { ...incoming, v: "1" }, "notes", "invalid"],
    [
      "a value invalid at its own version",
      { ...incoming, data: { title: 1, done: false } },
      "notes",
      "invalid",
    ],
    [
      "a field its version's store lacks",
      { ...incoming, data: { name: "Milk", done: false }, clock: { name: at(1), done: at(2) } },
      "notes",
      "invalid",
    ],
    ["a store its version lacks", { ...incoming, data: {}, clock: {} }, "tasks", "invalid"],
    ["a version newer than the app's", { ...incoming, v: 4 }, "notes", "invalid"],
    [
      "a clock after the year 9999",
      {
        ...incoming,
        clock: {
          title: at(1),
          done: formatHlc({ wall: MAX_RECEIVED_WALL + 1, counter: 0, device: "aaaaaaaaaaaaaaaa" }),
        },
      },
      "notes",
      "invalid",
    ],
  ])("refuses %s", (_case, value, store, code) => {
    expect(() => checkIncomingRecord(schemas, store, value)).toThrow(
      expect.objectContaining({ code }),
    );
  });

  it("checks a record's data against the schema of its own version", () => {
    const lists = { id: LIST_ID, v: 3, data: { color: "blue" }, clock: { color: at(1) } };
    expect(checkIncomingRecord(schemas, "lists", lists).record.data).toStrictEqual({
      color: "blue",
    });
    expect(() => checkIncomingRecord(schemas, "lists", { ...lists, v: 1 })).toThrow(
      /has a field color, which its store lacks/,
    );
  });
});

/** A value that depends only on the field and the change, as in any consistent history. */
function valueOf(name: string, clock: string): JsonValue {
  switch (name) {
    case "title":
      return `t${clock.slice(-6)}`;
    case "done":
      return Number.parseInt(clock.slice(-1), 16) % 2 === 0;
    default:
      return Number.parseInt(clock.slice(-1), 16) % 3 === 0 ? null : LIST_ID;
  }
}

describe("migrateRecord: properties", () => {
  /** A copy of the note `RECORD_ID` from a consistent history, at version 1. */
  const consistentNote = fc
    .record({
      title: fc.option(hlc, { nil: undefined }),
      done: fc.option(hlc, { nil: undefined }),
      list: fc.option(hlc, { nil: undefined }),
      deleted: fc.option(hlc, { nil: undefined }),
    })
    .map(({ deleted, ...clocks }) => {
      const data: Record<string, JsonValue> = {};
      const clock: Record<string, string> = {};
      for (const [name, written] of Object.entries(clocks)) {
        if (written !== undefined && (deleted === undefined || written > deleted)) {
          data[name] = valueOf(name, written);
          clock[name] = written;
        }
      }
      return note(data, clock, deleted);
    });

  it("is deterministic, and gives records that pass every check", () => {
    fc.assert(
      fc.property(consistentNote, (record) => {
        const first = migrateRecord(schemas, { store: "notes", record });
        expect(migrateRecord(schemas, { store: "notes", record })).toStrictEqual(first);
        expect(checkRecord(first.record, { store: "notes", version: 3 })).toStrictEqual(
          first.record,
        );
        checkData(v3.stores.notes, first.record.data, "a migrated note");
      }),
    );
  });

  it("keeps the id and the tombstone, and every clock it carries over", () => {
    fc.assert(
      fc.property(consistentNote, (record) => {
        const { record: migrated } = migrateRecord(schemas, { store: "notes", record });
        expect(migrated.id).toBe(record.id);
        expect(migrated.deleted).toBe(record.deleted);
        expect(migrated.clock["name"]).toBe(record.clock["title"]);
        expect(migrated.clock["status"]).toBe(record.clock["done"]);
      }),
    );
  });

  it("merges the same way before and after migrating, for fields computed from one field", () => {
    // A field computed from several fields gets only the later clock, so merging can then keep a
    // value computed from older sources: a known limit of per-field merging (data model §6).
    const singleSource = defineSchemas(v1, {
      ...v2,
      stores: { ...v2.stores, notes: { fields: { ...v2.stores.notes.fields } } },
      migrate: {
        ...v2.migrate,
        notes: { ...v2.migrate.notes, compute: { status: v2.migrate.notes.compute.status } },
      },
    });
    const migrate = (record: DataRecord): DataRecord =>
      migrateRecord(singleSource, { store: "notes", record }).record;
    fc.assert(
      fc.property(consistentNote, consistentNote, (a, b) => {
        expect(migrate(mergeRecords(a, b))).toStrictEqual(mergeRecords(migrate(a), migrate(b)));
      }),
      { numRuns: 500 },
    );
  });
});
