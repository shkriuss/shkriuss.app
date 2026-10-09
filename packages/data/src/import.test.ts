import { IDBFactory } from "fake-indexeddb";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Snapshot } from "./db.ts";
import { DataLayerError } from "./errors.ts";
import { type Hlc, MAX_CLOCK_AHEAD, formatHlc, wallTime } from "./hlc.ts";
import { SETTINGS_ID } from "./ids.ts";
import { type Incoming, checkIncomingStores } from "./incoming.ts";
import type { DataRecord } from "./record.ts";
import type { Schemas } from "./schema.ts";
import { START, VERSION_1, VERSION_2, fresh, open, putStored, stored } from "./test/storage.ts";

const DAY = 24 * 60 * 60 * 1000;
const DEVICE = "9f86d081884c7d65";

/** The HLC of a change `seconds` seconds after `START`. */
function at(seconds: number): Hlc {
  return formatHlc({ wall: START + seconds * 1000, counter: 0, device: DEVICE });
}

/** The id of the record `n`, from 0 to 255. */
function id(n: number): string {
  return `01a10307-b840-7000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
}

/** A backup of `snapshot`, as a file carries it, checked as an import checks it. */
function backupOf(snapshot: Snapshot, schemas: Schemas = VERSION_1): Incoming {
  const stores: unknown = JSON.parse(JSON.stringify(snapshot.stores));
  return checkIncomingStores(schemas, snapshot.schemaVersion, stores);
}

/** Notes from a backup made at version 1, checked as an import checks them. */
function notes(records: readonly object[]): Incoming {
  return checkIncomingStores(VERSION_1, 1, { notes: records, lists: [], settings: [] });
}

function note(n: number, title: string, clock: Hlc, deleted?: Hlc): DataRecord {
  const record = { id: id(n), v: 1, data: { title }, clock: { title: clock } };
  return deleted === undefined ? record : { ...record, deleted };
}

function tombstone(n: number, deleted: Hlc): DataRecord {
  return { id: id(n), v: 1, data: {}, clock: {}, deleted };
}

describe("snapshot (backup format §4, step 1)", () => {
  it("has every record of every store, deleted ones included", async () => {
    const { clock, db } = await fresh();
    expect(await db.snapshot()).toStrictEqual({
      schemaVersion: 1,
      stores: { notes: [], lists: [], settings: [] },
      fromFuture: undefined,
    });
    const created = await db.change(async (change) => {
      const list = await change.create("lists", { name: "Shopping" });
      const gone = await change.create("notes", { title: "Eggs", list });
      await change.updateSettings({ sortBy: "date" });
      return { list, gone, hlc: change.hlc };
    });
    clock.time += 1000;
    const deleted = await db.change(async (change) => {
      await change.delete("notes", created.gone);
      return change.hlc;
    });
    expect(await db.snapshot()).toStrictEqual({
      schemaVersion: 1,
      stores: {
        notes: [{ id: created.gone, v: 1, data: {}, clock: {}, deleted }],
        lists: [
          { id: created.list, v: 1, data: { name: "Shopping" }, clock: { name: created.hlc } },
        ],
        settings: [
          { id: SETTINGS_ID, v: 1, data: { sortBy: "date" }, clock: { sortBy: created.hlc } },
        ],
      },
      fromFuture: undefined,
    });
  });
});

describe("import (backup format §5.6, §5.7)", () => {
  it("moves every record to another device, and changes nothing when imported again", async () => {
    const first = await fresh();
    const created = await first.db.change(async (change) => {
      const list = await change.create("lists", { name: "Shopping" });
      await change.create("notes", { title: "Milk", list });
      const gone = await change.create("notes", { title: "Eggs" });
      await change.updateSettings({ sortBy: "date" });
      return { gone };
    });
    first.clock.time += 1000;
    await first.db.change((change) => change.delete("notes", created.gone));
    const snapshot = await first.db.snapshot();

    const second = await fresh();
    const empty = await second.db.snapshot();
    const backup = backupOf(snapshot);
    const preview = await second.db.previewImport(backup);
    expect(preview.total).toStrictEqual({ new: 3, updated: 0, deleted: 0, unchanged: 1 });
    expect(preview.stores).toStrictEqual({
      notes: { new: 1, updated: 0, deleted: 0, unchanged: 1 },
      lists: { new: 1, updated: 0, deleted: 0, unchanged: 0 },
      settings: { new: 1, updated: 0, deleted: 0, unchanged: 0 },
    });
    // The preview writes nothing.
    expect(await second.db.snapshot()).toStrictEqual(empty);

    const { fromFuture, ...summary } = preview;
    expect(fromFuture).toBeUndefined();
    expect(await second.db.import(backup)).toStrictEqual(summary);
    expect(await second.db.snapshot()).toStrictEqual(snapshot);
    expect(await second.db.device()).toMatchObject({ changesSinceBackup: 1 });

    const again = await second.db.import(backup);
    expect(again.total).toStrictEqual({ new: 0, updated: 0, deleted: 0, unchanged: 4 });
    expect(await second.db.snapshot()).toStrictEqual(snapshot);
    expect(await second.db.device()).toMatchObject({ changesSinceBackup: 1 });
  });

  it("counts what it does to each record, and writes what changed", async () => {
    const { factory, db } = await fresh();
    const local = [
      note(1, "Milk", at(1)),
      note(2, "Eggs", at(1)),
      tombstone(3, at(2)),
      note(5, "Tea", at(1)),
      tombstone(7, at(2)),
      note(8, "Rice", at(7)),
    ];
    for (const record of local) {
      await putStored(factory, "notes", record);
    }
    const backup = notes([
      // A later write: updated.
      note(1, "Oat milk", at(5)),
      // A later deletion: deleted.
      tombstone(2, at(5)),
      // A write after the local deletion brings the record back: updated.
      note(3, "Bread", at(5)),
      // The deletion of a record this device never had: unchanged, but kept.
      tombstone(4, at(5)),
      // The same as the local copy: unchanged.
      note(5, "Tea", at(1)),
      // A record this device never had: new.
      note(6, "Jam", at(5)),
      // A later deletion of a deleted record: unchanged, but kept.
      tombstone(7, at(6)),
      // An earlier write: unchanged.
      note(8, "Pasta", at(5)),
    ]);
    const expected = { new: 1, updated: 2, deleted: 1, unchanged: 4 };
    expect((await db.previewImport(backup)).stores["notes"]).toStrictEqual(expected);
    expect((await db.import(backup)).stores["notes"]).toStrictEqual(expected);
    expect((await stored(factory)).stores["notes"]).toStrictEqual([
      note(1, "Oat milk", at(5)),
      tombstone(2, at(5)),
      { ...note(3, "Bread", at(5)), deleted: at(2) },
      tombstone(4, at(5)),
      note(5, "Tea", at(1)),
      note(6, "Jam", at(5)),
      tombstone(7, at(6)),
      note(8, "Rice", at(7)),
    ]);
  });

  it("receives the backup's greatest HLC, so that later changes sort after it", async () => {
    const { clock, db } = await fresh();
    await db.import(notes([note(1, "Milk", at(1), at(0)), tombstone(2, at(3000))]));
    // The device's clock is behind the backup's: its next change is still later.
    const next = await db.change(async (change) => change.hlc);
    expect(next > at(3000)).toBe(true);
    // An older backup does not move the clock back.
    clock.time += 4000 * 1000;
    const later = await db.change(async (change) => change.hlc);
    await db.import(notes([note(9, "Tea", at(1))]));
    expect(await db.change(async (change) => change.hlc)).toBe(
      formatHlc({ wall: START + 4000 * 1000, counter: 1, device: later.slice(-16) }),
    );
  });

  it("migrates an older backup to the current version", async () => {
    const first = await fresh();
    const list = await first.db.change((change) => change.create("lists", { name: "Shopping" }));
    const backup = backupOf(await first.db.snapshot(), VERSION_2);
    const second = await open(VERSION_2, new IDBFactory());
    expect((await second.import(backup)).stores).toStrictEqual({
      notes: { new: 0, updated: 0, deleted: 0, unchanged: 0 },
      folders: { new: 1, updated: 0, deleted: 0, unchanged: 0 },
      settings: { new: 0, updated: 0, deleted: 0, unchanged: 0 },
    });
    expect(await second.list("folders")).toStrictEqual([
      { id: list, values: { name: "Shopping" } },
    ]);
  });

  it("refuses records that checkIncomingStores() did not check for this app's version", async () => {
    const { db } = await fresh();
    const forged = { version: 1, stores: { notes: [note(1, "Milk", at(1))] }, greatest: at(1) };
    // @ts-expect-error -- An object that only looks like checked records.
    await expect(db.import(forged)).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
    // @ts-expect-error -- An object that only looks like checked records.
    await expect(db.previewImport(forged)).rejects.toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
    const newer = checkIncomingStores(VERSION_2, 2, { notes: [], folders: [], settings: [] });
    await expect(db.import(newer)).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("changes nothing if anything fails", async () => {
    const { factory, db } = await fresh();
    // A local copy that cannot be merged: it claims another schema version.
    await putStored(factory, "notes", { ...note(2, "Eggs", at(1)), v: 2 });
    const before = await stored(factory);
    await expect(
      db.import(notes([note(1, "Milk", at(1)), note(2, "Eggs", at(2))])),
    ).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
    expect(await stored(factory)).toStrictEqual(before);
  });
});

/** The HLC of a change at `wall`, on another device. */
function hlcAt(wall: number, counter = 0): Hlc {
  return formatHlc({ wall, counter, device: DEVICE });
}

describe("clocks from the future (data model §3.5)", () => {
  it("come from a device whose date was set ahead, whose snapshots say so until its date catches up", async () => {
    const { clock, db } = await fresh();
    clock.time = START + 2 * DAY;
    await db.change((change) => change.create("lists", { name: "Shopping" }));
    // The date is put right: the next change still carries the last wall time (§3.3).
    clock.time = START;
    const next = await db.change(async (change) => {
      await change.create("notes", { title: "Milk" });
      return change.hlc;
    });
    expect(wallTime(next)).toBe(START + 2 * DAY);
    expect((await db.snapshot()).fromFuture).toBe(START + 2 * DAY);
    clock.time = START + 2 * DAY - MAX_CLOCK_AHEAD - 1;
    expect((await db.snapshot()).fromFuture).toBe(START + 2 * DAY);
    clock.time = START + 2 * DAY - MAX_CLOCK_AHEAD;
    expect((await db.snapshot()).fromFuture).toBeUndefined();
  });

  it("are imported only once the user has confirmed what the preview shows", async () => {
    const { factory, db } = await fresh();
    const backup = notes([note(1, "Milk", hlcAt(START + 2 * DAY, 5)), note(2, "Eggs", at(1))]);
    const counts = { new: 2, updated: 0, deleted: 0, unchanged: 0 };
    expect(await db.previewImport(backup)).toStrictEqual({
      total: counts,
      stores: {
        notes: counts,
        lists: { new: 0, updated: 0, deleted: 0, unchanged: 0 },
        settings: { new: 0, updated: 0, deleted: 0, unchanged: 0 },
      },
      fromFuture: START + 2 * DAY,
    });
    const before = await stored(factory);
    await expect(db.import(backup)).rejects.toThrow(
      expect.objectContaining({ code: "future-clock" }),
    );
    await expect(db.import(backup, { acceptFromFuture: false })).rejects.toThrow(
      expect.objectContaining({ code: "future-clock" }),
    );
    // Neither the records nor the device's clock and backup count change.
    expect(await stored(factory)).toStrictEqual(before);

    expect((await db.import(backup, { acceptFromFuture: true })).total).toStrictEqual(counts);
    expect(await db.list("notes")).toHaveLength(2);
    // The device received the backup's clock (§3.4): its changes carry that time until it comes.
    const next = await db.change(async (change) => change.hlc);
    expect(next).toBe(formatHlc({ wall: START + 2 * DAY, counter: 6, device: next.slice(-16) }));
    expect((await db.snapshot()).fromFuture).toBe(START + 2 * DAY);
  });

  it("are those more than 24 hours after this device's clock when the import runs", async () => {
    const { clock, db } = await fresh();
    const backup = notes([note(1, "Milk", hlcAt(START + MAX_CLOCK_AHEAD))]);
    expect((await db.previewImport(backup)).fromFuture).toBeUndefined();
    // The date went back after the preview, which therefore did not ask.
    clock.time = START - 1;
    expect((await db.previewImport(backup)).fromFuture).toBe(START + MAX_CLOCK_AHEAD);
    await expect(db.import(backup)).rejects.toThrow(
      expect.objectContaining({ code: "future-clock" }),
    );
    clock.time = START;
    expect((await db.import(backup)).total.new).toBe(1);
  });

  it("as a property: an import that the user did not confirm fails exactly when the preview shows a time, and then changes nothing", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: -2 * DAY, max: 3 * DAY }), { minLength: 1, maxLength: 3 }),
        async (offsets) => {
          const { factory, db } = await fresh();
          const walls = offsets.map((offset) => START + offset);
          const backup = notes(walls.map((wall, n) => note(n, "Milk", hlcAt(wall))));
          const latest = Math.max(...walls);
          const future = latest - START > MAX_CLOCK_AHEAD ? latest : undefined;
          expect((await db.previewImport(backup)).fromFuture).toBe(future);
          const before = JSON.stringify(await stored(factory));
          const refusal = await db.import(backup).then(
            () => undefined,
            (error: unknown) => (error instanceof DataLayerError ? error.code : error),
          );
          expect(refusal).toBe(future === undefined ? undefined : "future-clock");
          // A refused import changes nothing; one that went through adds every note.
          expect(JSON.stringify(await stored(factory)) === before).toBe(refusal !== undefined);
          await db.import(backup, { acceptFromFuture: true });
          expect(await db.list("notes")).toHaveLength(walls.length);
          expect(wallTime(await db.change(async (change) => change.hlc))).toBeGreaterThanOrEqual(
            latest,
          );
          db.close();
        },
      ),
      { numRuns: 40 },
    );
  });
});

/** Two notes, written and deleted at a few times on a few devices. */
const backups = fc.uniqueArray(
  fc
    .record({
      n: fc.integer({ min: 1, max: 3 }),
      title: fc.option(fc.record({ value: fc.string({ maxLength: 3 }), clock: fc.nat(3) }), {
        nil: undefined,
      }),
      done: fc.option(fc.record({ value: fc.boolean(), clock: fc.nat(3) }), { nil: undefined }),
      deleted: fc.option(fc.nat(3), { nil: undefined }),
    })
    .map(({ n, title, done, deleted }): DataRecord => {
      const data: Record<string, string | boolean> = {};
      const clock: Record<string, Hlc> = {};
      for (const [field, write] of Object.entries({ title, done })) {
        if (write !== undefined && (deleted === undefined || write.clock > deleted)) {
          data[field] = write.value;
          clock[field] = at(write.clock);
        }
      }
      const record = { id: id(n), v: 1, data, clock };
      return deleted === undefined ? record : { ...record, deleted: at(deleted) };
    }),
  { selector: (record) => record.id, maxLength: 3 },
);

describe("import, as a property (backup format §5.7)", () => {
  it("ends in the same records, whatever the order and however often backups are imported", async () => {
    await fc.assert(
      fc.asyncProperty(backups, backups, async (first, second) => {
        const one = await fresh();
        await one.db.import(notes(first));
        await one.db.import(notes(second));
        const two = await fresh();
        await two.db.import(notes(second));
        await two.db.import(notes(first));
        await two.db.import(notes(second));
        expect(await two.db.snapshot()).toStrictEqual(await one.db.snapshot());
        one.db.close();
        two.db.close();
      }),
      { numRuns: 60 },
    );
  });
});
