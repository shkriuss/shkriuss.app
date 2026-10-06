import { type Database, type SchemaVersion, defineSchemas, field } from "@shkriuss/data";

/** The longest text of an item, which the field that adds one allows too. */
export const ITEM_LENGTH = 200;

/**
 * The first version of the app's data: its items, each with a text. Every field has a default,
 * which a record without the field reads as (data model §2.3): here the empty text, which the
 * field that adds an item refuses.
 */
const v1 = {
  version: 1,
  stores: {
    items: { fields: { text: field.string({ maxLength: ITEM_LENGTH }) } },
  },
} satisfies SchemaVersion;

/**
 * Every version of the app's data, the oldest first, each with its migration from the one
 * before (data model §6). Keep every version: backups of each must always restore.
 */
export const schemas = defineSchemas(v1);

/** The app's database, from `openDatabase(schemas)` of `@shkriuss/data`. */
export type AppDatabase = Database<typeof v1>;
