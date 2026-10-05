import { describe, expect, it } from "vitest";
import { createRecord, deleteRecord, updateRecord } from "./changes.ts";
import { DataLayerError } from "./errors.ts";
import { formatHlc } from "./hlc.ts";
import { MAX_FIELDS, MAX_RECORD_BYTES, isDeleted } from "./record.ts";

const ID = "01a10307-b840-78aa-ab29-1a1138faaff6";
const DEVICE = "9f86d081884c7d65";

/** The HLC of a change `seconds` seconds into the test's day. */
function at(seconds: number): string {
  return formatHlc({ wall: 1_791_052_200_000 + seconds * 1000, counter: 0, device: DEVICE });
}

function codeOf(write: () => unknown): string | undefined {
  try {
    write();
    return undefined;
  } catch (error) {
    return error instanceof DataLayerError ? error.code : "not a DataLayerError";
  }
}

describe("createRecord (data model §4.1)", () => {
  it("stores each field given with the change's clock, and nothing else", () => {
    expect(createRecord(ID, 1, { title: "Milk", done: false }, at(1))).toStrictEqual({
      id: ID,
      v: 1,
      data: { title: "Milk", done: false },
      clock: { title: at(1), done: at(1) },
    });
  });

  it("creates a record without fields, whose fields all read as their defaults", () => {
    expect(createRecord(ID, 3, {}, at(1))).toStrictEqual({ id: ID, v: 3, data: {}, clock: {} });
  });

  it("stores a copy of each value, with -0 as 0", () => {
    const tags = ["a"];
    const record = createRecord(ID, 1, { tags, count: -0 }, at(1));
    tags.push("b");
    expect(record.data).toStrictEqual({ tags: ["a"], count: 0 });
  });

  it.each([
    ["an id that is not a UUIDv7", () => createRecord("1", 1, {}, at(1))],
    ["schema version 0", () => createRecord(ID, 0, {}, at(1))],
    ["a fractional schema version", () => createRecord(ID, 1.5, {}, at(1))],
    ["a clock that is not an HLC", () => createRecord(ID, 1, {}, "now")],
    ["a field name that is not allowed", () => createRecord(ID, 1, { Title: "x" }, at(1))],
    ["a value that is not JSON", () => createRecord(ID, 1, { title: undefined }, at(1))],
  ])("refuses %s", (_case, write) => {
    expect(codeOf(write)).toBe("invalid");
  });

  it("refuses records beyond the limits of data model §2.4", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: MAX_FIELDS + 1 }, (_, index) => [`f${index}`, 1]),
    );
    expect(codeOf(() => createRecord(ID, 1, tooMany, at(1)))).toBe("too-large");
    const huge = { note: "x".repeat(MAX_RECORD_BYTES) };
    expect(codeOf(() => createRecord(ID, 1, huge, at(1)))).toBe("too-large");
  });
});

describe("updateRecord (data model §4.2)", () => {
  const created = createRecord(ID, 1, { title: "Milk", done: false }, at(1));

  it("writes each field with the change's clock and keeps the others", () => {
    expect(updateRecord(created, { done: true, note: "2 l" }, at(2))).toStrictEqual({
      id: ID,
      v: 1,
      data: { title: "Milk", done: true, note: "2 l" },
      clock: { title: at(1), done: at(2), note: at(2) },
    });
  });

  it("writes a field even when its value does not change", () => {
    expect(updateRecord(created, { done: false }, at(2)).clock["done"]).toBe(at(2));
  });

  it("returns the same record when there is nothing to write", () => {
    expect(updateRecord(created, {}, at(2))).toBe(created);
  });

  it("leaves the record it was given unchanged", () => {
    updateRecord(created, { title: "Oat milk" }, at(2));
    expect(created.data["title"]).toBe("Milk");
  });

  it("refuses to update a deleted record", () => {
    const deleted = deleteRecord(created, at(2));
    expect(codeOf(() => updateRecord(deleted, { title: "x" }, at(3)))).toBe("deleted");
    expect(codeOf(() => updateRecord(deleted, {}, at(3)))).toBe("deleted");
  });

  it("updates a record that came back after a deletion", () => {
    const revived = {
      ...deleteRecord(created, at(2)),
      data: { done: true },
      clock: { done: at(3) },
    };
    const updated = updateRecord(revived, { title: "Oat milk" }, at(4));
    expect(updated).toStrictEqual({
      id: ID,
      v: 1,
      data: { done: true, title: "Oat milk" },
      clock: { done: at(3), title: at(4) },
      deleted: at(2),
    });
  });

  it("refuses a clock earlier than the record's last change", () => {
    expect(codeOf(() => updateRecord(created, { done: true }, at(0)))).toBe("invalid");
  });

  it("accepts the clock of the change that wrote the record last: it writes the record again", () => {
    expect(updateRecord(created, { done: true }, at(1))).toStrictEqual({
      id: ID,
      v: 1,
      data: { title: "Milk", done: true },
      clock: { title: at(1), done: at(1) },
    });
  });

  it("refuses invalid fields and records beyond the limits", () => {
    expect(codeOf(() => updateRecord(created, { "a-b": 1 }, at(2)))).toBe("invalid");
    expect(codeOf(() => updateRecord(created, { title: Symbol("x") }, at(2)))).toBe("invalid");
    expect(codeOf(() => updateRecord(created, { title: "x" }, "later"))).toBe("invalid");
    expect(codeOf(() => updateRecord(created, { note: "x".repeat(MAX_RECORD_BYTES) }, at(2)))).toBe(
      "too-large",
    );
  });
});

describe("deleteRecord (data model §4.3)", () => {
  const created = createRecord(ID, 1, { title: "Milk", done: false }, at(1));

  it("erases every field and keeps the id, the schema version and the time of deletion", () => {
    const deleted = deleteRecord(created, at(2));
    expect(deleted).toStrictEqual({ id: ID, v: 1, data: {}, clock: {}, deleted: at(2) });
    expect(isDeleted(deleted)).toBe(true);
  });

  it("returns the same record when it is already deleted", () => {
    const deleted = deleteRecord(created, at(2));
    expect(deleteRecord(deleted, at(3))).toBe(deleted);
  });

  it("refuses a clock earlier than the record's last change", () => {
    expect(codeOf(() => deleteRecord(created, at(0)))).toBe("invalid");
    expect(codeOf(() => deleteRecord(created, "now"))).toBe("invalid");
  });

  it("accepts the clock of the change that wrote the record last: it deletes what it wrote", () => {
    expect(deleteRecord(created, at(1))).toStrictEqual({
      id: ID,
      v: 1,
      data: {},
      clock: {},
      deleted: at(1),
    });
  });
});
