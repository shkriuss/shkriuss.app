import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatHlc, type Hlc } from "./hlc.ts";
import { checkIncomingStores } from "./incoming.ts";
import type { DataRecord } from "./record.ts";
import { defineSchemas, type SchemaVersion } from "./schema.ts";
import { fresh, open, START, stored, v1, v2, VERSION_1 } from "./test/storage.ts";

// Data that crosses more than one migration, and an import that fails while it writes (data
// model §6 to §8; backup format §5.7).

/** Version 3 renames the name of notes and of folders, so that version 1 is two steps behind. */
const v3 = {
  version: 3,
  stores: {
    notes: {
      fields: {
        text: v2.stores.notes.fields.name,
        status: v2.stores.notes.fields.status,
        folder: v2.stores.notes.fields.folder,
      },
    },
    folders: { fields: { label: v2.stores.folders.fields.name } },
    settings: v2.stores.settings,
  },
  migrate: {
    notes: { rename: { name: "text" } },
    folders: { rename: { name: "label" } },
  },
} satisfies SchemaVersion;

const VERSION_3 = defineSchemas(v1, v2, v3);

const DEVICE = "9f86d081884c7d65";

/** The HLC of a change `seconds` seconds after `START`. */
function at(seconds: number): Hlc {
  return formatHlc({ wall: START + seconds * 1000, counter: 0, device: DEVICE });
}

/** A note of version 1, with the id `n`, from 0 to 255. */
function note(n: number, title: string, clock: Hlc): DataRecord {
  const id = `01a10307-b840-7000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
  return { id, v: 1, data: { title }, clock: { title: clock } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("data two versions behind", () => {
  it("imports a backup of version 1 into version 3, through version 2", async () => {
    const { db } = await fresh();
    const list = await db.change((change) => change.create("lists", { name: "Shopping" }));
    const milk = await db.change((change) =>
      change.create("notes", { title: "Milk", done: true, list }),
    );
    const snapshot = await db.snapshot();
    // As a file carries it, then checked as an import checks it.
    const stores: unknown = JSON.parse(JSON.stringify(snapshot.stores));
    const backup = checkIncomingStores(VERSION_3, snapshot.schemaVersion, stores);

    const later = await open(VERSION_3, new IDBFactory());
    await later.import(backup);
    expect(await later.list("folders")).toStrictEqual([
      { id: list, values: { label: "Shopping" } },
    ]);
    expect(await later.list("notes")).toStrictEqual([
      { id: milk, values: { text: "Milk", status: "done", folder: list } },
    ]);
  });

  it("opens a database of version 1 at version 3, as an update that skips a version does", async () => {
    const { factory, db } = await fresh();
    const list = await db.change((change) => change.create("lists", { name: "Shopping" }));
    const milk = await db.change((change) =>
      change.create("notes", { title: "Milk", done: false, list }),
    );
    db.close();

    const later = await open(VERSION_3, factory);
    expect(await later.list("folders")).toStrictEqual([
      { id: list, values: { label: "Shopping" } },
    ]);
    expect(await later.list("notes")).toStrictEqual([
      { id: milk, values: { text: "Milk", status: "open", folder: list } },
    ]);
    later.close();
    const { stores } = await stored(factory);
    // Every record is of version 3 now, and the store of version 1 is gone.
    expect(stores["lists"]).toBeUndefined();
    expect(stores["folders"]).toStrictEqual([expect.objectContaining({ id: list, v: 3 })]);
    expect(stores["notes"]).toStrictEqual([expect.objectContaining({ id: milk, v: 3 })]);
  });
});

describe("an import that fails while it writes", () => {
  it("changes nothing, and says that storage is full when it is", async () => {
    const { factory, db } = await fresh();
    const before = await stored(factory);
    // The first note is written, and the second fails for lack of space. The first is written
    // with add, which writes a new record as put does, since put itself is the spy.
    let written = 0;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      written += 1;
      if (written === 2) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      return this.add(value, key);
    });
    const backup = checkIncomingStores(VERSION_1, 1, {
      notes: [note(1, "Milk", at(1)), note(2, "Eggs", at(2))],
      lists: [],
      settings: [],
    });
    await expect(db.import(backup)).rejects.toThrow(
      expect.objectContaining({ code: "storage-full" }),
    );
    expect(written).toBe(2);
    vi.restoreAllMocks();
    expect(await stored(factory)).toStrictEqual(before);
  });
});
