import { Dexie } from "dexie";
import { IDBFactory, IDBKeyRange, forceCloseDatabase } from "fake-indexeddb";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  DATABASE_NAME,
  type Database,
  type DatabaseOptions,
  type Item,
  openDatabase,
  refusingNewer,
} from "./db.ts";
import { DataLayerError } from "./errors.ts";
import { field } from "./fields.ts";
import { SETTINGS_ID, isRecordId } from "./ids.ts";
import { type SchemaVersion, type Schemas, defineSchemas } from "./schema.ts";

const START = 1_791_052_200_000;

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
    lists: { fields: { name: field.string() } },
    settings: { fields: { sortBy: field.enum(["title", "date"]) } },
  },
} satisfies SchemaVersion;

/** Version 2 renames two fields of notes, computes a third, and moves lists to folders. */
const v2 = {
  version: 2,
  stores: {
    notes: {
      fields: {
        name: field.string({ maxLength: 100 }),
        status: field.enum(["open", "done"]),
        folder: field.reference("folders"),
      },
    },
    folders: { fields: { name: field.string() } },
    settings: v1.stores.settings,
  },
  migrate: {
    notes: {
      rename: { title: "name", list: "folder" },
      compute: {
        status: { from: ["done"], value: ({ done }) => (done === true ? "done" : "open") },
      },
      remove: ["done"],
    },
    lists: { store: "folders" },
  },
} satisfies SchemaVersion;

const VERSION_1 = defineSchemas(v1);
const VERSION_2 = defineSchemas(v1, v2);

/** A device's clock, which tests move by hand. */
class Clock {
  time = START;
  readonly now = (): number => this.time;
}

function open<C extends SchemaVersion>(
  schemas: Schemas<C>,
  factory: IDBFactory,
  options: DatabaseOptions = {},
): Promise<Database<C>> {
  return openDatabase(schemas, { indexedDB: factory, IDBKeyRange, ...options });
}

/** The database as stored, read without the data layer: its version and every store's rows. */
async function snapshot(
  factory: IDBFactory,
): Promise<{ readonly version: number; readonly stores: Record<string, unknown[]> }> {
  const raw = new Dexie(DATABASE_NAME, { indexedDB: factory, IDBKeyRange });
  await raw.open();
  try {
    const stores: Record<string, unknown[]> = {};
    for (const { name } of raw.tables) {
      stores[name] = await raw.table<unknown>(name).toArray();
    }
    return { version: raw.verno, stores };
  } finally {
    raw.close();
  }
}

/** A new database at version 1, with its IndexedDB and its device's clock. */
async function fresh(): Promise<{
  readonly factory: IDBFactory;
  readonly clock: Clock;
  readonly db: Database<typeof v1>;
}> {
  const factory = new IDBFactory();
  const clock = new Clock();
  return { factory, clock, db: await open(VERSION_1, factory, { now: clock.now }) };
}

/** A device's clock that stands still. */
function stopped(): number {
  return START;
}

/** The result of an IndexedDB request. */
function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("The request failed."));
    });
  });
}

/** `factory`, keeping every connection it opens in `connections`. */
function recording(factory: IDBFactory, connections: IDBDatabase[]): IDBFactory {
  return {
    cmp: (first: unknown, second: unknown) => factory.cmp(first, second),
    databases: async () => factory.databases(),
    deleteDatabase: (name: string) => factory.deleteDatabase(name),
    open(name: string, version?: number) {
      const request = version === undefined ? factory.open(name) : factory.open(name, version);
      request.addEventListener("success", () => {
        connections.push(request.result);
      });
      return request;
    },
  };
}

/** Changes a row of the `meta` store behind the data layer's back. */
async function setMeta(factory: IDBFactory, key: string, value: unknown): Promise<void> {
  const raw = new Dexie(DATABASE_NAME, { indexedDB: factory, IDBKeyRange });
  await raw.open();
  try {
    await (value === undefined
      ? raw.table("meta").delete(key)
      : raw.table("meta").put({ key, value }));
  } finally {
    raw.close();
  }
}

