# Backup format

- **Status:** proposed (Phase 1.1)
- **Implements:** [ADR 0004](../decisions/0004-local-data-and-backups.md)
- **Implemented by:** `@shkriuss/backup` (Phase 1.2)
- **Format version:** 1

A backup is a file with all of one app's data on one device: every record of every store, alive or deleted, settings included. Users make backups to keep a copy off the device, to restore after losing one, and to move data between devices. Importing merges ([data-model.md §5](data-model.md#5-merge)), so exporting on one device and importing on another works like a manual sync.

Records, HLCs and merging are defined in [data-model.md](data-model.md). **Must**, **must not**, **should** and **may** are used as in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

Readable exports for other tools, such as CSV, Markdown or iCalendar, are separate: each app defines its own, and they cannot be imported back.

## 1. Files

| Kind                   | Content                                                                                       | File name                    | Media type                 |
| ---------------------- | --------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------- |
| Encrypted, the default | The backup document (section 2), encrypted with [age](https://age-encryption.org) (section 3) | `shkriuss-<app>-<date>.age`  | `application/octet-stream` |
| Plain, after a warning | The backup document                                                                           | `shkriuss-<app>-<date>.json` | `application/json`         |

- `<app>` is the app id, and `<date>` the device's local date when the backup was made, as `YYYY-MM-DD`. Example: `shkriuss-notes-2026-10-04.age`.
- Importers recognize a file by its content, never by its name or media type (section 5.2).
- Encryption does not hide the file's name, its size or its dates in the file system.

## 2. The backup document

UTF-8 JSON ([RFC 8259](https://www.rfc-editor.org/rfc/rfc8259)) without a byte order mark. Exporters indent with two spaces, so that a decrypted backup is readable; importers accept any valid JSON whitespace.

```json
{
  "format": "shkriuss-backup",
  "formatVersion": 1,
  "app": "notes",
  "schemaVersion": 1,
  "exported": "2026-10-04T21:13:20.000Z",
  "stores": {
    "notes": [
      {
        "id": "01a10307-b840-78aa-ab29-1a1138faaff6",
        "v": 1,
        "data": { "title": "Milk", "done": true },
        "clock": {
          "title": "001791052200000:00000:9f86d081884c7d65",
          "done": "001791101700000:00000:3c2b1a0f9e8d7c6b"
        }
      },
      {
        "id": "01a10307-cbc8-73e0-98ab-ae848aa1d694",
        "v": 1,
        "data": {},
        "clock": {},
        "deleted": "001791104400000:00000:9f86d081884c7d65"
      }
    ],
    "settings": [
      {
        "id": "00000000-0000-7000-8000-000000000000",
        "v": 1,
        "data": { "sortBy": "title" },
        "clock": { "sortBy": "001790856000000:00000:9f86d081884c7d65" }
      }
    ]
  }
}
```

The document is an object with these members and no others:

| Member          | Type        | Meaning                                                                                                                                                                                       |
| --------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`        | string      | Always `shkriuss-backup`.                                                                                                                                                                     |
| `formatVersion` | integer     | The version of this format, `1`.                                                                                                                                                              |
| `app`           | string      | The id of the app whose data this is.                                                                                                                                                         |
| `schemaVersion` | integer ≥ 1 | The app's schema version when the backup was made. Every record has it as `v`.                                                                                                                |
| `exported`      | string      | When the backup was made, in UTC with milliseconds, as `Date.prototype.toISOString` writes it: `YYYY-MM-DDTHH:mm:ss.sssZ`. Shown to the user; merging never uses it.                          |
| `stores`        | object      | One member for each store the app had at `schemaVersion`: an array of all its records ([data-model.md §2](data-model.md#2-records)), deleted ones included. An empty store is an empty array. |

## 3. Encryption

Encrypted backups use [age, version 1](https://age-encryption.org/v1), through the `age-encryption` library ([ADR 0004](../decisions/0004-local-data-and-backups.md)):

- **Passphrase only:** the header has exactly one recipient stanza, of type `scrypt`.
- **Work factor:** exporters use log2(N) = 18, with r = 8 and p = 1, so deriving the key takes 256 MiB of memory. Importers accept at most 20; `age-encryption` refuses higher values as too slow.
- **Binary encoding:** the file starts with the line `age-encryption.org/v1`. Importers also accept the ASCII-armored form, which starts with `-----BEGIN AGE ENCRYPTED FILE-----`.
- **Payload:** exactly the bytes of the backup document.

Any age implementation can therefore decrypt a backup, for example `age --decrypt shkriuss-notes-2026-10-04.age > backup.json`, so users are never locked in. A backup document encrypted with `age --passphrase` imports too, if its work factor is at most 20.

age authenticates the whole file: a changed or truncated file fails to decrypt. Importers decrypt the whole file before using any of it.

### 3.1 Passphrases

- The app first offers a generated passphrase: six words chosen with `crypto.getRandomValues` from a list of 2,048 words that ships with the app, joined by hyphens. That is 66 bits, far out of reach of offline guessing at this work factor. Example: `burst-swarm-slender-curve-ability-various`.
- A passphrase the user picks must have at least 12 characters and is typed twice.
- Before use, a passphrase is normalized to Unicode NFC, so the same passphrase typed on different devices gives the same bytes. Nothing else is changed; spaces count.
- A passphrase is never stored, logged or sent anywhere, and stays in memory only during the operation. There is no hint and no recovery: without the passphrase, the backup cannot be opened ([threat model](../threat-model.md#5-residual-risks-accepted) R3).

Deriving the key takes seconds on a phone, so encryption and decryption run in a worker and the page stays responsive. Starting that worker needs the Trusted Types policy for workers that [ADR 0010](../decisions/0010-script-integrity.md) calls for; it is decided in Phase 1.2.

## 4. Export

1. Read every store in one IndexedDB read transaction, so the backup is a consistent snapshot. Include deleted records: they carry deletions to other devices.
2. Build the document (section 2). If it would be larger than importers accept (section 5.1), refuse and explain: every backup that is made must import.
3. **Encrypted:** encrypt it with the passphrase (section 3). **Plain:** only after the user confirms a warning that anyone who gets the file can read all of it.
4. Hand the file over: the share sheet (Web Share API) where the browser has one, otherwise a download ([architecture §8](../architecture.md#8-backups)).
5. Record in `meta` when the backup was made, and set the count of changes since the last backup to zero ([data-model.md §7](data-model.md#7-storage)). Backup reminders use both.

## 5. Import

A backup file is hostile input ([threat model](../threat-model.md#4-threats-and-mitigations) T6). The steps run in this order. A failure at any step stops the import, tells the user why (section 6) and changes nothing.

### 5.1 Size check

Refuse a file larger than 64 MiB before reading it.

### 5.2 Recognize and decrypt

- If the file starts with `age-encryption.org/v1` and a newline, or with `-----BEGIN AGE ENCRYPTED FILE-----`, it is encrypted: ask for the passphrase and decrypt it (section 3). After a wrong passphrase, the user can try again.
- Otherwise it must be a plain backup document.

### 5.3 Parse

Decode the bytes as UTF-8, refusing invalid UTF-8, and parse them as JSON. A byte order mark makes parsing fail.

### 5.4 Validate

1. The document has exactly the members of section 2, of the right types.
2. `format` is `shkriuss-backup`, and `formatVersion` is one the app supports.
3. `app` is this app's id.
4. `schemaVersion` is at most the app's current schema version. Data newer than the app understands is never partly imported.
5. `stores` has exactly the stores the app had at `schemaVersion`.
6. Every record passes the checks of [data-model.md §8](data-model.md#8-records-from-outside), has `v` equal to `schemaVersion`, and has an `id` that no other record in its store has. No HLC is more than 24 hours ahead of this device's clock ([data-model.md §3.5](data-model.md#35-clocks-from-the-future)).

### 5.5 Migrate

Migrate every record to the app's current schema version ([data-model.md §6](data-model.md#6-schema-versions-and-migrations)), and check the results against the current schema.

### 5.6 Preview

Merge each incoming record with its local copy, in memory, and count per store:

- **new:** there is no local copy, and the merged record is alive;
- **updated:** the merged record differs from the local copy and is alive, including records that come back after a deletion;
- **deleted:** the local copy is alive and the merged record is deleted;
- **unchanged:** all others.

Show the app, the date of the backup and the counts, such as "12 new, 3 updated, 1 deleted", and ask the user to confirm. Nothing has been written yet.

### 5.7 Apply

In one IndexedDB read-write transaction over every store and `meta`:

1. Merge each incoming record with its local copy, read again inside this transaction in case another tab changed it since the preview, and write the result if it differs. This also stores tombstones of records the device never had, so that an older backup imported later cannot bring them back.
2. Advance the device's last HLC to the greatest HLC in the backup ([data-model.md §3.4](data-model.md#34-receiving-hlcs)).
3. If anything was written, count the import as a change since the last backup: the device now holds data that its own last backup lacks.

If anything fails, the transaction aborts and nothing changes. Otherwise, report what was imported.

Importing the same backup twice changes nothing, and the order in which backups are imported does not matter ([data-model.md §5.3](data-model.md#53-properties)).

## 6. Errors

Every failure says what happened and what to do. The import must tell these apart:

| Condition                                                | The user is told                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Larger than 64 MiB                                       | The file is too large to be a backup.                                                                             |
| Neither an age file nor a backup document                | This is not a backup file.                                                                                        |
| Wrong passphrase                                         | The passphrase is wrong; try again.                                                                               |
| Damaged or truncated age file, or a work factor above 20 | The file is damaged or not supported.                                                                             |
| A backup of another app                                  | This is a backup of another app, with a link to it if `app` is one of ours.                                       |
| A newer format version or schema version                 | The backup was made by a newer version of the app; update the app and try again.                                  |
| An HLC more than 24 hours in the future                  | The backup's times lie in the future; check the date and time on this device and on the one that made the backup. |
| Any other failed check                                   | The backup is damaged or was changed, and was not imported.                                                       |

## 7. Security

- An encrypted backup reveals only its size, name and file dates without the passphrase. Its content and integrity rest on age and the passphrase (section 3).
- A plain backup protects nothing: anyone who gets it can read and change it. Changes are caught only to the extent that the import checks are.
- A crafted backup can add, change or delete records of the app it names, within the checks of section 5.4, and the user sees the counts before anything is written; it cannot affect other apps. Imported data is never executed or rendered as HTML ([threat model](../threat-model.md#4-threats-and-mitigations) T6).

## 8. Compatibility

- The **format version** changes when sections 2 or 3 change, or the record format of [data-model.md §2–3](data-model.md#2-records) does. **Schema versions** change with each app's data ([data-model.md §6](data-model.md#6-schema-versions-and-migrations)).
- An app imports every format version and every schema version it has ever exported, forever.
- Each app keeps, for every format and schema version it has exported, a fixture backup in plain and in encrypted form (with the passphrase stated in the test). Tests import each fixture and check the result. Fixtures are never changed or deleted.
- Exporters always write the newest format version.

## 9. Not covered

- **Automatic backups to a folder** (File System Access API, desktop Chromium; [architecture §8](../architecture.md#8-backups)). Encrypting with nobody present means keeping a key on the device, but passphrases are never stored. This needs its own design and ADR, for example encrypting to an age public key whose private key the user keeps elsewhere, or to a passkey, both of which `age-encryption` supports.
- Attachments, which need a new format version.
