import { type DataRecord, type Snapshot, toJson } from "@shkriuss/data";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_BACKUP_BYTES, readBackup, writeBackup } from "./document.ts";
import { BackupError, type BackupErrorCode } from "./errors.ts";
import { APP, SCHEMAS, example, openTestDatabase } from "./test/fixtures.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const read = (bytes: Uint8Array): ReturnType<typeof readBackup> =>
  readBackup(bytes, { app: APP, schemas: SCHEMAS });

/** The example of backup format §2, changed by `change`. */
function changed(change: (document: Record<string, unknown>) => void): Uint8Array {
  const document: unknown = JSON.parse(example());
  if (typeof document !== "object" || document === null) {
    throw new Error("The example is not a JSON object.");
  }
  const copy: Record<string, unknown> = { ...document };
  change(copy);
  return encode(JSON.stringify(copy));
}

function refusal(bytes: Uint8Array): BackupError {
  try {
    read(bytes);
  } catch (error) {
    if (error instanceof BackupError) {
      return error;
    }
    throw error;
  }
  throw new Error("The backup was not refused.");
}

const HLC = "001791052200000:00000:9f86d081884c7d65";

describe("readBackup (backup format §5.3–§5.5)", () => {
  it("reads the example of backup format §2", () => {
    const contents = read(encode(example()));
    expect(contents.exported).toStrictEqual(new Date("2026-10-04T21:13:20.000Z"));
    expect(contents.schemaVersion).toBe(1);
    expect(Object.keys(contents.incoming.stores)).toStrictEqual(["notes", "settings"]);
    expect(contents.incoming.stores["notes"]).toHaveLength(2);
    expect(contents.incoming.greatest).toBe("001791104400000:00000:9f86d081884c7d65");
  });

  it("reads what writeBackup() wrote, which another device then imports", async () => {
    const first = await openTestDatabase();
    await first.change(async (change) => {
      const id = await change.create("notes", { title: "Milk" });
      await change.create("notes", { title: "Eggs", done: true });
      await change.delete("notes", id);
      await change.updateSettings({ sortBy: "date" });
    });
    const snapshot = await first.snapshot();
    const made = new Date("2026-10-05T08:00:00.000Z");
    const contents = read(writeBackup(APP, snapshot, made));
    expect(contents.exported).toStrictEqual(made);
    const second = await openTestDatabase();
    expect((await second.import(contents.incoming)).total).toStrictEqual({
      new: 2,
      updated: 0,
      deleted: 0,
      unchanged: 1,
    });
    expect((await second.snapshot()).stores).toStrictEqual(snapshot.stores);
  });

  it.each<[string, Uint8Array, BackupErrorCode]>([
    ["a file larger than 64 MiB", new Uint8Array(MAX_BACKUP_BYTES + 1), "too-large"],
    ["invalid UTF-8", Uint8Array.from([0x7b, 0xff, 0x7d]), "not-a-backup"],
    [
      "invalid UTF-8 within a string",
      Uint8Array.from(
        [...encode(example())].flatMap((byte, index, bytes) =>
          // The "M" of "Milk" becomes a byte that UTF-8 never has.
          byte === 0x4d && bytes[index + 1] === 0x69 ? [0xff] : [byte],
        ),
      ),
      "not-a-backup",
    ],
    [
      "a byte order mark",
      Uint8Array.from([0xef, 0xbb, 0xbf, ...encode(example())]),
      "not-a-backup",
    ],
    ["something that is not JSON", encode("Milk, eggs"), "not-a-backup"],
    ["JSON that is not an object", encode('["shkriuss-backup"]'), "not-a-backup"],
    ["JSON null", encode("null"), "not-a-backup"],
    [
      "an object without the format",
      changed((document) => delete document["format"]),
      "not-a-backup",
    ],
    ["another format", changed((document) => (document["format"] = "other")), "not-a-backup"],
    [
      "a newer format version",
      changed((document) => (document["formatVersion"] = 2)),
      "newer-version",
    ],
    [
      "a newer format version with other members",
      changed((document) => {
        document["formatVersion"] = 2;
        document["encoding"] = "cbor";
        delete document["stores"];
      }),
      "newer-version",
    ],
    ["format version 0", changed((document) => (document["formatVersion"] = 0)), "invalid"],
    [
      "a format version as a string",
      changed((document) => (document["formatVersion"] = "1")),
      "invalid",
    ],
    ["a member too many", changed((document) => (document["comment"] = "Mine")), "invalid"],
    ["a member too few", changed((document) => delete document["exported"]), "invalid"],
    // JSON gives __proto__ and constructor as keys of the document's own, like any other.
    [
      "a member named __proto__ too many",
      encode(example().replace('"stores": {', '"__proto__": { "polluted": true },\n  "stores": {')),
      "invalid",
    ],
    [
      "a member named constructor too many",
      encode(
        example().replace('"stores": {', '"constructor": { "prototype": {} },\n  "stores": {'),
      ),
      "invalid",
    ],
    [
      "a member named __proto__ in the place of one",
      encode(example().replace('"exported"', '"__proto__"')),
      "invalid",
    ],
    [
      "a store named __proto__",
      encode(example().replace('"settings": [', '"__proto__": [')),
      "invalid",
    ],
    [
      "a store named constructor",
      encode(example().replace('"notes": [', '"constructor": [')),
      "invalid",
    ],
    ["an app that is not a string", changed((document) => (document["app"] = 1)), "invalid"],
    ["an app that is not an app id", changed((document) => (document["app"] = "Notes")), "invalid"],
    ["another app", changed((document) => (document["app"] = "todo")), "other-app"],
    [
      "another app with a newer schema version",
      changed((document) => {
        document["app"] = "todo";
        document["schemaVersion"] = 9;
      }),
      "other-app",
    ],
    ["schema version 0", changed((document) => (document["schemaVersion"] = 0)), "invalid"],
    [
      "a newer schema version",
      changed((document) => (document["schemaVersion"] = 2)),
      "newer-version",
    ],
    [
      "a time without milliseconds",
      changed((document) => (document["exported"] = "2026-10-04T21:13:20Z")),
      "invalid",
    ],
    [
      "a time in another zone",
      changed((document) => (document["exported"] = "2026-10-04T23:13:20.000+02:00")),
      "invalid",
    ],
    [
      "a day that does not exist",
      changed((document) => (document["exported"] = "2026-02-30T21:13:20.000Z")),
      "invalid",
    ],
    [
      "a year after 9999",
      changed((document) => (document["exported"] = "+010000-01-01T00:00:00.000Z")),
      "invalid",
    ],
    [
      "a time as a number",
      changed((document) => (document["exported"] = 1_791_148_400_000)),
      "invalid",
    ],
    ["a missing store", changed((document) => (document["stores"] = { notes: [] })), "invalid"],
    [
      "a record that does not fit the schema",
      changed((document) => {
        const record = {
          id: "01a10307-b840-78aa-ab29-1a1138faaff6",
          v: 1,
          data: { done: "yes" },
          clock: { done: HLC },
        };
        document["stores"] = { notes: [record], settings: [] };
      }),
      "invalid",
    ],
    [
      "a record larger than 1 MiB",
      changed((document) => {
        const title = "x".repeat(1024 * 1024);
        const record = {
          id: "01a10307-b840-78aa-ab29-1a1138faaff6",
          v: 1,
          data: { title },
          clock: { title: HLC },
        };
        document["stores"] = { notes: [record], settings: [] };
      }),
      "invalid",
    ],
    [
      "a clock after the year 9999",
      changed((document) => {
        const record = {
          id: "01a10307-b840-78aa-ab29-1a1138faaff6",
          v: 1,
          data: { done: true },
          clock: { done: "253402300800000:00000:9f86d081884c7d65" },
        };
        document["stores"] = { notes: [record], settings: [] };
      }),
      "invalid",
    ],
  ])("refuses %s", (_case, bytes, code) => {
    expect(refusal(bytes).code).toBe(code);
  });

  it("leaves every object as it was after a backup names __proto__ or constructor", () => {
    for (const name of ["__proto__", "constructor"]) {
      refusal(
        encode(example().replace('"stores": {', `"${name}": { "polluted": true },\n  "stores": {`)),
      );
      refusal(encode(example().replace('"settings": [', `"${name}": [`)));
    }
    expect("polluted" in {}).toBe(false);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("names the other app if its id is valid", () => {
    expect(refusal(changed((document) => (document["app"] = "todo"))).app).toBe("todo");
    expect(refusal(changed((document) => (document["app"] = "To do"))).app).toBeUndefined();
  });

  it("keeps the data of a refused backup out of its message", () => {
    const secret = "SECRET";
    const record = {
      id: "01a10307-b840-78aa-ab29-1a1138faaff6",
      v: 1,
      data: { done: secret },
      clock: { done: HLC },
    };
    const messages = [
      changed((document) => (document["stores"] = { notes: [record], settings: [] })),
      changed((document) => (document["app"] = secret)),
      changed((document) => (document["exported"] = secret)),
      changed((document) => (document["formatVersion"] = secret)),
      changed((document) => (document["schemaVersion"] = secret)),
      encode(`${secret} {`),
    ].map((bytes) => refusal(bytes).message);
    expect(messages.filter((message) => message.includes(secret))).toStrictEqual([]);
  });
});

describe("writeBackup (backup format §2, §4)", () => {
  it("writes the members in the spec's order, indented with two spaces", async () => {
    const db = await openTestDatabase();
    await db.change(async (change) => {
      await change.create("notes", { title: "Milk", done: true });
    });
    const snapshot = await db.snapshot();
    const text = new TextDecoder().decode(
      writeBackup(APP, snapshot, new Date("2026-10-04T21:13:20.000Z")),
    );
    expect(text.split("\n").slice(0, 7)).toStrictEqual([
      "{",
      '  "format": "shkriuss-backup",',
      '  "formatVersion": 1,',
      '  "app": "notes",',
      '  "schemaVersion": 1,',
      '  "exported": "2026-10-04T21:13:20.000Z",',
      '  "stores": {',
    ]);
    expect(JSON.parse(text)).toStrictEqual({
      format: "shkriuss-backup",
      formatVersion: 1,
      app: "notes",
      schemaVersion: 1,
      exported: "2026-10-04T21:13:20.000Z",
      stores: { notes: snapshot.stores["notes"]?.map(toJson), settings: [] },
    });
  });

  it("writes the members of every record in the spec's order", () => {
    const record = {
      deleted: HLC,
      clock: {},
      data: {},
      v: 1,
      id: "01a10307-b840-78aa-ab29-1a1138faaff6",
    };
    const snapshot: Snapshot = {
      schemaVersion: 1,
      stores: { notes: [record], settings: [] },
      fromFuture: undefined,
      counted: 0,
    };
    const text = new TextDecoder().decode(writeBackup(APP, snapshot, new Date()));
    expect(text).toContain(
      `"notes": [\n      {\n        "id": "${record.id}",\n        "v": 1,\n        "data": {},\n        "clock": {},\n        "deleted": "${HLC}"\n      }\n    ]`,
    );
  });

  it("refuses an app id that is not one", () => {
    const snapshot: Snapshot = {
      schemaVersion: 1,
      stores: { notes: [], settings: [] },
      fromFuture: undefined,
      counted: 0,
    };
    expect(() => writeBackup("Notes", snapshot, new Date())).toThrow(TypeError);
  });

  it("refuses a backup larger than imports accept: every backup must import", () => {
    const title = "x".repeat(1_000_000);
    const record: DataRecord = {
      id: "01a10307-b840-78aa-ab29-1a1138faaff6",
      v: 1,
      data: { title },
      clock: { title: HLC },
    };
    const snapshot: Snapshot = {
      schemaVersion: 1,
      stores: { notes: Array.from({ length: 70 }, () => record), settings: [] },
      fromFuture: undefined,
      counted: 0,
    };
    expect(() => writeBackup(APP, snapshot, new Date())).toThrow(
      expect.objectContaining({ code: "too-large" }),
    );
  });
});

/** Notes with values that fit the schema, at a few times. */
const notes = fc.uniqueArray(
  fc
    .record({
      n: fc.integer({ min: 0, max: 255 }),
      title: fc.option(fc.string({ maxLength: 20 }), { nil: undefined }),
      done: fc.option(fc.boolean(), { nil: undefined }),
      deleted: fc.boolean(),
    })
    .map(({ n, title, done, deleted }): DataRecord => {
      const id = `01a10307-b840-7000-8000-0000000000${n.toString(16).padStart(2, "0")}`;
      if (deleted) {
        return { id, v: 1, data: {}, clock: {}, deleted: HLC };
      }
      const data: Record<string, string | boolean> = {};
      const clock: Record<string, string> = {};
      if (title !== undefined) {
        data["title"] = title;
        clock["title"] = HLC;
      }
      if (done !== undefined) {
        data["done"] = done;
        clock["done"] = HLC;
      }
      return { id, v: 1, data, clock };
    }),
  { selector: (record) => record.id, maxLength: 8 },
);

describe("writeBackup and readBackup, as a property", () => {
  it("read back what was written", () => {
    fc.assert(
      fc.property(
        notes,
        fc.date({ min: new Date(0), max: new Date(4_102_444_800_000), noInvalidDate: true }),
        (records, made) => {
          const snapshot: Snapshot = {
            schemaVersion: 1,
            stores: { notes: records, settings: [] },
            fromFuture: undefined,
            counted: 0,
          };
          const contents = read(writeBackup(APP, snapshot, made));
          expect(contents.exported).toStrictEqual(made);
          expect(contents.incoming.stores).toStrictEqual(snapshot.stores);
        },
      ),
    );
  });
});
