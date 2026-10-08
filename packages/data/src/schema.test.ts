import { describe, expect, expectTypeOf, it } from "vitest";
import { DataLayerError } from "./errors.ts";
import { type FieldType, field } from "./fields.ts";
import type { JsonValue } from "./json.ts";
import {
  type SchemaVersion,
  type StoreMigration,
  type Values,
  checkData,
  defineSchemas,
  readValues,
  storeSchema,
} from "./schema.ts";

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

/** Version 2 of `v1` with its notes store and migration replaced. */
function v2(notes: SchemaVersion["stores"][string], migration?: StoreMigration): SchemaVersion {
  return {
    version: 2,
    stores: { ...v1.stores, notes },
    ...(migration === undefined ? {} : { migrate: { notes: migration } }),
  };
}

const NOTES_V2 = {
  fields: {
    name: field.string({ maxLength: 100 }),
    status: field.enum(["open", "done"]),
    list: field.reference("lists"),
  },
};

/** Versions 1 and 2 of a store with one field, `value`, of the types given. */
function versions(
  before: FieldType<unknown>,
  after: FieldType<unknown>,
): readonly [SchemaVersion, SchemaVersion] {
  return [
    { version: 1, stores: { notes: { fields: { value: before } } } },
    { version: 2, stores: { notes: { fields: { value: after } } } },
  ];
}

