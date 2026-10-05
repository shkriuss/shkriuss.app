# @shkriuss/data

The data layer: how every app stores its records, stamps its changes and merges copies of the same record. It implements the [data model spec](../../docs/specs/data-model.md) ([ADR 0004](../../docs/decisions/0004-local-data-and-backups.md)). Apps reach their data only through this package.

It has pure functions on records, the schemas and migrations that check and evolve them, and the IndexedDB storage that apps read and write through, built on [Dexie](https://dexie.org). The backup import builds on these.

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
| `db.ts`      | The storage (§7): opening and upgrading the database, changes with one HLC each, reads, settings and the device's state                                  |
| `errors.ts`  | `DataLayerError`, which every refusal throws                                                                                                             |

Apart from `db.ts`, every function is pure: it returns a new record and never changes the one it is given. A refusal throws a `DataLayerError` whose `code` says why: `invalid`, `too-large`, `future-clock`, `deleted`, `not-found`, `newer-version` or `closed`. Its message names fields, never their values, which are user data.

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

## Storage

`openDatabase()` opens the app's database, creating it or upgrading it first, and returns what apps read and write through:

```ts
import { openDatabase } from "@shkriuss/data";

const db = await openDatabase(schemas, { onVersionChange: showReloadNotice });

const id = await db.change((change) => change.create("notes", { title: "Milk" }));
await db.change(async (change) => {
  await change.update("notes", id, { status: "done" });
  await change.updateSettings({ sortBy: "title" });
});

const note = await db.get("notes", id); // { id, values: { title: "Milk", status: "done", list: null } }
const notes = await db.list("notes"); // every note that is not deleted
```

- **One database per app,** named `shkriuss`: an object store for each store of the current schema version, keyed by `id`, and `meta` for the device's state (data model §7). Dexie keeps IndexedDB's version at ten times the schema version.
- **Changes:** `change(write)` runs `write` in one read-write transaction over every store, with one new HLC for all its writes (§3.3, §4). Its reads see its writes, and if `write` throws, nothing changes. Inside `write`, await only the change's own methods: awaiting anything else, such as `fetch` or a timer, lets IndexedDB commit the transaction early. Values are checked against the current schema before they are stored.
- **Reads:** `get()`, `list()` and `settings()` give every field, with defaults for missing ones, typed by the schema. Deleted records read as missing. `list()` sorts by id, which is by creation time to the millisecond.
- **Upgrades:** opening migrates every record from the database's version to the current one inside the upgrade transaction (§6). If a migration fails, the database stays as it was and `openDatabase()` rejects.
- **Newer databases:** if a newer version of the app has upgraded the database, `openDatabase()` rejects with `newer-version` and leaves the database as it is. So do later reads and changes if the database reopens by itself, for example when the page comes back from the back-forward cache. A release that raises the schema version can therefore never be rolled back, only fixed by a newer one.
- **Other tabs:** `onBlocked` is called while other tabs keep an older version of the database open. `onVersionChange` is called when another tab needs the database closed, because a newer version of the app upgrades it or something deletes it; the database is closed by then, its reads and changes reject with `closed`, and the app must reload.
- **Device state:** `device()` gives the device id, when the device last made a backup and how many changes have written something since; `recordBackup()` records a backup (backup format §4).
- **Durability:** transactions ask for strict durability, so a change is on disk when it completes.

## Tests

- **Property-based tests** (fast-check, [ADR 0008](../../docs/decisions/0008-quality-gates.md)) check on generated records that merging is commutative, associative and idempotent, that it keeps the later write of every field, and that its result always passes the checks for records from outside. The generators draw clocks and field names from small sets, so copies often share fields and clocks, and sometimes have equal clocks with different values.
- **Examples** cover each situation of the data model's merge table, the RFC 8785 test vectors, and every check of section 8. Migrations are tested rule by rule, including tombstones, records that came back alive and store moves, and as properties: they are deterministic, give records that pass every check, and merge the same way before and after migrating.
- **Storage tests** run Dexie on [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB): upgrades that move stores and keep tombstones and clocks, failing migrations, newer and repaired databases, tabs that upgrade, delete or block the database, connections that the browser closes, two connections issuing HLCs at once, and the device state.
- **In real browsers,** the platform end-to-end tests ([`tooling/platform-e2e`](../../tooling/platform-e2e)) run the storage in Chromium, Firefox and WebKit, under the production security headers: records last across reloads, two tabs never issue the same HLC, and a newer version upgrades the database, which older ones then refuse.
- **Coverage:** `pnpm --filter @shkriuss/data test` fails below 90% of lines, branches, functions or statements.
