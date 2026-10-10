import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { DATABASE_NAME, rescueSnapshot } from "./db.ts";
import { checkIncomingStores } from "./incoming.ts";
import { defineSchemas, type SchemaVersion } from "./schema.ts";
import {
  fresh,
  open,
  settle,
  START,
  stored,
  v1,
  v2,
  VERSION_1,
  VERSION_2,
} from "./test/storage.ts";

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

  it("reads a database that Dexie repaired at the same schema version, whichever version the app is at", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const factory = new IDBFactory();
    // An earlier build whose version 1 lacked stores, which Dexie adds to repair the database,
    // adding 1 to IndexedDB's version: 11 is still schema version 1, not a newer one.
    (
      await open(defineSchemas({ version: 1, stores: { lists: v1.stores.lists } }), factory)
    ).close();
    const db = await open(VERSION_1, factory);
    warn.mockRestore();
    const id = await db.change((change) => change.create("notes", { title: "Milk" }));
    db.close();
    expect(await factory.databases()).toStrictEqual([{ name: "shkriuss", version: 11 }]);
    for (const schemas of [VERSION_1, VERSION_2]) {
      const snapshot = await rescueSnapshot(schemas, { indexedDB: factory, IDBKeyRange });
      expect(snapshot.schemaVersion).toBe(1);
      expect(snapshot.stores["notes"]).toStrictEqual([expect.objectContaining({ id, v: 1 })]);
    }
  });

  it("reads the schema version that Dexie keeps in its $meta store, where it has one", async () => {
    const { factory, db } = await fresh();
    const id = await db.change((change) => change.create("notes", { title: "Milk" }));
    db.close();
    // Ten repairs take IndexedDB's version from 10 to 20, which alone would say schema version
    // 2; from then on, Dexie keeps the schema version in a store of its own.
    const request = factory.open(DATABASE_NAME, 20);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore("$meta").add(1, "version");
    });
    (await settle(request)).close();
    expect(await factory.databases()).toStrictEqual([{ name: "shkriuss", version: 20 }]);
    for (const schemas of [VERSION_1, VERSION_2]) {
      const snapshot = await rescueSnapshot(schemas, { indexedDB: factory, IDBKeyRange });
      expect(snapshot.schemaVersion).toBe(1);
      expect(snapshot.stores["notes"]).toStrictEqual([expect.objectContaining({ id, v: 1 })]);
    }
  });

  it("falls back to IndexedDB's version where $meta holds nothing readable", async () => {
    const { factory, db } = await fresh();
    db.close();
    const request = factory.open(DATABASE_NAME, 20);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore("$meta").add("two", "version");
    });
    (await settle(request)).close();
    const snapshot = await rescueSnapshot(VERSION_2, { indexedDB: factory, IDBKeyRange });
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.stores).toStrictEqual({ notes: [], folders: [], settings: [] });
    await expect(rescueSnapshot(VERSION_1, { indexedDB: factory, IDBKeyRange })).rejects.toThrow(
      expect.objectContaining({ code: "newer-version" }),
    );
  });

  it("reads the stores of its version that the database has, and gives one it lacks as empty", async () => {
    const factory = new IDBFactory();
    // An earlier build whose version 1 lacked stores.
    const earlier = await open(
      defineSchemas({ version: 1, stores: { lists: v1.stores.lists } }),
      factory,
    );
    const id = await earlier.change((change) => change.create("lists", { name: "Shopping" }));
    earlier.close();
    const snapshot = await rescueSnapshot(VERSION_1, { indexedDB: factory, IDBKeyRange });
    expect(snapshot.stores).toStrictEqual({
      notes: [],
      lists: [expect.objectContaining({ id, v: 1 })],
      settings: [],
    });
    // Even a database with no store of the version at all.
    const empty = new IDBFactory();
    (await open(defineSchemas({ version: 1, stores: {} }), empty)).close();
    const nothing = await rescueSnapshot(VERSION_1, { indexedDB: empty, IDBKeyRange });
    expect(nothing).toStrictEqual({
      schemaVersion: 1,
      stores: { notes: [], lists: [], settings: [] },
      fromFuture: undefined,
      counted: 0,
    });
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
