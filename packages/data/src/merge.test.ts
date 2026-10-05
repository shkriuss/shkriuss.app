import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createRecord, deleteRecord, updateRecord } from "./changes.ts";
import { DataError } from "./errors.ts";
import { formatHlc, maxHlc } from "./hlc.ts";
import { canonicalJson } from "./json.ts";
import { mergeRecords } from "./merge.ts";
import { type DataRecord, checkRecord, isDeleted } from "./record.ts";
import { RECORD_ID, dataRecord } from "./test/arbitraries.ts";

// Times in the past of every test run, so that no clock is from the future.
const NOW = 1_791_100_000_000;
const A = "aaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbb";

/** The HLC of a change at `minute` minutes into the test's day, on device `device`. */
function at(minute: number, device = A): string {
  return formatHlc({ wall: 1_791_052_200_000 + minute * 60_000, counter: 0, device });
}

describe("mergeRecords: properties (data model §5.3)", () => {
  it("is commutative", () => {
    fc.assert(
      fc.property(dataRecord, dataRecord, (a, b) => {
        expect(mergeRecords(a, b)).toStrictEqual(mergeRecords(b, a));
      }),
      { numRuns: 1000 },
    );
  });

  it("is associative", () => {
    fc.assert(
      fc.property(dataRecord, dataRecord, dataRecord, (a, b, c) => {
        expect(mergeRecords(mergeRecords(a, b), c)).toStrictEqual(
          mergeRecords(a, mergeRecords(b, c)),
        );
      }),
      { numRuns: 1000 },
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(dataRecord, (a) => {
        expect(mergeRecords(a, a)).toStrictEqual(a);
      }),
    );
  });

  it("keeps the later tombstone and the later write of every field it keeps", () => {
    fc.assert(
      fc.property(dataRecord, dataRecord, (a, b) => {
        const merged = mergeRecords(a, b);
        expect(merged.deleted).toBe(maxHlc(a.deleted, b.deleted));
        const { deleted } = merged;
        for (const [field, clock] of Object.entries(merged.clock)) {
          expect(clock).toBe(maxHlc(a.clock[field], b.clock[field]));
          expect(deleted === undefined || clock > deleted).toBe(true);
        }
        // A field disappears only if the tombstone erased its latest write.
        for (const field of new Set([...Object.keys(a.clock), ...Object.keys(b.clock)])) {
          const latest = maxHlc(a.clock[field], b.clock[field]) ?? "";
          const erased = deleted !== undefined && latest <= deleted;
          expect(Object.hasOwn(merged.clock, field) || erased).toBe(true);
        }
      }),
    );
  });

  it("gives a record that passes the checks for records from outside", () => {
    fc.assert(
      fc.property(dataRecord, dataRecord, (a, b) => {
        const merged = mergeRecords(a, b);
        expect(checkRecord(merged, { store: "notes", version: 1, now: NOW })).toStrictEqual(merged);
      }),
    );
  });
});

describe("mergeRecords: in practice (data model §5.3)", () => {
  const created = createRecord(RECORD_ID, 1, { title: "Milk", done: false }, at(0));

  it("keeps both changes when two devices change different fields", () => {
    const onA = updateRecord(created, { title: "Oat milk" }, at(5, A));
    const onB = updateRecord(created, { done: true }, at(6, B));
    expect(mergeRecords(onA, onB)).toStrictEqual({
      id: RECORD_ID,
      v: 1,
      data: { title: "Oat milk", done: true },
      clock: { title: at(5, A), done: at(6, B) },
    });
  });

  it("keeps the later change when two devices change the same field", () => {
    const onA = updateRecord(created, { title: "Oat milk" }, at(7, A));
    const onB = updateRecord(created, { title: "Soy milk" }, at(6, B));
    expect(mergeRecords(onA, onB).data["title"]).toBe("Oat milk");
    expect(mergeRecords(onB, onA).data["title"]).toBe("Oat milk");
  });

  it("breaks a tie in time by device id", () => {
    const sameTime = formatHlc({ wall: 1_791_052_500_000, counter: 0, device: A });
    const sameTimeB = formatHlc({ wall: 1_791_052_500_000, counter: 0, device: B });
    const onA = updateRecord(created, { title: "Oat milk" }, sameTime);
    const onB = updateRecord(created, { title: "Soy milk" }, sameTimeB);
    expect(mergeRecords(onA, onB).data["title"]).toBe("Soy milk");
  });

  it("overwrites nothing newer and brings back nothing deleted when an old copy arrives", () => {
    const current = deleteRecord(updateRecord(created, { done: true }, at(5)), at(9));
    expect(mergeRecords(current, created)).toStrictEqual(current);
    expect(isDeleted(mergeRecords(created, current))).toBe(true);
  });

  it("keeps a record deleted that another device changed earlier", () => {
    const changed = updateRecord(created, { title: "Oat milk" }, at(5, B));
    const deleted = deleteRecord(created, at(8, A));
    expect(mergeRecords(changed, deleted)).toStrictEqual(deleted);
  });

  it("brings a record back with only the fields of a later change", () => {
    const deleted = deleteRecord(created, at(5, A));
    const changed = updateRecord(created, { done: true }, at(8, B));
    expect(mergeRecords(deleted, changed)).toStrictEqual({
      id: RECORD_ID,
      v: 1,
      data: { done: true },
      clock: { done: at(8, B) },
      deleted: at(5, A),
    });
  });

  it("decides equal clocks with different values by their canonical JSON", () => {
    // Only damaged or crafted data, or a copied device, has this.
    const hlc = at(5);
    const one = updateRecord(created, { title: { b: 1, a: [2] } }, hlc);
    const other = updateRecord(created, { title: "Oat milk" }, hlc);
    expect(canonicalJson(one.data["title"] ?? null) > canonicalJson("Oat milk")).toBe(true);
    expect(mergeRecords(one, other).data["title"]).toStrictEqual({ a: [2], b: 1 });
    expect(mergeRecords(other, one).data["title"]).toStrictEqual({ a: [2], b: 1 });
  });

  it("erases a write whose clock equals the tombstone, as only crafted data has", () => {
    const hlc = at(5);
    const tombstone: DataRecord = { id: RECORD_ID, v: 1, data: {}, clock: {}, deleted: hlc };
    const crafted: DataRecord = {
      id: RECORD_ID,
      v: 1,
      data: { title: "x" },
      clock: { title: hlc },
    };
    const merged = mergeRecords(tombstone, crafted);
    expect(merged).toStrictEqual(tombstone);
    expect(checkRecord(merged, { store: "notes", version: 1, now: NOW })).toStrictEqual(merged);
  });

  it.each([
    ["another record", { ...created, id: "01a10307-cbc8-73e0-98ab-ae848aa1d694" }],
    ["another schema version", { ...created, v: 2 }],
  ])("refuses to merge a copy of %s", (_case, other: DataRecord) => {
    expect(() => mergeRecords(created, other)).toThrow(DataError);
  });
});