describe("openDatabase (data model §6, §7)", () => {
  it("creates the database at the current version, with a device id that stays", async () => {
    const factory = new IDBFactory();
    const db = await open(VERSION_1, factory);
    const state = await db.device();
    expect(state.device).toMatch(/^[0-9a-f]{16}$/);
    expect(state).toStrictEqual({ device: state.device, lastBackup: null, changesSinceBackup: 0 });
    db.close();
    // Dexie keeps IndexedDB versions at ten times the schema version.
    expect(await factory.databases()).toStrictEqual([{ name: "shkriuss", version: 10 }]);
    const again = await open(VERSION_1, factory);
    expect((await again.device()).device).toBe(state.device);
    again.close();
  });

  it("creates a new database directly at the current version", async () => {
    const factory = new IDBFactory();
    (await open(VERSION_2, factory)).close();
    const { version, stores } = await snapshot(factory);
    expect(version).toBe(2);
    expect(Object.keys(stores).toSorted()).toStrictEqual(["folders", "meta", "notes", "settings"]);
  });

  it("upgrades every record, moving stores and keeping clocks and tombstones", async () => {
    const factory = new IDBFactory();
    const clock = new Clock();
    const db = await open(VERSION_1, factory, { now: clock.now });
    const created = await db.change(async (change) => {
      const list = await change.create("lists", { name: "Shopping" });
      const kept = await change.create("notes", { title: "Milk", done: true, list });
      const gone = await change.create("notes", { title: "Eggs" });
      await change.updateSettings({ sortBy: "date" });
      return { list, kept, gone, hlc: change.hlc };
    });
    const { list, kept, gone, hlc } = created;
    clock.time += 1000;
    const deleted = await db.change(async (change) => {
      await change.delete("notes", gone);
      return change.hlc;
    });
    const { device } = await db.device();
    db.close();

    const upgraded = await open(VERSION_2, factory, { now: clock.now });
    expect(await upgraded.list("notes")).toStrictEqual([
      { id: kept, values: { name: "Milk", status: "done", folder: list } },
    ]);
    expect(await upgraded.list("folders")).toStrictEqual([
      { id: list, values: { name: "Shopping" } },
    ]);
    expect(await upgraded.settings()).toStrictEqual({ sortBy: "date" });
    expect(await upgraded.device()).toStrictEqual({
      device,
      lastBackup: null,
      changesSinceBackup: 2,
    });
    upgraded.close();

    const { version, stores } = await snapshot(factory);
    expect(version).toBe(2);
    expect(Object.keys(stores).toSorted()).toStrictEqual(["folders", "meta", "notes", "settings"]);
    expect(stores["notes"]).toHaveLength(2);
    expect(stores["notes"]).toContainEqual({
      id: kept,
      v: 2,
      data: { name: "Milk", folder: list, status: "done" },
      clock: { name: hlc, folder: hlc, status: hlc },
    });
    expect(stores["notes"]).toContainEqual({ id: gone, v: 2, data: {}, clock: {}, deleted });
    expect(stores["folders"]).toStrictEqual([
      { id: list, v: 2, data: { name: "Shopping" }, clock: { name: hlc } },
    ]);
    expect(stores["settings"]).toStrictEqual([
      { id: SETTINGS_ID, v: 2, data: { sortBy: "date" }, clock: { sortBy: hlc } },
    ]);
  });

  it("moves records out of a store that the next version keeps", async () => {
    const factory = new IDBFactory();
    const db = await open(VERSION_1, factory);
    const id = await db.change((change) => change.create("lists", { name: "Shopping" }));
    db.close();
    const archived = {
      version: 2,
      stores: { ...v1.stores, archive: v1.stores.lists },
      migrate: { lists: { store: "archive" } },
    } satisfies SchemaVersion;
    const upgraded = await open(defineSchemas(v1, archived), factory);
    expect(await upgraded.list("lists")).toStrictEqual([]);
    expect(await upgraded.list("archive")).toStrictEqual([{ id, values: { name: "Shopping" } }]);
    upgraded.close();
  });

  it("leaves the database as it was if a migration fails", async () => {
    const factory = new IDBFactory();
    const db = await open(VERSION_1, factory);
    await db.change(async (change) => {
      await change.create("lists", { name: "Shopping" });
      await change.create("notes", { title: "Milk" });
    });
    db.close();
    const before = await snapshot(factory);
    const failure = new Error("No.");
    const failing = {
      ...v2,
      migrate: {
        ...v2.migrate,
        notes: {
          ...v2.migrate.notes,
          convert: {
            title: () => {
              throw failure;
            },
          },
        },
      },
    } satisfies SchemaVersion;
    await expect(open(defineSchemas(v1, failing), factory)).rejects.toThrow(
      expect.objectContaining({ code: "invalid", cause: failure }),
    );
    expect(await snapshot(factory)).toStrictEqual(before);
  });

  it("refuses a database that a newer version of the app upgraded, and leaves it as it is", async () => {
    const factory = new IDBFactory();
    (await open(VERSION_2, factory)).close();
    const before = await snapshot(factory);
    await expect(open(VERSION_1, factory)).rejects.toThrow(
      expect.objectContaining({ name: "DataLayerError", code: "newer-version" }),
    );
    expect(await snapshot(factory)).toStrictEqual(before);
    expect(await factory.databases()).toStrictEqual([{ name: "shkriuss", version: 20 }]);
  });

  it("refuses a newer database even if it has every store the app knows", async () => {
    const factory = new IDBFactory();
    const newer = {
      version: 2,
      stores: { ...v1.stores, tags: { fields: { name: field.string() } } },
    } satisfies SchemaVersion;
    (await open(defineSchemas(v1, newer), factory)).close();
    const before = await snapshot(factory);
    await expect(open(VERSION_1, factory)).rejects.toThrow(
      expect.objectContaining({ code: "newer-version" }),
    );
    expect(await snapshot(factory)).toStrictEqual(before);
  });

  it("opens and upgrades a database that Dexie repaired at the same schema version", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const factory = new IDBFactory();
    // An earlier build whose version 1 lacked stores, which Dexie adds to repair the database.
    (
      await open(defineSchemas({ version: 1, stores: { lists: v1.stores.lists } }), factory)
    ).close();
    (await open(VERSION_1, factory)).close();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
    expect(await factory.databases()).toStrictEqual([{ name: "shkriuss", version: 11 }]);
    const repaired = await open(VERSION_1, factory);
    expect(await repaired.list("notes")).toStrictEqual([]);
    repaired.close();
    const upgraded = await open(VERSION_2, factory);
    expect(await upgraded.list("folders")).toStrictEqual([]);
    upgraded.close();
    expect(await factory.databases()).toStrictEqual([{ name: "shkriuss", version: 20 }]);
  });

  it("closes when a newer version of the app upgrades the database in another tab", async () => {
    const factory = new IDBFactory();
    const onVersionChange = vi.fn<() => void>();
    const old = await open(VERSION_1, factory, { onVersionChange });
    const upgraded = await open(VERSION_2, factory);
    expect(onVersionChange).toHaveBeenCalledOnce();
    await expect(old.list("notes")).rejects.toThrow(
      expect.objectContaining({ name: "DataLayerError", code: "closed" }),
    );
    upgraded.close();
  });

  it("closes when another tab deletes the database", async () => {
    const factory = new IDBFactory();
    const onVersionChange = vi.fn<() => void>();
    const db = await open(VERSION_1, factory, { onVersionChange });
    await settle(factory.deleteDatabase(DATABASE_NAME));
    expect(onVersionChange).toHaveBeenCalledOnce();
    await expect(db.device()).rejects.toThrow(
      expect.objectContaining({ name: "DataLayerError", code: "closed" }),
    );
  });

  it("stays closed once the app closes it", async () => {
    const onVersionChange = vi.fn<() => void>();
    const db = await open(VERSION_1, new IDBFactory(), { onVersionChange });
    db.close();
    await expect(db.device()).rejects.toThrow(
      expect.objectContaining({ name: "DataLayerError", code: "closed" }),
    );
    expect(onVersionChange).not.toHaveBeenCalled();
  });

  it("reopens by itself after the browser closes it, unless a newer version upgraded it", async () => {
    const factory = new IDBFactory();
    const connections: IDBDatabase[] = [];
    const onVersionChange = vi.fn<() => void>();
    const db = await open(VERSION_1, recording(factory, connections), { onVersionChange });
    // What the browser does when, for example, the user clears the site's data.
    const closeByBrowser = (): void => {
      // @ts-expect-error -- fake-indexeddb types the connection as the class of connections.
      forceCloseDatabase(connections.at(-1));
    };
    closeByBrowser();
    const id = await db.change((change) => change.create("notes", { title: "Milk" }));
    expect(await db.get("notes", id)).toStrictEqual({
      id,
      values: { title: "Milk", done: false, list: null },
    });
    closeByBrowser();
    (await open(VERSION_2, factory)).close();
    const before = await snapshot(factory);
    await expect(db.list("notes")).rejects.toThrow(
      expect.objectContaining({ code: "newer-version" }),
    );
    expect(await snapshot(factory)).toStrictEqual(before);
    // Every connection it opened to look at the newer database is closed again.
    await settle(factory.deleteDatabase(DATABASE_NAME));
    expect(onVersionChange).not.toHaveBeenCalled();
  });

  it("waits for other tabs that keep an older version open", async () => {
    const factory = new IDBFactory();
    (await open(VERSION_1, factory)).close();
    // A connection that ignores requests to close, as a stalled tab would.
    const stalled = await settle(factory.open(DATABASE_NAME, 10));
    const { promise: blocked, resolve: onBlocked } = Promise.withResolvers<undefined>();
    const opening = open(VERSION_2, factory, {
      onBlocked: () => {
        onBlocked(undefined);
      },
    });
    await blocked;
    stalled.close();
    const db = await opening;
    expect(await db.list("folders")).toStrictEqual([]);
    db.close();
  });
});

