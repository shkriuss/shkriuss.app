import { describe, expect, it } from "vitest";
import { DataLayerError, type DataLayerErrorCode } from "./errors.ts";
import { field } from "./fields.ts";
import { MAX_CLOCK_AHEAD, MAX_RECEIVED_WALL, formatHlc } from "./hlc.ts";
import { SETTINGS_ID } from "./ids.ts";
import { Incoming, checkIncomingStores } from "./incoming.ts";
import { MAX_RECORD_BYTES } from "./record.ts";
import { type SchemaVersion, defineSchemas } from "./schema.ts";
import { START, VERSION_1, VERSION_2 } from "./test/storage.ts";

const DEVICE = "9f86d081884c7d65";

/** The HLC of a change `seconds` seconds after `START`. */
function at(seconds: number): string {
  return formatHlc({ wall: START + seconds * 1000, counter: 0, device: DEVICE });
}

const NOTE = {
  id: "01a10307-b840-78aa-ab29-1a1138faaff6",
  v: 1,
  data: { title: "Milk", done: true, list: "01a10307-cbc8-73e0-98ab-ae848aa1d695" },
  clock: { title: at(1), done: at(3), list: at(1) },
};
const DELETED_NOTE = {
  id: "01a10307-cbc8-73e0-98ab-ae848aa1d694",
  v: 1,
  data: {},
  clock: {},
  deleted: at(2),
};
const LIST = {
  id: "01a10307-cbc8-73e0-98ab-ae848aa1d695",
  v: 1,
  data: { name: "Shopping" },
  clock: { name: at(1) },
};
const SETTINGS = { id: SETTINGS_ID, v: 1, data: { sortBy: "date" }, clock: { sortBy: at(1) } };

/** The stores of a backup made at version 1. */
function backup(stores: Record<string, unknown> = {}): Record<string, unknown> {
  return { notes: [NOTE, DELETED_NOTE], lists: [LIST], settings: [SETTINGS], ...stores };
}

function refusal(check: () => unknown): DataLayerErrorCode | undefined {
  try {
    check();
    return undefined;
  } catch (error) {
    if (error instanceof DataLayerError) {
      return error.code;
    }
    throw error;
  }
}

