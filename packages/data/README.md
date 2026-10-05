# @shkriuss/data

The data layer: how every app stores its records, stamps its changes and merges copies of the same record. It implements the [data model spec](../../docs/specs/data-model.md) ([ADR 0004](../../docs/decisions/0004-local-data-and-backups.md)). Apps reach their data only through this package.

So far it has the parts that need no storage: pure functions on records, and the schemas and migrations that check and evolve them. The IndexedDB storage and the backup import build on these.

| Module       | What it does                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hlc.ts`     | Hybrid logical clocks (§3): the format, issuing an HLC for a change, receiving HLCs from elsewhere, refusing clocks from the future; device ids          |
| `ids.ts`     | Record ids: UUIDv7 (RFC 9562), and the fixed id of the settings record                                                                                   |
| `json.ts`    | Field values (§2.3): checked, normalized copies of JSON values, and canonical JSON (RFC 8785) for comparing and measuring them                           |
| `names.ts`   | Field and store names (§2.3, §2.5)                                                                                                                       |
| `record.ts`  | The record format (§2): deleted or alive, the last change, the limits, and the structural checks for records from outside, such as a backup (§8, step 1) |
| `changes.ts` | Creating, updating and deleting a record within a change (§4)                                                                                            |
| `merge.ts`   | Merging two copies of a record (§5)                                                                                                                      |
| `fields.ts`  | Field types: the values a field holds, its constraints and its default (§2.3)                                                                            |
| `schema.ts`  | Store schemas and schema versions, checked by `defineSchemas()`; the data check for records (§8, step 2); reading values with defaults                   |
| `migrate.ts` | Migrating records from version to version (§6), and the whole check for records from outside (§8)                                                        |

Every function is pure: it returns a new record and never changes the one it is given. A refusal throws a `DataError` whose `code` says why: `invalid`, `too-large`, `future-clock` or `deleted`. Its message names fields, never their values, which are user data.

## Schemas

Every version of an app's data schema stays in its code, with a migration from each version to the next (data model §6):

```ts
import { type SchemaVersion, type Values, defineSchemas, field } from "@shkriuss/data";

const v1 = {
  version: 1,
  stores: {
    notes: {
      fields: {
        title: field.string({ maxLength: 200 }),
        done: field.boolean(),
        list: field.reference("lists"),
      },
    },
    lists: { fields: { name: field.string({ maxLength: 50 }) } },
  },
} satisfies SchemaVersion;

const v2 = {
  version: 2,
  stores: {
    notes: {
      fields: {
        title: field.string({ maxLength: 200 }),
        status: field.enum(["open", "done"]),
        list: field.reference("lists"),
      },
    },
    lists: v1.stores.lists,
  },
  migrate: {
    notes: {
      compute: {
        status: { from: ["done"], value: ({ done }) => (done === true ? "done" : "open") },
      },
      remove: ["done"],
    },
  },
} satisfies SchemaVersion;

export const schemas = defineSchemas(v1, v2);
export type Note = Values<typeof v2.stores.notes>; // { title: string; status: "open" | "done"; list: string | null }
```

**Field types** (`field`), each with a default that a missing field reads as:

| Type                                  | Holds                                                     | Default               |
| ------------------------------------- | --------------------------------------------------------- | --------------------- |
| `string({ minLength, maxLength })`    | a string; lengths count UTF-16 code units, as HTML does   | `""`                  |
| `number({ min, max, integer })`       | a finite number                                           | `0`, if allowed       |
| `boolean()`                           | `true` or `false`                                         | `false`               |
| `enum(["a", "b"])`                    | one of the strings                                        | the first             |
| `reference("lists")`                  | the id of a record in that store, or `null`               | `null`                |
| `date()`                              | a calendar date, `YYYY-MM-DD`                             | none                  |
| `timestamp()`                         | milliseconds since 1970                                   | none                  |
| `array(type, { minItems, maxItems })` | a list of values of one type                              | `[]`, if allowed      |
| `object({ ... })`                     | an object with exactly these members, merged as one value | its members' defaults |

`.nullable()` also allows `null` and makes it the default; `.default(value)` sets another default. Merging can leave a reference to a deleted record, so readers must handle a missing target.

**Migrations** name fields as in the previous version. Each operation carries clocks over as the spec requires, so a migration cannot break merging:

| Operation | What it does                                                                           | Clock                                           |
| --------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `rename`  | moves a field to a new name                                                            | kept                                            |
| `convert` | replaces a field's value                                                               | kept                                            |
| `compute` | a new field from fields of the previous version, each missing one given as its default | the greatest of theirs; missing if they all are |
| `remove`  | drops a field                                                                          | dropped                                         |
| `store`   | moves every record of the store, deleted ones too, to another store                    | unchanged                                       |

Other fields keep their name, value and clock, and new fields read as their defaults. Migration functions must be pure and deterministic: every device must turn the same record into the same result. A field computed from several fields gets only the latest of their clocks, so a merge can later keep a value computed from older sources; compute from one field where you can.

`defineSchemas()` throws when the app starts if any version or migration is wrong: a field without a default, a version number skipped, a migration that names a field the schema lacks, writes one field from two sources, or would leave a store's records nowhere. `migrateRecord()` checks every step's result against that version's schema, and `checkIncomingRecord()` runs the whole check of data model §8 on a record from a backup.

## Tests

- **Property-based tests** (fast-check, [ADR 0008](../../docs/decisions/0008-quality-gates.md)) check on generated records that merging is commutative, associative and idempotent, that it keeps the later write of every field, and that its result always passes the checks for records from outside. The generators draw clocks and field names from small sets, so copies often share fields and clocks, and sometimes have equal clocks with different values.
- **Examples** cover each situation of the data model's merge table, the RFC 8785 test vectors, and every check of section 8. Migrations are tested rule by rule, including tombstones, records that came back alive and store moves, and as properties: they are deterministic, give records that pass every check, and merge the same way before and after migrating.
- **Coverage:** `pnpm --filter @shkriuss/data test` fails below 90% of lines, branches, functions or statements.