describe("refusingNewer", () => {
  it("refuses IndexedDB versions of newer schema versions, and passes everything else on", async () => {
    const factory = new IDBFactory();
    const wrapped = refusingNewer(factory, 1);
    expect(() => wrapped.open(DATABASE_NAME, 20)).toThrow(
      expect.objectContaining({ name: "VersionError" }),
    );
    (await settle(wrapped.open("other", 11))).close();
    const unversioned = await settle(wrapped.open("other"));
    expect(unversioned.version).toBe(11);
    unversioned.close();
    expect(wrapped.cmp(1, 2)).toBe(-1);
    expect(await wrapped.databases()).toStrictEqual([{ name: "other", version: 11 }]);
    await settle(wrapped.deleteDatabase("other"));
    expect(await factory.databases()).toStrictEqual([]);
  });
});

describe("changes (data model §4)", () => {
  it("creates a record at the current version, with the change's HLC", async () => {
    const { factory, db } = await fresh();
    const { id, hlc } = await db.change(async (change) => ({
      id: await change.create("notes", { title: "Milk" }),
      hlc: change.hlc,
    }));
    expect(isRecordId(id)).toBe(true);
    expect(await db.get("notes", id)).toStrictEqual({
      id,
      values: { title: "Milk", done: false, list: null },
    });
    expect((await snapshot(factory)).stores["notes"]).toStrictEqual([
      { id, v: 1, data: { title: "Milk" }, clock: { title: hlc } },
    ]);
  });

  it("issues one HLC per change, which all its writes carry, and sees its own writes", async () => {
    const { factory, db } = await fresh();
    const result = await db.change(async (change) => {
      const list = await change.create("lists", { name: "Shopping" });
      const note = await change.create("notes", { title: "Milk", list });
      await change.update("notes", note, { done: true });
      return {
        list,
        note,
        hlc: change.hlc,
        seen: await change.get("notes", note),
        all: await change.list("lists"),
      };
    });
    const { list, note, hlc } = result;
    expect(hlc).toMatch(/^001791052200000:00000:[0-9a-f]{16}$/);
    expect(result.seen).toStrictEqual({ id: note, values: { title: "Milk", done: true, list } });
    expect(result.all).toStrictEqual([{ id: list, values: { name: "Shopping" } }]);
    expect((await snapshot(factory)).stores["notes"]).toStrictEqual([
      {
        id: note,
        v: 1,
        data: { title: "Milk", list, done: true },
        clock: { title: hlc, list: hlc, done: hlc },
      },
    ]);
  });

  it("updates fields with the change's HLC and keeps the others", async () => {
    const { factory, clock, db } = await fresh();
    const { id, hlc: first } = await db.change(async (change) => ({
      id: await change.create("notes", { title: "Milk" }),
      hlc: change.hlc,
    }));
    clock.time += 1000;
    const second = await db.change(async (change) => {
      await change.update("notes", id, { done: true });
      return change.hlc;
    });
    expect(second > first).toBe(true);
    expect((await snapshot(factory)).stores["notes"]).toStrictEqual([
      { id, v: 1, data: { title: "Milk", done: true }, clock: { title: first, done: second } },
    ]);
  });

  it("deletes a record, leaving its tombstone, which reads as missing", async () => {
    const { factory, db } = await fresh();
    const id = await db.change((change) => change.create("notes", { title: "Milk" }));
    const deleted = await db.change(async (change) => {
      await change.delete("notes", id);
      await change.delete("notes", id);
      return change.hlc;
    });
    expect(await db.get("notes", id)).toBeUndefined();
    expect(await db.list("notes")).toStrictEqual([]);
    expect((await snapshot(factory)).stores["notes"]).toStrictEqual([
      { id, v: 1, data: {}, clock: {}, deleted },
    ]);
    await expect(db.change((change) => change.update("notes", id, { done: true }))).rejects.toThrow(
      expect.objectContaining({ code: "deleted" }),
    );
  });

  it("lists live records, oldest first", async () => {
    const { clock, db } = await fresh();
    const ids: string[] = [];
    for (const title of ["Milk", "Eggs", "Bread"]) {
      clock.time += 1000;
      ids.push(await db.change((change) => change.create("notes", { title })));
    }
    await db.change((change) => change.delete("notes", ids[1] ?? ""));
    expect((await db.list("notes")).map(({ id }) => id)).toStrictEqual([ids[0], ids[2]]);
  });

  it("refuses records that a store lacks", async () => {
    const { db } = await fresh();
    const missing = "01a10307-b840-78aa-ab29-1a1138faaff6";
    expect(await db.get("notes", missing)).toBeUndefined();
    await expect(
      db.change((change) => change.update("notes", missing, { done: true })),
    ).rejects.toThrow(expect.objectContaining({ code: "not-found" }));
    await expect(db.change((change) => change.delete("notes", missing))).rejects.toThrow(
      expect.objectContaining({ code: "not-found" }),
    );
  });

  it("refuses stores the app lacks", async () => {
    const { db } = await fresh();
    // @ts-expect-error -- A store the app lacks, which TypeScript refuses as well.
    await expect(db.list("tasks")).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
    await expect(
      // @ts-expect-error -- A store the app lacks, which TypeScript refuses as well.
      db.change((change) => change.create("tasks", {})),
    ).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
  });

  it("rejects with the data layer's own errors, which Dexie passes on as they are", async () => {
    const { db } = await fresh();
    const missing = "01a10307-b840-78aa-ab29-1a1138faaff6";
    await expect(db.change((change) => change.delete("notes", missing))).rejects.toBeInstanceOf(
      DataLayerError,
    );
  });

  it("refuses values the schema does not allow, and writes nothing", async () => {
    const { factory, db } = await fresh();
    const before = await snapshot(factory);
    await expect(
      db.change((change) => change.create("notes", { title: "x".repeat(101) })),
    ).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
    expect(await snapshot(factory)).toStrictEqual(before);
  });

  it("changes nothing if the change fails", async () => {
    const { factory, db } = await fresh();
    await db.change((change) => change.create("notes", { title: "Milk" }));
    const before = await snapshot(factory);
    const failure = new Error("No.");
    await expect(
      db.change(async (change) => {
        await change.create("notes", { title: "Eggs" });
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await snapshot(factory)).toStrictEqual(before);
  });

  it("issues later HLCs even when the device's clock stands still or goes back", async () => {
    const { factory, clock, db } = await fresh();
    const issue = (): Promise<string> => db.change(async (change) => change.hlc);
    const first = await issue();
    const second = await issue();
    clock.time -= 60_000;
    const third = await issue();
    expect([first, second, third]).toStrictEqual([
      expect.stringMatching(/^001791052200000:00000:/),
      expect.stringMatching(/^001791052200000:00001:/),
      expect.stringMatching(/^001791052200000:00002:/),
    ]);
    db.close();
    // The last HLC is stored with the change, so it survives reopening.
    const again = await open(VERSION_1, factory, { now: clock.now });
    expect(await again.change(async (change) => change.hlc)).toMatch(/^001791052200000:00003:/);
    again.close();
  });

  it("never issues the same HLC twice, even to two tabs at once", async () => {
    const factory = new IDBFactory();
    const first = await open(VERSION_1, factory, { now: stopped });
    const second = await open(VERSION_1, factory, { now: stopped });
    const hlcs = await Promise.all(
      Array.from({ length: 20 }, async (_, index) =>
        (index % 2 === 0 ? first : second).change(async (change) => {
          await change.create("notes", { title: `Note ${index}` });
          return change.hlc;
        }),
      ),
    );
    expect(new Set(hlcs).size).toBe(20);
    first.close();
    second.close();
  });
});

describe("settings (data model §2.5)", () => {
  it("reads defaults until written, then the one settings record", async () => {
    const factory = new IDBFactory();
    const db = await open(VERSION_1, factory);
    expect(await db.settings()).toStrictEqual({ sortBy: "title" });
    const hlc = await db.change(async (change) => {
      await change.updateSettings({ sortBy: "date" });
      expect(await change.settings()).toStrictEqual({ sortBy: "date" });
      await change.updateSettings({ sortBy: "title" });
      return change.hlc;
    });
    expect(await db.settings()).toStrictEqual({ sortBy: "title" });
    expect((await snapshot(factory)).stores["settings"]).toStrictEqual([
      { id: SETTINGS_ID, v: 1, data: { sortBy: "title" }, clock: { sortBy: hlc } },
    ]);
  });

  it("refuses settings when the app has none", async () => {
    const db = await open(
      defineSchemas({ version: 1, stores: { notes: { fields: {} } } }),
      new IDBFactory(),
    );
    await expect(db.settings()).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
    await expect(db.change((change) => change.updateSettings({}))).rejects.toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
  });
});

describe("device state (data model §7)", () => {
  it("counts the changes that wrote something since the last backup", async () => {
    const clock = new Clock();
    const db = await open(VERSION_1, new IDBFactory(), { now: clock.now });
    const id = await db.change((change) => change.create("notes", { title: "Milk" }));
    await db.change((change) => change.update("notes", id, { done: true }));
    await db.change((change) => change.update("notes", id, {}));
    await db.change((change) => change.updateSettings({}));
    expect(await db.device()).toMatchObject({ lastBackup: null, changesSinceBackup: 2 });
    clock.time += 1000;
    await db.recordBackup();
    expect(await db.device()).toMatchObject({ lastBackup: START + 1000, changesSinceBackup: 0 });
    await db.change((change) => change.delete("notes", id));
    expect(await db.device()).toMatchObject({ lastBackup: START + 1000, changesSinceBackup: 1 });
  });

  it.for<[string, string, unknown]>([
    ["no device id", "device", undefined],
    ["an invalid device id", "device", "DEVICE"],
    ["an invalid clock", "clock", { wall: -1, counter: 0 }],
    ["an invalid backup state", "backup", { last: null, changes: -1 }],
  ])("refuses to work with %s", async ([_case, key, value]) => {
    const factory = new IDBFactory();
    const db = await open(VERSION_1, factory);
    db.close();
    await setMeta(factory, key, value);
    const again = await open(VERSION_1, factory);
    await expect(
      Promise.all([again.device(), again.change(async (change) => change.hlc)]),
    ).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
    again.close();
  });
});

describe("types", () => {
  it("gives items the types of their store's values", async () => {
    const db = await open(VERSION_2, new IDBFactory());
    const item = await db.get("notes", SETTINGS_ID);
    expectTypeOf(item).toEqualTypeOf<Item<typeof v2, "notes"> | undefined>();
    expectTypeOf<Item<typeof v2, "notes">["values"]>().toEqualTypeOf<{
      readonly name: string;
      readonly status: "open" | "done";
      readonly folder: string | null;
    }>();
    expectTypeOf(await db.settings()).toEqualTypeOf<{ readonly sortBy: "title" | "date" }>();
    // @ts-expect-error -- Settings are read with settings(), not as records.
    await expect(db.get("settings", SETTINGS_ID)).rejects.toThrow(
      expect.objectContaining({ code: "invalid" }),
    );
    await expect(
      // @ts-expect-error -- Settings are written with updateSettings(), not as records.
      db.change((change) => change.create("settings", { sortBy: "date" })),
    ).rejects.toThrow(expect.objectContaining({ code: "invalid" }));
    db.close();
  });
});
