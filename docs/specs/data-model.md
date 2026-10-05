# Data model

- **Status:** accepted, 2026-10-05 (Phase 1.1)
- **Implements:** [ADR 0004](../decisions/0004-local-data-and-backups.md)
- **Implemented by:** `@shkriuss/data` (Phase 1.2)

How every app stores its data: the record format, the hybrid logical clock that stamps every change, how changes and deletions are written, how two copies of a record merge, how schemas evolve, and how records from outside are checked. The backup file that carries records between devices is specified in [backup-format.md](backup-format.md).

**Must**, **must not**, **should** and **may** are used as in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 1. Terms

- **App:** one app on its own origin, such as `notes.shkriuss.app`.
- **Device:** one installation of an app: a browser profile, or on iOS an installed home-screen app. Each has its own storage and its own device id. Clearing an app's site data makes a new device.
- **Store:** a named collection of records of one kind within an app, such as `notes` or `tags`; like a table.
- **Record:** one item in a store.
- **Field:** a top-level member of a record's data, such as `title`.
- **Change:** one write transaction, which creates, edits or deletes records.
- **HLC:** a hybrid logical clock timestamp (section 3).
- **Schema version:** the version of an app's data schema, an integer that starts at 1.

## 2. Records

### 2.1 Format

A record is a JSON object with these members and no others:

| Member    | Type                    | Meaning                                                                                                                                  |
| --------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | string                  | Permanent id: a UUIDv7 ([RFC 9562](https://www.rfc-editor.org/rfc/rfc9562)), lowercase, with hyphens. Never changes and is never reused. |
| `v`       | integer ≥ 1             | The schema version the record conforms to.                                                                                               |
| `data`    | object                  | Field values. A missing field has its default value (section 2.3).                                                                       |
| `clock`   | object                  | For each member of `data`, the HLC of the change that last wrote it. It has exactly the keys of `data`.                                  |
| `deleted` | string, may be left out | The HLC of the record's latest deletion: the tombstone. Left out if the record was never deleted.                                        |

A live record:

```json
{
  "id": "01a10307-b840-78aa-ab29-1a1138faaff6",
  "v": 1,
  "data": { "title": "Milk", "done": true },
  "clock": {
    "title": "001791052200000:00000:9f86d081884c7d65",
    "done": "001791101700000:00000:3c2b1a0f9e8d7c6b"
  }
}
```

One device created it with a title; a second device later marked it done. A deleted record, a tombstone:

```json
{
  "id": "01a10307-cbc8-73e0-98ab-ae848aa1d694",
  "v": 1,
  "data": {},
  "clock": {},
  "deleted": "001791104400000:00000:9f86d081884c7d65"
}
```

### 2.2 Deleted or alive

- Every clock in `clock` is greater than `deleted`: a deletion erases the fields written before it (section 4.3), and merging removes any that arrive later (section 5.2).
- So a record is **deleted** if it has `deleted` and `clock` is empty. Otherwise it is **alive**. A change made after a deletion, on another device, brings the record back (section 5.3).
- A record's **last change** is the greatest of its clocks and `deleted`.

### 2.3 Fields and values

- Field names match `^[a-z][A-Za-z0-9]{0,63}$`, and are not the name of an `Object.prototype` member (`constructor`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `toLocaleString`, `toString`, `valueOf`).
- Values are JSON values: `null`, `true`, `false`, numbers, strings, arrays and objects.
  - Numbers are finite; `-0` is stored as `0`. Integers should stay within ±(2^53 − 1).
  - Strings are well-formed Unicode, without lone surrogates.
  - No object, at any depth, has a key `__proto__`.
  - Nesting is at most 32 levels deep.
  - No `undefined`, `Date`, binary data or other non-JSON types. Times are numbers (milliseconds since the Unix epoch) or ISO 8601 strings, as each app's schema defines.
- Each store's schema defines its fields: names, types, constraints and a **default value** for every field. Any field can be missing from `data`: it was never written, a later schema version added it, or a deletion erased it. A missing field reads as its default.
- Merging works per field. A nested object or array is one value: if two devices change different parts of it, one change is lost. Things that change independently, such as the items of a list, are separate records.
- A field that refers to another record holds that record's `id`. Merging can leave a reference to a deleted record, so apps must handle missing targets.

### 2.4 Limits

| What                                                         | Limit |
| ------------------------------------------------------------ | ----- |
| Fields in a store's schema                                   | 256   |
| Size of one record as canonical JSON (section 5.4), in UTF-8 | 1 MiB |
| Nesting depth of a value                                     | 32    |

The data layer refuses writes beyond these limits, so every stored record can be exported and imported.

### 2.5 Stores

- Store names follow the same rules as field names.
- `settings` is reserved for an app's settings that travel with its backups. It holds at most one record, with the fixed id `00000000-0000-7000-8000-000000000000`, so that the settings of two devices merge field by field.
- `meta` is reserved for the data layer (section 7) and holds no records.
- Each store holds its records, alive and deleted, by `id`.

## 3. Hybrid logical clock

### 3.1 Format

An HLC is a string of three fixed-width parts separated by colons:

| Part      | Format                                       | Meaning                                    |
| --------- | -------------------------------------------- | ------------------------------------------ |
| Wall time | 15 decimal digits, zero-padded               | Milliseconds since the Unix epoch          |
| Counter   | 5 decimal digits, zero-padded, at most 65535 | Orders changes within the same millisecond |
| Device id | 16 lowercase hexadecimal digits              | The device that made the change            |

Pattern: `^[0-9]{15}:[0-9]{5}:[0-9a-f]{16}$`, with a counter of at most 65535. Example: `001791052200000:00000:9f86d081884c7d65`.

Because the parts have fixed widths, comparing two HLCs as strings orders them by wall time, then counter, then device id. Ties between devices are therefore broken by device id (ADR 0004). A device never issues the same HLC twice, and device ids differ, so two different changes never share an HLC.

### 3.2 Device id

On first use, a device draws 64 random bits with `crypto.getRandomValues` and stores them. The id says nothing about the device or the user and never changes.

### 3.3 Issuing an HLC

A device keeps the last HLC it issued or received as `(lastWall, lastCounter)`, initially `(0, 0)`. For each change:

1. Let `now` be `Date.now()`.
2. If `now > lastWall`, the new HLC has wall time `now` and counter 0.
3. Otherwise it has wall time `lastWall` and counter `lastCounter + 1`. If that counter would exceed 65535, it has wall time `lastWall + 1` and counter 0.
4. Store the new HLC as the last one, in the change's own transaction.

All writes in one change carry the same HLC. Because the last HLC is read and written in the same transaction as the change, two tabs of one app can never issue the same HLC.

### 3.4 Receiving HLCs

After records from elsewhere are merged in, the device sets its last HLC to the greatest HLC among them, if that is greater. Every later change on the device then sorts after everything it has received.

### 3.5 Clocks from the future

An import is refused if any of its HLCs has a wall time more than 24 hours after the receiving device's `Date.now()` ([backup-format.md](backup-format.md#54-validate)). Accepting it would move this device's clock that far ahead for good, and its changes would then win against every other device's.

## 4. Changes

A change is one IndexedDB transaction with one HLC, `h`.

### 4.1 Create

A new record gets a new UUIDv7 id. Each field the app sets is stored with clock `h`; fields it does not set are missing and read as their defaults. There is no `deleted`.

### 4.2 Update

Each field written gets its new value and clock `h`, even if the value is the default. Fields not written keep their values and clocks. Deleted records cannot be updated.

### 4.3 Delete

Deleting sets `deleted` to `h` and removes every field from `data` and `clock`. The content is gone at once; only the id, the schema version and the time of deletion remain. The record itself is never removed (there is no hard delete), so that an older copy imported later cannot bring it back.

Apps that offer undo or a trash keep a field such as `trashed`, and delete records only when the trash is emptied.

## 5. Merge

Merging combines two copies of the same record (same store, same `id`), such as the local copy and one from a backup. If only one copy exists, it is the result.

### 5.1 Before merging

Both copies must have the same schema version. A copy with an older one is migrated first (section 6). A copy newer than the app understands is never merged; the whole import is refused.

### 5.2 Rules

For copies `a` and `b`:

1. The result's `deleted` is the greater of `a.deleted` and `b.deleted`, or left out if both are. A missing `deleted` is lower than every HLC.
2. For each field in `a.clock` or `b.clock`, take the value and the clock from the copy whose clock for that field is greater; a missing clock is lower than every HLC. If the clocks are equal but the values differ, take the value whose canonical JSON (section 5.4) is greater, comparing strings by UTF-16 code units. Equal clocks with different values occur only in damaged or crafted data, or when one device's storage was copied to another; the rule keeps the result deterministic.
3. Remove every field whose clock is not greater than the result's `deleted`: the deletion erased it. A clock equal to `deleted` occurs only in damaged or crafted data; removing that field as well keeps every clock greater than `deleted` (section 2.2), so the result always passes the checks of section 8.

The result keeps `id` and `v`, which both copies share.

### 5.3 Properties

Rules 1 and 2 take a maximum per member, and rule 3 removes only fields that a deletion erased. Merging is therefore:

- **commutative:** `merge(a, b)` equals `merge(b, a)`;
- **associative:** `merge(merge(a, b), c)` equals `merge(a, merge(b, c))`;
- **idempotent:** `merge(a, a)` equals `a`, so importing the same backup twice changes nothing.

Property-based tests in `@shkriuss/data` check these on generated records, including deletions, equal clocks and fields that only one copy has.

In practice:

| Situation                                              | Result                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Two devices change different fields                    | Both changes are kept.                                                                  |
| Two devices change the same field                      | The later change, by HLC, wins.                                                         |
| An old backup is imported                              | Nothing newer is overwritten, and nothing deleted comes back.                           |
| A device deletes a record that another changed earlier | The record stays deleted.                                                               |
| A device changes a record after another deleted it     | The record comes back with the fields of that later change; older content stays erased. |

The last row follows ADR 0004: a tombstone and later changes are compared by HLC like any other change.

### 5.4 Canonical JSON

Canonical JSON is the [JSON Canonicalization Scheme (RFC 8785)](https://www.rfc-editor.org/rfc/rfc8785): object members sorted by key, no whitespace, and numbers and strings serialized as ECMAScript serializes them. It is used to compare values (section 5.2) and to measure records (section 2.4).

## 6. Schema versions and migrations

- An app's data schema has one version for all its stores, starting at 1. Any change to what records may contain, or to the stores and their indexes, adds 1.
- The schema of every version an app has shipped stays in its code, with a migration from each version to the next. Old backups can therefore always be validated and migrated, and a test imports a fixture of each version ([backup-format.md](backup-format.md#8-compatibility)).
- On an app update, the migrations run inside the IndexedDB upgrade transaction, so the database moves to the new version completely or not at all. The same functions migrate records from backups.
- A migration turns a record of version `n` into one of version `n + 1`, in the same store or another one. It must be pure and deterministic: the same input gives the same output on every device, because two devices that migrate the same record must end up with copies that merge cleanly. It must not read the time, random numbers, other records or anything about the device.
- Clocks carry over as follows:
  - a renamed field keeps its value and clock;
  - a field whose value is converted keeps its clock;
  - a field computed from other fields gets the greatest of their clocks, or is missing if they all are;
  - a new field is missing, so it reads as its default;
  - a removed field is dropped with its clock;
  - `id` and `deleted` never change, and tombstones only get the new `v`.
- Migrations never create or remove records. Anything else requires a change to this spec first.

## 7. Storage

- Each app has one IndexedDB database named `shkriuss`, used only through `@shkriuss/data` (Dexie). Its version follows the schema version.
- Each store is an object store keyed by `id`, holding live and deleted records. `@shkriuss/data` may add derived properties for indexes, such as whether a record is alive; they are never exported.
- The `meta` object store holds this device's state and is never exported: the device id, the last HLC, when the device last made a backup, and how many changes it has had since. Every change counts, and so does every import that writes anything. Backup reminders use the last two ([architecture §8](../architecture.md#8-backups)).
- Apps request persistent storage with `navigator.storage.persist()` ([architecture §7](../architecture.md#7-data-layer)).

## 8. Records from outside

Records from a backup are untrusted. Before any of them is merged, each one is checked, and one failure fails the whole import:

1. **Structure:** exactly the members of section 2.1, of the right types; `id` a lowercase UUIDv7 (`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`), and in `settings` the fixed id; `v` an integer from 1 to the app's current version; every HLC well-formed (section 3.1) and not from the future (section 3.5); `clock` has exactly the keys of `data`; every clock is greater than `deleted`, if present; the rules and limits of sections 2.3 and 2.4.
2. **Schema:** `data` is valid for its store at the record's own schema version: only known fields, each of the right type and within its constraints.
3. **Migration:** the record is migrated to the current version (section 6) and checked against the current schema again, which also catches a faulty migration.

## 9. Not covered

These need a change to this spec, and some an ADR, before they are built:

- Sync between devices ([future/accounts-and-sync.md](../future/accounts-and-sync.md)). Records are ready for it: each carries everything needed to merge it.
- Collaborative rich text, which needs a CRDT ([ADR 0004](../decisions/0004-local-data-and-backups.md)).
- Attachments such as images.
- Order keys for lists that users sort by hand.
