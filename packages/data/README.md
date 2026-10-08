# @shkriuss/data

The data layer: how every app stores its records, stamps its changes and merges copies of the same record. It implements the [data model spec](../../docs/specs/data-model.md) ([ADR 0004](../../docs/decisions/0004-local-data-and-backups.md)). Apps reach their data only through this package.

It has pure functions on records, the schemas and migrations that check and evolve them, and the IndexedDB storage that apps read and write through, built on [Dexie](https://dexie.org). The backup import builds on these.

The package has no side effects (`"sideEffects": false` in its `package.json`): its modules only define things, so a build keeps only the modules whose code it uses. The backups' encryption worker uses the checks of imported data, and so has neither the storage nor Dexie; a test of `@shkriuss/backup` holds it to that.

| Module        | What it does                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hlc.ts`      | Hybrid logical clocks (§3): the format, issuing an HLC for a change, receiving HLCs from elsewhere, telling clocks from the future; device ids           |
| `ids.ts`      | Record ids: UUIDv7 (RFC 9562), and the fixed id of the settings record                                                                                   |
| `json.ts`     | Field values (§2.3): checked, normalized copies of JSON values, and canonical JSON (RFC 8785) for comparing and measuring them                           |
| `names.ts`    | Field and store names (§2.3, §2.5)                                                                                                                       |
| `record.ts`   | The record format (§2): deleted or alive, the last change, the limits, and the structural checks for records from outside, such as a backup (§8, step 1) |
| `changes.ts`  | Creating, updating and deleting a record within a change (§4)                                                                                            |
| `merge.ts`    | Merging two copies of a record (§5)                                                                                                                      |
| `fields.ts`   | Field types: the values a field holds, its constraints and its default (§2.3)                                                                            |
| `schema.ts`   | Store schemas and schema versions, checked by `defineSchemas()`; the data check for records (§8, step 2); reading values with defaults                   |
| `migrate.ts`  | Migrating records from version to version (§6), and the whole check for records from outside (§8)                                                        |
| `db.ts`       | The storage (§7): opening and upgrading the database, changes with one HLC each, reads and observed queries, the device's state; snapshots and imports   |
| `incoming.ts` | The checks and the migration of a backup's records before they are imported (backup format §5.4, §5.5)                                                   |
| `errors.ts`   | `DataLayerError`, which every refusal throws                                                                                                             |

Apart from `db.ts`, every function is pure: it returns a new record and never changes the one it is given. A refusal throws a `DataLayerError` whose `code` says why: `invalid`, `too-large`, `future-clock`, `deleted`, `not-found`, `newer-version`, `closed` or `storage-full`, for a write that the browser refused for lack of space, which `isStorageFull(error)` tells apart so that the app can ask the user to free some (data model §7). Its message names fields, never their values, which are user data.

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

Other fields keep their name, value and clock, and new fields read as their defaults. A field that keeps its value, under its name or a new one, must keep its type, or become nullable: any other change of type needs a `convert`, which may return the value as it is where the new type holds it, or a `remove` (data model §6). Otherwise a stored value that the new type refuses would stop the upgrade on every start. Migration functions must be pure and deterministic: every device must turn the same record into the same result. A field computed from several fields gets only the latest of their clocks, so a merge can later keep a value computed from older sources; compute from one field where you can.

`defineSchemas()` throws when the app starts if any version or migration is wrong: a field without a default, a version number skipped, a migration that names a field the schema lacks, writes one field from two sources, keeps a field but changes its type, or would leave a store's records nowhere. Each field type's `signature` says exactly which values it holds, whatever its default, which is how a kept field's types are compared. `migrateRecord()` checks every step's result against that version's schema, and `checkIncomingRecord()` runs the whole check of data model §8 on a record from a backup.

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

// The notes now, and again after every change to them, in this tab or another one.
const subscription = db
  .observe(async (reader) => reader.list("notes"))
  .subscribe({ next: showNotes, error: showError });
subscription.unsubscribe(); // once they are no longer shown
```

- **One database per app,** named `shkriuss`: an object store for each store of the current schema version, keyed by `id`, and `meta` for the device's state (data model §7). Dexie keeps IndexedDB's version at ten times the schema version.
- **Changes:** `change(write)` runs `write` in one read-write transaction over every store, with one new HLC for all its writes (§3.3, §4). Its reads see its writes, and if `write` throws, nothing changes. Inside `write`, await only the change's own methods: awaiting anything else, such as `fetch` or a timer, lets IndexedDB commit the transaction early. Values are checked against the current schema before they are stored.
- **Reads:** `get()`, `list()` and `settings()` give every field, with defaults for missing ones, typed by the schema. Deleted records read as missing. `list()` sorts by id, which is by creation time to the millisecond.
- **Observing:** `observe(query)` gives the result of `query`, then a new one after every change that may change it, made in this tab or in another one. It is built on Dexie's live queries, which tell other tabs through `BroadcastChannel`. It runs `query` again only after changes to what `query` read: a record it got, or a store it listed. `query` gets a reader, which can only read, and must await only its reads. An error of a read, such as `closed`, ends the observation. React components use it through `@shkriuss/shell`.
- **Upgrades:** opening migrates every record from the database's version to the current one inside the upgrade transaction (§6). If a migration fails, the database stays as it was and `openDatabase()` rejects.
- **Newer databases:** if a newer version of the app has upgraded the database, `openDatabase()` rejects with `newer-version` and leaves the database as it is. So do later reads and changes if the database reopens by itself, for example when the page comes back from the back-forward cache. A release that raises the schema version can therefore never be rolled back, only fixed by a newer one.
- **Other tabs:** `onBlocked` is called while other tabs keep an older version of the database open. `onVersionChange` is called when another tab needs the database closed, because a newer version of the app upgrades it or something deletes it; the database is closed by then, its reads and changes reject with `closed`, and the app must reload.
- **Device state:** `device()` gives the device id, when the device last made a backup and how many changes have written something since; `recordBackup(counted)` records a backup of a snapshot that had counted `counted` changes (backup format §4), so that changes made while the user saved it still count as changes since.
- **Durability:** transactions ask for strict durability, so a change is on disk when it completes.

## Backups

The data layer's part of the [backup format](../../docs/specs/backup-format.md); `@shkriuss/backup` adds the file, its encryption and the user's steps.

```ts
import { checkIncomingStores } from "@shkriuss/data";

// Export (§4): every record, deleted ones included, at one moment.
const { schemaVersion, stores, counted } = await db.snapshot();
// …write the backup file, then:
await db.recordBackup(counted);

// Import (§5): `backup` is a parsed backup document whose format, app and version were checked.
const incoming = checkIncomingStores(schemas, backup.schemaVersion, backup.stores);
const preview = await db.previewImport(incoming); // { total: { new: 12, updated: 3, deleted: 1, unchanged: 40 }, stores, fromFuture }
// …once the user confirms, including any dates from the future that the preview showed:
const imported = await db.import(incoming, { acceptFromFuture: preview.fromFuture !== undefined });
```

- **Checks:** `checkIncomingStores()` checks that the backup has exactly the stores of its schema version, each an array of records. Every record must pass the checks of data model §8 and be at that version. No store of the backup may hold an id twice. One refused record refuses the whole backup. It then migrates every record to the current version; two records that the migration puts into one store with the same id are copies of one record, and merge (data model §6), as in an upgrade.
- **Only checked records:** the result can be previewed and imported, and nothing else can: TypeScript and the import itself refuse any other object, and its records are frozen.
- **Preview:** `previewImport()` merges each record with its local copy in memory and counts, per store and in total, the records that are new, updated (including ones that come back after a deletion), deleted or unchanged. Its `writes` also counts the deletions that change nothing the device shows, such as those of records it never had, which the import keeps: an app offers to import a backup whenever `writes` is more than 0. It writes nothing. Its `fromFuture` is the time of the backup's greatest HLC if that lies more than 24 hours after this device's clock (§3.5), which the user must confirm.
- **Clocks from the future:** `import()` refuses them with `future-clock`, unless `acceptFromFuture` says that the user confirmed them; it checks them against this device's clock again, which may have changed since the preview. `snapshot()` has the same `fromFuture`, so that an export can say that restoring it will ask. HLCs after the end of the year 9999 are refused as `invalid`: a device's clock never gets that far, and one that received such a time could run out of HLCs.
- **Import:** `import()` does the same in one transaction over every store. It reads each local copy again and writes every merged record that differs, including tombstones of records the device never had. The device receives the backup's greatest HLC, so its later changes sort after everything in the backup. An import that writes something counts as a change since the last backup. If anything fails, nothing changes. Importing the same backup again changes nothing, and the order of imports does not matter.

## Tests

- **Property-based tests** (fast-check, [ADR 0008](../../docs/decisions/0008-quality-gates.md)) check on generated records that merging is commutative, associative and idempotent, that it keeps the later write of every field, and that its result always passes the checks for records from outside. The generators draw clocks and field names from small sets, so copies often share fields and clocks, and sometimes have equal clocks with different values.
- **Examples** cover each situation of the data model's merge table, the RFC 8785 test vectors, and every check of section 8. Migrations are tested rule by rule, including tombstones, records that came back alive and store moves, and as properties: they are deterministic, give records that pass every check, and merge the same way before and after migrating.
- **Storage tests** run Dexie on [fake-indexeddb](https://github.com/dumbmatter/fakeIndexedDB): upgrades that move stores and keep tombstones and clocks, failing migrations, newer and repaired databases, tabs that upgrade, delete or block the database, connections that the browser closes, two connections issuing HLCs at once, and the device state. A database two versions behind, as after an update that skips a version, goes through every migration. Observed queries follow changes, imports and other connections, run again only after changes to what they read, and end with their errors.
- **Backup tests** check every rule of `checkIncomingStores()`, including a migration that merges two stores, and that its result can be neither changed nor forged. They count every outcome of an import, check that the device receives the backup's clock, that clocks from the future import only once accepted, as a property too, and that a failed import changes nothing, also when the device runs out of space after part of it was written, which fails as `storage-full`. A backup two versions behind imports through every migration. As properties, any number of imports of two generated backups, in either order, ends in the same records, and stores or records of any shape are refused with the data layer's own error, or give records that pass the checks again unchanged.
- **In real browsers,** the platform end-to-end tests ([`tooling/platform-e2e`](../../tooling/platform-e2e)) run the storage in Chromium, Firefox and WebKit, under the production security headers: records last across reloads, two tabs never issue the same HLC, a query observed in one tab follows changes made in another, a newer version upgrades the database, which older ones then refuse, and a backup carries the records to another device and to a newer version.
- **Coverage:** `pnpm --filter @shkriuss/data test` fails below 90% of lines, branches, functions or statements.