describe("defineSchemas (data model §6)", () => {
  it("accepts every version and gives the current one", () => {
    const next = v2(NOTES_V2, {
      rename: { title: "name" },
      compute: {
        status: { from: ["done"], value: ({ done }) => (done === true ? "done" : "open") },
      },
      remove: ["done"],
    });
    const schemas = defineSchemas(v1, next);
    expect(schemas.current).toBe(next);
    expect(schemas.version(1)).toBe(v1);
    expect(schemas.versions).toStrictEqual([v1, next]);
  });

  it.each([0, 3, 1.5, Number.NaN])("refuses to look up version %d", (n) => {
    expect(() => defineSchemas(v1).version(n)).toThrow(DataLayerError);
  });

  it.each<[string, () => unknown, RegExp]>([
    [
      "versions that do not start at 1",
      () => defineSchemas({ ...v1, version: 2 }),
      /must be 1, 2, 3/,
    ],
    [
      "versions that skip a number",
      () => defineSchemas(v1, { ...v1, version: 3 }),
      /number 2 is 3/,
    ],
    ["a migration in version 1", () => defineSchemas({ ...v1, migrate: {} }), /nothing to migrate/],
    [
      "a store named meta",
      () => defineSchemas({ version: 1, stores: { meta: { fields: {} } } }),
      /"meta"/,
    ],
    [
      "a store name in upper case",
      () => defineSchemas({ version: 1, stores: { Notes: { fields: {} } } }),
      /"Notes"/,
    ],
    [
      "a field name that is not allowed",
      () =>
        defineSchemas({ version: 1, stores: { notes: { fields: { toString: field.string() } } } }),
      /"toString"/,
    ],
    [
      "a field without a default",
      () => defineSchemas({ version: 1, stores: { notes: { fields: { due: field.date() } } } }),
      /no default/,
    ],
    [
      "a reference to a store the version lacks",
      () =>
        defineSchemas({
          version: 1,
          stores: { notes: { fields: { list: field.reference("lists") } } },
        }),
      /refers to the store lists/,
    ],
  ])("refuses %s", (_case, define, message) => {
    expect(define).toThrow(message);
  });

  it(`refuses a store with more than 256 fields`, () => {
    const fields = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`f${index}`, field.boolean()]),
    );
    expect(() => defineSchemas({ version: 1, stores: { notes: { fields } } })).toThrow(
      /more than 256/,
    );
  });

  it.each<[string, SchemaVersion, RegExp]>([
    [
      "a migration of a store the previous version lacks",
      { ...v2(v1.stores.notes), migrate: { drafts: {} } },
      /drafts, which version 1 lacks/,
    ],
    [
      "a store that disappears without a move",
      { version: 2, stores: { lists: v1.stores.lists, settings: v1.stores.settings } },
      /records are never removed/,
    ],
    [
      "a move to a store the next version lacks",
      v2(v1.stores.notes, { store: "tasks" }),
      /needs a store tasks/,
    ],
    ["a move into settings", v2(v1.stores.notes, { store: "settings" }), /into or out of settings/],
    [
      "a rename of a field the store lacks",
      v2(NOTES_V2, { rename: { name: "name" } }),
      /names the field name/,
    ],
    [
      "a conversion of a field the store lacks",
      v2(v1.stores.notes, { convert: { due: (value) => value } }),
      /names the field due/,
    ],
    [
      "a removal of a field the store lacks",
      v2(v1.stores.notes, { remove: ["due"] }),
      /names the field due/,
    ],
    [
      "a field both removed and renamed",
      v2(NOTES_V2, { rename: { title: "name" }, remove: ["title", "done"] }),
      /both removes and keeps the field title/,
    ],
    [
      "a kept field the next version lacks",
      v2(NOTES_V2, { rename: { title: "name" } }),
      /writes the field done/,
    ],
    [
      "a rename to a field the next version lacks",
      v2(NOTES_V2, { rename: { title: "heading" }, remove: ["done"] }),
      /writes the field heading/,
    ],
    [
      "two fields renamed to the same name",
      v2(NOTES_V2, { rename: { title: "name", done: "name" } }),
      /writes the field name from both/,
    ],
    [
      "a computation of a kept field",
      v2(NOTES_V2, {
        rename: { title: "name" },
        remove: ["done"],
        compute: { name: { from: ["done"], value: () => "" } },
      }),
      /writes the field name from both/,
    ],
    [
      "a computation from a field the store lacks",
      v2(NOTES_V2, {
        rename: { title: "name" },
        remove: ["done"],
        compute: { status: { from: ["state"], value: () => "open" } },
      }),
      /computes status from state/,
    ],
  ])("refuses %s", (_case, next, message) => {
    expect(() => defineSchemas(v1, next)).toThrow(message);
  });

  it("allows a new field that no migration writes: it reads as its default", () => {
    const notes = { fields: { ...v1.stores.notes.fields, note: field.string() } };
    expect(() => defineSchemas(v1, v2(notes))).not.toThrow();
  });

  it("allows a removed field to come back under the same name with another type", () => {
    const notes = { fields: { ...v1.stores.notes.fields, done: field.enum(["no", "yes"]) } };
    expect(() => defineSchemas(v1, v2(notes, { remove: ["done"] }))).not.toThrow();
  });

  it.each<[string, FieldType<unknown>, FieldType<unknown>]>([
    ["shorter strings", field.string({ maxLength: 100 }), field.string({ maxLength: 10 })],
    ["longer strings", field.string(), field.string({ minLength: 1 }).default("-")],
    ["fewer values", field.enum(["low", "normal", "high"]), field.enum(["low", "high"])],
    ["narrower numbers", field.number(), field.number({ min: 0 })],
    ["whole numbers", field.number(), field.number({ integer: true })],
    ["no null", field.date().nullable(), field.date().default("2026-01-01")],
    ["another type", field.string(), field.number()],
    ["lists of another type", field.array(field.string()), field.array(field.number())],
    [
      "an object whose member narrows",
      field.object({ x: field.number() }),
      field.object({ x: field.number({ min: 0 }) }),
    ],
    ["even wider strings", field.string({ maxLength: 10 }), field.string({ maxLength: 100 })],
  ])(
    "refuses a kept field whose type changes, here to %s, unless it is converted or removed",
    (_case, before, after) => {
      const [first, second] = versions(before, after);
      expect(() => defineSchemas(first, second)).toThrow(
        /keeps the field value, but changes its type from .+ to .+: convert it, so that every stored value fits, or remove it\./,
      );
      const convert = { notes: { convert: { value: (value: JsonValue) => value } } };
      expect(() => defineSchemas(first, { ...second, migrate: convert })).not.toThrow();
      const remove = { notes: { remove: ["value"] } };
      expect(() => defineSchemas(first, { ...second, migrate: remove })).not.toThrow();
    },
  );

  it("names the new name of a renamed field whose type changes", () => {
    const notes = { fields: { ...NOTES_V2.fields, name: field.string({ maxLength: 50 }) } };
    expect(() =>
      defineSchemas(v1, v2(notes, { rename: { title: "name" }, remove: ["done"] })),
    ).toThrow(
      "The migration of notes to version 2 keeps the field title as name, but changes its type from a string of at most 100 characters to a string of at most 50 characters: convert it, so that every stored value fits, or remove it.",
    );
  });

  it.each<[string, FieldType<unknown>, FieldType<unknown>]>([
    ["the same type", field.string({ maxLength: 100 }), field.string({ maxLength: 100 })],
    ["another default", field.enum(["low", "high"]), field.enum(["low", "high"]).default("high")],
    ["the same values in another order", field.enum(["low", "high"]), field.enum(["high", "low"])],
    ["the same type made nullable", field.date().default("2026-01-01"), field.date().nullable()],
    [
      "the same members in another order",
      field.object({ x: field.number(), y: field.boolean() }),
      field.object({ y: field.boolean(), x: field.number() }),
    ],
  ])("allows a kept field whose type holds every value it held: %s", (_case, before, after) => {
    const [first, second] = versions(before, after);
    expect(() => defineSchemas(first, second)).not.toThrow();
  });

  it("allows a reference to follow its store to a new name", () => {
    const first = {
      version: 1,
      stores: { notes: { fields: { list: field.reference("lists") } }, lists: { fields: {} } },
    } satisfies SchemaVersion;
    const second = {
      version: 2,
      stores: {
        notes: { fields: { folder: field.reference("folders") } },
        folders: { fields: {} },
      },
      migrate: { notes: { rename: { list: "folder" } }, lists: { store: "folders" } },
    } satisfies SchemaVersion;
    expect(() => defineSchemas(first, second)).not.toThrow();
  });
});

