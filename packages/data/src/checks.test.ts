import { describe, expect, it } from "vitest";
import { migrationProblems, schemaSignatures } from "./checks.ts";
import { field } from "./fields.ts";
import { formatHlc } from "./hlc.ts";
import type { JsonValue } from "./json.ts";
import type { DataRecord } from "./record.ts";
import { type SchemaVersion, defineSchemas } from "./schema.ts";
import { VERSION_1, VERSION_2 } from "./test/storage.ts";

const ID = "01a10307-b840-78aa-ab29-1a1138faaff6";
const HLC = formatHlc({ wall: 1_791_052_200_000, counter: 0, device: "9f86d081884c7d65" });

function record(v: number, data: Record<string, JsonValue>): DataRecord {
  const clock = Object.fromEntries(Object.keys(data).map((name) => [name, HLC]));
  return { id: ID, v, data, clock };
}

const NOTES_V1 = { version: 1, stores: { notes: { fields: { title: field.string() } } } };

/** Version 2 of `NOTES_V1`, which computes a label from the title with `value`. */
function computing(value: (title: JsonValue) => JsonValue): SchemaVersion {
  return {
    version: 2,
    stores: { notes: { fields: { title: field.string(), label: field.string() } } },
    migrate: {
      notes: {
        compute: { label: { from: ["title"], value: ({ title }) => value(title ?? null) } },
      },
    },
  };
}

describe("schemaSignatures (data model §6)", () => {
  it("maps every version, store and field to its type's signature and its default", () => {
    const settings = { sortBy: { type: 'enum(["date","title"])', default: "title" } };
    expect(schemaSignatures(VERSION_2)).toStrictEqual({
      1: {
        notes: {
          title: { type: "string(0,100)", default: "" },
          done: { type: "boolean", default: false },
          list: { type: "id|null", default: null },
        },
        lists: { name: { type: "string(0,Infinity)", default: "" } },
        settings,
      },
      2: {
        notes: {
          name: { type: "string(0,100)", default: "" },
          status: { type: 'enum(["done","open"])', default: "open" },
          folder: { type: "id|null", default: null },
        },
        folders: { name: { type: "string(0,Infinity)", default: "" } },
        settings,
      },
    });
    expect(Object.keys(schemaSignatures(VERSION_1))).toStrictEqual(["1"]);
  });

  it("differs when only a default differs, which a type's signature does not show", () => {
    const first = defineSchemas({
      version: 1,
      stores: { notes: { fields: { sortBy: field.enum(["title", "date"]) } } },
    });
    const second = defineSchemas({
      version: 1,
      stores: { notes: { fields: { sortBy: field.enum(["date", "title"]) } } },
    });
    expect(first.current.stores.notes.fields.sortBy.signature).toBe(
      second.current.stores.notes.fields.sortBy.signature,
    );
    expect(schemaSignatures(first)).not.toStrictEqual(schemaSignatures(second));
  });
});

describe("migrationProblems (data model §6)", () => {
  it("finds none in migrations that are pure and deterministic, with or without samples", () => {
    expect(migrationProblems(VERSION_1)).toStrictEqual([]);
    expect(migrationProblems(VERSION_2)).toStrictEqual([]);
    const samples = [
      { store: "notes", record: record(1, { title: "Milk", done: true, list: ID }) },
      { store: "lists", record: record(1, { name: "Shopping" }) },
      { store: "notes", record: { ...record(1, {}), deleted: HLC } },
      // A record of the current version, which no migration touches.
      { store: "folders", record: record(2, { name: "Shopping" }) },
    ];
    expect(migrationProblems(VERSION_2, samples)).toStrictEqual([]);
  });

  it("reports a migration whose results differ from one run to the next, as one that reads the time or random numbers", () => {
    let calls = 0;
    const counting = defineSchemas(
      NOTES_V1,
      computing(() => {
        calls += 1;
        return String(calls);
      }),
    );
    // A record without the title has no label to compute; the two with one do.
    expect(migrationProblems(counting)).toStrictEqual([
      "The migration of notes to version 2 gives different results for a record of notes at version 1 with only the field title at its default when it runs twice.",
      "The migration of notes to version 2 gives different results for a record of notes at version 1 with every field at its default when it runs twice.",
    ]);
  });

  it("reports a result that differs once the fields are in another order", () => {
    // No migration function sees the order of a record's fields, so this guards the data layer's
    // own steps; here, a function whose third result differs stands in for one that did.
    let calls = 0;
    const ordered = defineSchemas(
      NOTES_V1,
      computing(() => {
        calls += 1;
        return calls % 3 === 0 ? "third" : "same";
      }),
    );
    const problems = migrationProblems(ordered);
    expect(problems).toContain(
      "The migration of notes to version 2 depends on the order of the fields of a record of notes at version 1 with only the field title at its default.",
    );
  });

  it("reports a migration that fails for a record of defaults, or for a sample", () => {
    const failing = defineSchemas(
      NOTES_V1,
      computing((title) => {
        if (title === "") {
          throw new Error("An empty title.");
        }
        return typeof title === "string" ? title : "";
      }),
    );
    expect(migrationProblems(failing)).toStrictEqual([
      expect.stringMatching(
        /^The migration of notes to version 2 fails for a record of notes at version 1 with only the field title at its default: the migration of record .* \(label\) failed\.$/,
      ),
      expect.stringMatching(
        /^The migration of notes to version 2 fails for a record of notes at version 1 with every field at its default: /,
      ),
    ]);
    // A sample with a field that its version's store lacks fails the migration's check.
    const stranger = { store: "notes", record: record(1, { title: "Milk", extra: 1 }) };
    expect(migrationProblems(VERSION_2, [stranger])).toStrictEqual([
      expect.stringMatching(
        /^The migration of notes from version 1 fails for record 01a10307-b840-78aa-ab29-1a1138faaff6: /,
      ),
    ]);
  });
});
