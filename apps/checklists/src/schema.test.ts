import {
  type StoredRecord,
  checkRecord,
  migrationProblems,
  schemaSignatures,
} from "@shkriuss/data";
import { describe, expect, it } from "vitest";
import schema1 from "../e2e/fixtures/format-1-schema-1.json";
import { schemas } from "./schema.ts";

/** The plain backup fixture of each schema version (backup format §8); add each new one here. */
const FIXTURES = [schema1];

/** Every record of the fixtures, checked as an import checks it, at its own version. */
function fixtureRecords(): StoredRecord[] {
  const records: StoredRecord[] = [];
  for (const { schemaVersion, stores } of FIXTURES) {
    for (const [store, values] of Object.entries<readonly unknown[]>(stores)) {
      for (const value of values) {
        records.push({ store, record: checkRecord(value, { store, version: schemaVersion }) });
      }
    }
  }
  return records;
}

describe("the app's schema versions (data model §6)", () => {
  // A version that shipped never changes: the database and every backup carry only its number.
  // Any change to a store, to a field, to the values it holds or to its default needs a new
  // version with a migration, and a literal of its own here. The literals of the versions that
  // shipped stay as they are.
  it("keeps every version that shipped as it was", () => {
    expect(schemaSignatures(schemas)).toStrictEqual({
      1: {
        lists: { name: { type: "string(0,100)", default: "" } },
        items: {
          list: { type: "id|null", default: null },
          text: { type: "string(0,200)", default: "" },
          done: { type: "boolean", default: false },
        },
      },
    });
  });

  // Every device must turn the same record into the same result (data model §6): the check runs
  // each migration on records of every field's default, and on the records of the fixtures.
  it("migrates every record the same way every time", () => {
    const records = fixtureRecords();
    expect(records.length).toBeGreaterThan(0);
    expect(migrationProblems(schemas, records)).toStrictEqual([]);
  });
});