describe("storeSchema", () => {
  it("finds a store of a version, or refuses", () => {
    expect(storeSchema(v1, "notes")).toBe(v1.stores.notes);
    expect(() => storeSchema(v1, "tasks")).toThrow(DataLayerError);
    expect(() => storeSchema(v1, "toString")).toThrow(DataLayerError);
  });
});

describe("checkData (data model §8, step 2)", () => {
  it("accepts known fields with valid values, and missing fields", () => {
    expect(() => {
      checkData(v1.stores.notes, { title: "Milk", done: true }, "a note");
    }).not.toThrow();
    expect(() => {
      checkData(v1.stores.notes, {}, "a note");
    }).not.toThrow();
  });

  it("refuses a field the store lacks", () => {
    expect(() => {
      checkData(v1.stores.notes, { title: "Milk", note: "x" }, "a note");
    }).toThrow("a note has a field note, which its store lacks.");
  });

  it("refuses a value of the wrong type or beyond its constraints", () => {
    expect(() => {
      checkData(v1.stores.notes, { title: "x".repeat(101) }, "a note");
    }).toThrow("The field title of a note is not a string of at most 100 characters.");
    expect(() => {
      checkData(v1.stores.notes, { done: "yes" }, "a note");
    }).toThrow(DataLayerError);
  });
});

describe("readValues", () => {
  it("reads stored fields and the defaults of missing ones", () => {
    expect(readValues(v1.stores.notes, { title: "Milk" })).toStrictEqual({
      title: "Milk",
      done: false,
      list: null,
    });
  });

  it("refuses stored values that do not fit the schema", () => {
    expect(() => readValues(v1.stores.notes, { done: "yes" })).toThrow(DataLayerError);
  });

  it("gives the values their TypeScript types", () => {
    const values = readValues(v1.stores.notes, {});
    expect(values.title).toBe("");
    expectTypeOf(values).toEqualTypeOf<Values<typeof v1.stores.notes>>();
    expectTypeOf(values).toEqualTypeOf<{
      readonly title: string;
      readonly done: boolean;
      readonly list: string | null;
    }>();
  });
});
