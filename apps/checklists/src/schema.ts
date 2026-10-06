import {
  type Database,
  type Reader,
  type SchemaVersion,
  defineSchemas,
  field,
} from "@shkriuss/data";

/** The longest name of a list, and text of an item, which the fields allow too. */
export const NAME_LENGTH = 100;
export const TEXT_LENGTH = 200;

/**
 * The first version of the app's data (docs/specs/apps/checklists.md §2): lists, and their
 * items. Every field has a default, which a record without the field reads as (data model
 * §2.3): an item that comes back after a deletion may have only some of its fields.
 */
const v1 = {
  version: 1,
  stores: {
    lists: { fields: { name: field.string({ maxLength: NAME_LENGTH }) } },
    items: {
      fields: {
        list: field.reference("lists"),
        text: field.string({ maxLength: TEXT_LENGTH }),
        done: field.boolean(),
      },
    },
  },
} satisfies SchemaVersion;

/**
 * Every version of the app's data, the oldest first, each with its migration from the one
 * before (data model §6). Keep every version: backups of each must always restore.
 */
export const schemas = defineSchemas(v1);

/** The app's database, from `openDatabase(schemas)` of `@shkriuss/data`. */
export type AppDatabase = Database<typeof v1>;

/** What reads the app's data: the database, or the reader of an observed query. */
export type AppReader = Reader<typeof v1>;