describe("checkIncomingStores (backup format §5.4, §5.5)", () => {
  it("checks the records of a backup of the current version", () => {
    const incoming = checkIncomingStores(VERSION_1, 1, backup());
    expect(incoming.version).toBe(1);
    expect(incoming.stores).toStrictEqual({
      notes: [NOTE, DELETED_NOTE],
      lists: [LIST],
      settings: [SETTINGS],
    });
    expect(incoming.greatest).toBe(at(3));
  });

  it("migrates the records of an older backup, moving stores", () => {
    const incoming = checkIncomingStores(VERSION_2, 1, backup());
    expect(incoming.version).toBe(2);
    expect(incoming.stores).toStrictEqual({
      notes: [
        {
          id: NOTE.id,
          v: 2,
          data: { name: "Milk", folder: LIST.id, status: "done" },
          clock: { name: at(1), folder: at(1), status: at(3) },
        },
        { ...DELETED_NOTE, v: 2 },
      ],
      folders: [{ ...LIST, v: 2 }],
      settings: [{ ...SETTINGS, v: 2 }],
    });
  });

  it("takes the greatest HLC from the backup as it is, before the migration drops fields", () => {
    const note = { ...NOTE, clock: { ...NOTE.clock, done: at(9) } };
    const incoming = checkIncomingStores(VERSION_2, 1, backup({ notes: [note] }));
    expect(incoming.stores["notes"]?.[0]?.clock).toStrictEqual({
      name: at(1),
      folder: at(1),
      status: at(9),
    });
    expect(incoming.greatest).toBe(at(9));
    const removed = checkIncomingStores(
      defineSchemas(VERSION_1.current, {
        version: 2,
        stores: {
          ...VERSION_1.current.stores,
          notes: { fields: { title: field.string({ maxLength: 100 }) } },
        },
        migrate: { notes: { remove: ["done", "list"] } },
      }),
      1,
      backup({ notes: [note] }),
    );
    expect(removed.stores["notes"]?.[0]?.clock).toStrictEqual({ title: at(1) });
    expect(removed.greatest).toBe(at(9));
  });

  it("counts tombstones for the greatest HLC, and has none for an empty backup", () => {
    const tombstone = { ...DELETED_NOTE, deleted: at(20) };
    expect(checkIncomingStores(VERSION_1, 1, backup({ notes: [tombstone] })).greatest).toBe(at(20));
    const empty = checkIncomingStores(VERSION_1, 1, { notes: [], lists: [], settings: [] });
    expect(empty.stores).toStrictEqual({ notes: [], lists: [], settings: [] });
    expect(empty.greatest).toBeUndefined();
  });

  it("lets clocks from the future pass, up to the end of the year 9999: the import checks them (data model §3.5)", () => {
    const ahead = at(30 * 24 * 60 * 60 + MAX_CLOCK_AHEAD / 1000);
    const note = { ...NOTE, clock: { ...NOTE.clock, done: ahead } };
    expect(checkIncomingStores(VERSION_1, 1, backup({ notes: [note] })).greatest).toBe(ahead);
    const last = formatHlc({ wall: MAX_RECEIVED_WALL, counter: 0, device: DEVICE });
    const tombstone = { ...DELETED_NOTE, deleted: last };
    expect(checkIncomingStores(VERSION_1, 1, backup({ notes: [tombstone] })).greatest).toBe(last);
  });

  it.each<[string, () => unknown, DataLayerErrorCode]>([
    ["schema version 0", () => checkIncomingStores(VERSION_1, 0, backup()), "invalid"],
    ["schema version 1.5", () => checkIncomingStores(VERSION_1, 1.5, backup()), "invalid"],
    [
      "a schema version newer than the app's",
      () => checkIncomingStores(VERSION_1, 2, backup()),
      "newer-version",
    ],
    ["stores that are not an object", () => checkIncomingStores(VERSION_1, 1, []), "invalid"],
    ["stores that are null", () => checkIncomingStores(VERSION_1, 1, null), "invalid"],
    [
      "a missing store",
      () => checkIncomingStores(VERSION_1, 1, { notes: [], lists: [] }),
      "invalid",
    ],
    [
      "a store the version lacks",
      () => checkIncomingStores(VERSION_1, 1, backup({ folders: [] })),
      "invalid",
    ],
    [
      "a store of the current version that the backup's lacks",
      () => checkIncomingStores(VERSION_2, 1, { ...backup(), folders: [] }),
      "invalid",
    ],
    [
      "a store that is not an array",
      () => checkIncomingStores(VERSION_1, 1, backup({ lists: { 0: LIST } })),
      "invalid",
    ],
    [
      "a record that is not one",
      () => checkIncomingStores(VERSION_1, 1, backup({ lists: ["Shopping"] })),
      "invalid",
    ],
    [
      "a record of an older schema version than the backup's",
      () =>
        checkIncomingStores(VERSION_2, 2, {
          notes: [],
          folders: [{ ...LIST, v: 2 }],
          settings: [SETTINGS],
        }),
      "invalid",
    ],
    [
      "a store in place of another",
      () => checkIncomingStores(VERSION_1, 1, { notes: [], lists: [], folders: [] }),
      "invalid",
    ],
    [
      "two records with the same id in a store",
      () => checkIncomingStores(VERSION_1, 1, backup({ lists: [LIST, LIST] })),
      "invalid",
    ],
    [
      "a field the store lacks",
      () =>
        checkIncomingStores(
          VERSION_1,
          1,
          backup({ lists: [{ ...LIST, data: { color: "red" }, clock: { color: at(1) } }] }),
        ),
      "invalid",
    ],
    [
      "a value the schema does not allow",
      () =>
        checkIncomingStores(
          VERSION_1,
          1,
          backup({ notes: [{ ...NOTE, data: { ...NOTE.data, title: "x".repeat(101) } }] }),
        ),
      "invalid",
    ],
    [
      "a deleted settings record",
      () =>
        checkIncomingStores(
          VERSION_1,
          1,
          backup({ settings: [{ ...DELETED_NOTE, id: SETTINGS_ID }] }),
        ),
      "invalid",
    ],
    [
      "a clock after the year 9999",
      () =>
        checkIncomingStores(
          VERSION_1,
          1,
          backup({
            lists: [
              {
                ...LIST,
                clock: {
                  name: formatHlc({ wall: MAX_RECEIVED_WALL + 1, counter: 0, device: DEVICE }),
                },
              },
            ],
          }),
        ),
      "invalid",
    ],
    [
      "a record larger than 1 MiB",
      () =>
        checkIncomingStores(
          VERSION_1,
          1,
          backup({ lists: [{ ...LIST, data: { name: "x".repeat(MAX_RECORD_BYTES) } }] }),
        ),
      "too-large",
    ],
  ])("refuses %s", (_case, check, code) => {
    expect(refusal(check)).toBe(code);
  });

  it("merges two records that the migration puts into one store with the same id (data model §6)", () => {
    const shelf = {
      version: 1,
      stores: {
        books: { fields: { title: field.string() } },
        films: { fields: { title: field.string(), seen: field.boolean() } },
      },
    } satisfies SchemaVersion;
    const merged = {
      version: 2,
      stores: { books: shelf.stores.films },
      migrate: { films: { store: "books" } },
    } satisfies SchemaVersion;
    const schemas = defineSchemas(shelf, merged);
    const book = { ...LIST, data: { title: "Emma" }, clock: { title: at(1) } };
    const film = {
      ...LIST,
      data: { title: "Emma, the film", seen: true },
      clock: { title: at(2), seen: at(1) },
    };
    const other = { ...book, id: "01a10307-cbc8-73e0-98ab-ae848aa1d696" };
    expect(
      checkIncomingStores(schemas, 1, { books: [book, other], films: [film] }).stores,
    ).toStrictEqual({
      books: [
        { ...film, v: 2 },
        { ...other, v: 2 },
      ],
    });
    // Within one store of the backup, an id still comes once.
    expect(refusal(() => checkIncomingStores(schemas, 1, { books: [book, book], films: [] }))).toBe(
      "invalid",
    );
  });

  it("freezes what it returns, which nothing else can make", () => {
    const incoming = checkIncomingStores(VERSION_1, 1, backup());
    expect(Object.isFrozen(incoming.stores)).toBe(true);
    expect(Object.isFrozen(incoming.stores["notes"])).toBe(true);
    expect(Object.isFrozen(incoming.stores["notes"]?.[0]?.data)).toBe(true);
    expect(Incoming.isChecked(incoming)).toBe(true);
    const { version, stores, greatest } = incoming;
    expect(Incoming.isChecked({ version, stores, greatest })).toBe(false);
    expect(Incoming.isChecked(Object.create(Incoming.prototype))).toBe(false);
    expect(() => {
      Reflect.construct(Incoming, [Symbol("checked"), 1, {}, undefined]);
    }).toThrow(TypeError);
  });
});
