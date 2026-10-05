import { Dexie } from "dexie";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { DATABASE_NAME, type Database, type DatabaseOptions, openDatabase } from "../db.ts";
import { field } from "../fields.ts";
import { type SchemaVersion, type Schemas, defineSchemas } from "../schema.ts";

/** What the storage tests share: two versions of a small app's data, and ways to look inside. */

// Dexie runs live queries only where IndexedDB is a global, as it is in browsers. Each test opens
// a database of its own, with a fake IndexedDB of its own, so the global one only passes that
// check.
Dexie.dependencies.indexedDB = new IDBFactory();
Dexie.dependencies.IDBKeyRange = IDBKeyRange;

export const START = 1_791_052_200_000;

export const v1 = {
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
export const v2 = {
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

export const VERSION_1 = defineSchemas(v1);
export const VERSION_2 = defineSchemas(v1, v2);

/** A device's clock, which tests move by hand. */
export class Clock {
  time = START;
  readonly now = (): number => this.time;
}

export function open<C extends SchemaVersion>(
  schemas: Schemas<C>,
  factory: IDBFactory,
  options: DatabaseOptions = {},
): Promise<Database<C>> {
  return openDatabase(schemas, { indexedDB: factory, IDBKeyRange, ...options });
}

/** A new database at version 1, with its IndexedDB and its device's clock. */
export async function fresh(): Promise<{
  readonly factory: IDBFactory;
  readonly clock: Clock;
  readonly db: Database<typeof v1>;
}> {
  const factory = new IDBFactory();
  const clock = new Clock();
  return { factory, clock, db: await open(VERSION_1, factory, { now: clock.now }) };
}

/** Runs `use` on the database without the data layer, as it is stored. */
async function raw<T>(factory: IDBFactory, use: (database: Dexie) => Promise<T>): Promise<T> {
  const database = new Dexie(DATABASE_NAME, { indexedDB: factory, IDBKeyRange });
  await database.open();
  try {
    return await use(database);
  } finally {
    database.close();
  }
}

/** The database as stored: its version and every store's rows. */
export async function stored(
  factory: IDBFactory,
): Promise<{ readonly version: number; readonly stores: Record<string, unknown[]> }> {
  return raw(factory, async (database) => {
    const stores: Record<string, unknown[]> = {};
    for (const { name } of database.tables) {
      stores[name] = await database.table<unknown>(name).toArray();
    }
    return { version: database.verno, stores };
  });
}

/** Changes a row of the `meta` store behind the data layer's back; `undefined` deletes it. */
export async function setMeta(factory: IDBFactory, key: string, value: unknown): Promise<void> {
  await raw(factory, async (database) => {
    await (value === undefined
      ? database.table("meta").delete(key)
      : database.table("meta").put({ key, value }));
  });
}

/** Writes a row to a store behind the data layer's back. */
export async function putStored(factory: IDBFactory, store: string, row: object): Promise<void> {
  await raw(factory, async (database) => {
    await database.table(store).put(row);
  });
}

/** The result of an IndexedDB request. */
export function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("The request failed."));
    });
  });
}
