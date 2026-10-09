import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { rescueSnapshot } from "./db.ts";
import { checkIncomingStores } from "./incoming.ts";
import { defineSchemas, type SchemaVersion } from "./schema.ts";
import { fresh, open, START, stored, v1, v2, VERSION_1, VERSION_2 } from "./test/storage.ts";

// A backup of the data as stored, when the app cannot open its database (data model §7; backup
// format §4).

/** Version 2, with a migration that has a bug: it fails for every note. */
const broken = {
  ...v2,
  migrate: {
    ...v2.migrate,
    notes: {
      ...v2.migrate.notes,
      compute: {
        status: {
          from: ["done"],
          value: () => {
            throw new Error("A migration with a bug.");
          },
        },
      },
    },
  },
} satisfies SchemaVersion;

const BROKEN = defineSchemas(v1, broken);

const DAY = 24 * 60 * 60 * 1000;

describe("rescueSnapshot", () => {
  it("gives the records as stored, at the database's version, after an upgrade that failed, and changes nothing", async () => {
    const { factory, db } = await fresh();
    const list = await db.change((change) => change.create("lists", { name: "Shopping" }));
    const milk = await db.change((change) =>
      change.create("notes", { title: "Milk", done: true, list }),
    );
    const eggs = await db.change((change) => change.create("notes", { title: "Eggs" }));
    await db.change((change) => change.delete("notes", eggs));
    db.close();
    await expect(open(BROKEN, factory)).rejects.toThrow("the migration of record");
    const before = await stored(factory);

    const snapshot = await rescueSnapshot(BROKEN, { indexedDB: factory, IDBKeyRange });
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.stores).toStrictEqual({
      notes: before.stores["notes"],
      lists: before.stores["lists"],
      settings: before.stores["settings"],
    });
    expect(snapshot.stores["notes"]).toHaveLength(2);
    expect(snapshot).toMatchObject({ fromFuture: undefined, counted: 0 });
    expect(await stored(factory)).toStrictEqual(before);

    // A version that works restores it, as any older backup, tombstone included.
    const fixed = await open(VERSION_2, new IDBFactory());
    const stores: unknown = JSON.parse(JSON.stringify(snapshot.stores));
    await fixed.import(checkIncomingStores(VERSION_2, snapshot.schemaVersion, stores));
    expect(await fixed.list("notes")).toStrictEqual([
      { id: milk, values: { name: "Milk", status: "done", folder: list } },
    ]);
    expect((await fixed.snapshot()).stores["notes"]).toHaveLength(2);
    fixed.close();
  });

  it("refuses a device without a database of the app, and makes none", async () => {
    const factory = new IDBFactory();
    await expect(rescueSnapshot(VERSION_1, { indexedDB: factory, IDBKeyRange })).rejects.toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
    expect(await factory.databases()).toStrictEqual([]);
  });

  it("refuses a database that a newer version of the app has upgraded", async () => {
    const { factory, db } = await fresh();
    db.close();
    (await open(VERSION_2, factory)).close();
    await expect(rescueSnapshot(VERSION_1, { indexedDB: factory, IDBKeyRange })).rejects.toThrow(
      expect.objectContaining({ code: "newer-version" }),
    );
  });

  it("says when the records have clocks from the future, as a snapshot does", async () => {
    const { factory, clock, db } = await fresh();
    clock.time = START + 3 * DAY;
    await db.change((change) => change.create("notes", { title: "Milk" }));
    db.close();
    const snapshot = await rescueSnapshot(VERSION_1, {
      indexedDB: factory,
      IDBKeyRange,
      now: () => START,
    });
    expect(snapshot.fromFuture).toBe(START + 3 * DAY);
  });
});
