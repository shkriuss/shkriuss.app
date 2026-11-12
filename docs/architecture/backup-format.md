# Backup file format

The exact bytes of a backup file, what an app puts into it, and how a
backup is written, checked and restored.

- Status: built. The design was written on 2026-11-12 in Phase 1, step 5
  ([PROMPTS.md](../development/PROMPTS.md)). The owner read it on the
  same day, added one point and accepted the rest
  ([Decided by the owner](#decided-by-the-owner)). The code and its
  tests were built from this page on the same day, in the same pull
  request.
- Not built yet: the screens (step 2.5), and the backup of a real app.
  The first is Water (step 2.1).
- The code is `android/core/backup`. It must follow this page exactly.
  If this page is wrong or unclear, the fix is a change to this page
  first, agreed with the owner.
- Decision: [ADR 0008](../adr/0008-backup-file-format.md). The encryption
  is in [crypto-design.md](../security/crypto-design.md#kind-3-backup-stream).
  The record fields are in [data.md](data.md) and
  [ADR 0027](../adr/0027-record-fields-and-stamping.md).
- A change to any byte layout, tag, limit or order rule on this page is a
  format change: a new format version, readers for every older version,
  and a decision record ("Changing formats" in
  [CLAUDE.md](../../CLAUDE.md)).

The page ends with what the owner [decided](#decided-by-the-owner), every
[assumption](#assumptions) and every [open question](#open-questions).

## At a glance

| Part | Choice |
|---|---|
| Scope | One file per app. It holds that app's records and files. |
| Where | A place the user picks with the system file picker. No permission. |
| Start of the file | A public backup header: `SHKBAK`, a version byte, the key ID, the app name |
| Encryption | Everything after the header is one stream, blob kind 3 of crypto-design.md: AES-256-GCM-HKDF streaming, 1 MiB segments, keyset `backup` |
| What binds the header | The whole header is the associated data of the stream |
| Inside the stream | Entries: one Manifest, the Records, the Files, one End |
| A record | Its four fields, a type name and content in the app's own encoding |
| A file | Its stored ciphertext, byte for byte. Its key stays wrapped. |
| Check | A backup can be read and checked from a URI without changing anything |
| Restore | Nothing changes in the app until the whole file was checked |
| Restore rule | The newest edit wins, per record. It is code, not part of the file. |

## Rules

1. No cryptography of its own. The file is a public header and one stream
   that `core/crypto` makes. `core/backup` never calls Tink or
   `javax.crypto`.
2. The public header holds only what a reader needs before it can
   decrypt. Everything else is inside the stream.
3. A reader that meets a version, a tag or a value it does not know stops
   with a clear answer. It never guesses.
4. Nothing is used before it is checked. A restore changes nothing in the
   app until the whole stream has ended without an error and every rule of
   this page was checked.
5. A backup never holds the recovery key, a keyset, anything wrapped by a
   hardware key, or a change number.
6. A file key is in a backup only as a wrapped file key, exactly as it is
   in its row. Backup never opens a file key and never encrypts a file
   again.
7. A backup enters and leaves the app only through the system file
   picker. The code takes `content:` URIs only.
8. No user content in a log, an error message or a `toString`.

## Words used on this page

- **Backup header.** The public bytes at the start of the file.
- **Stream.** The encrypted part: blob kind 3 of crypto-design.md.
- **Body.** The plaintext inside the stream.
- **Entry.** One part of the body: a tag byte and its fields.
- **Data version.** An app's own number for what its records and files
  mean inside a backup.
- **Document.** The file the user picked, named by a `content:` URI.
- **App name**, **key ID**, **recovery key**, **wrapped file key**,
  **file stream**: as in crypto-design.md.

## The file

Numbers that take more than one byte are big-endian. Offsets start at 0.

```text
+------------------------+
| Backup header          |  public, 12 + L bytes
+------------------------+
| 53 48 4B 01 03         |  header of blob kind 3
| Tink stream            |  the body, encrypted in 1 MiB segments
+------------------------+
```

There is nothing after the stream. A backup is one file and has no parts
outside it.

### The backup header

| Offset | Size | Content |
|---|---|---|
| 0 | 6 | `53 48 4B 42 41 4B`, the ASCII letters `SHKBAK` |
| 6 | 1 | Format version. Today `01`. |
| 7 | 4 | Key ID of the recovery key whose `backup` key encrypted this file |
| 11 | 1 | L, the length of the app name, 1 to 32 |
| 12 | L | App name, ASCII letters `a` to `z` |

- The header is 12 + L bytes long. For `water` it is 17 bytes.
- The magic and the place of the version byte never change. Every later
  version starts with the same seven bytes, with a higher version.
- The key ID is the one in
  [crypto-design.md](../security/crypto-design.md#the-recovery-key-and-its-key-id).
  It is public. It lets the app say "this backup needs another recovery
  key" before it decrypts.
- The app name lets the app say "this is a backup of another app" before
  it tries its keys. Every app has its own backup key, so a backup of
  another app could never open.
- Nothing else is in the clear: no date, no counts, no version of the
  app. They are inside the stream, where they are checked before they are
  shown.

### The stream

Blob kind 3, exactly as
[crypto-design.md](../security/crypto-design.md#kind-3-backup-stream)
defines it. It starts right after the backup header.

| Offset in the file | Size | Content |
|---|---|---|
| 12 + L | 5 | `53 48 4B 01 03` |
| 17 + L | 1 | `28`, Tink's stream header length, 40 |
| 18 + L | 32 | Salt |
| 50 + L | 7 | Nonce prefix |
| 57 + L | ... | Segments |

- Keyset: `backup`, derived from the recovery key for this app.
- Associated data: `53 48 4B 01 03`, then the whole backup header, byte
  for byte. So a stream opens only under the header it was made with.
- The first segment holds up to 1,048,520 bytes of the body. Every later
  one holds up to 1,048,560. Each segment ends with a 16-byte tag.
- `core/crypto` writes and reads these bytes. `core/backup` gives it the
  backup header and gets a stream to write the body to, or to read it
  from.

## The body

The body is a row of entries. Each entry starts with a tag byte. The
fields of an entry follow in a fixed order, with no padding.

| Tag | Entry | How many | Where |
|---|---|---|---|
| `01` | Manifest | Exactly one | First |
| `02` | Record | Any number, also none | After the Manifest |
| `03` | File | Any number, also none | After the last Record |
| `04` | End | Exactly one | Last |

The body ends right after the End entry.

### Manifest

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | `01` |
| 1 | 4 | Data version, 1 to 2,147,483,647 |
| 5 | 8 | When the backup was made: milliseconds since 1970-01-01 00:00 UTC |

13 bytes.

### Record

T is the length of the type name. N is the length of the content.

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | `02` |
| 1 | 1 | T, 1 to 64 |
| 2 | T | Type name: ASCII `a` to `z`, `0` to `9` and `_` |
| 2 + T | 16 | Record ID |
| 18 + T | 8 | `createdAt` |
| 26 + T | 8 | `updatedAt` |
| 34 + T | 1 | `00` if the record is not deleted, `01` if it is |
| 35 + T | 8 | `deletedAt`. Only there when the byte before is `01`. |
| next | 4 | N, 0 to 16,777,216 |
| next | N | Content |

- 39 + T + N bytes, and 8 more for a deleted record.
- The four record fields are the ones every stored record has
  ([data.md](data.md)). Times are milliseconds since 1970-01-01 00:00
  UTC, as signed 64-bit numbers.
- An ID is the 16 bytes of the UUID, in the order of its 32 hex digits,
  as in
  [crypto-design.md](../security/crypto-design.md#associated-data). A
  writer takes only the 36-character form. A reader gives the ID back in
  that form, in lower case.
- The type name says which kind of record this is, for example one name
  per table. The app chooses its names. A name never changes its meaning.
- The content is the rest of the record, in the app's own encoding. The
  container does not look inside.
- The change number is never written
  ([ADR 0027](../adr/0027-record-fields-and-stamping.md)).

### File

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | `03` |
| 1 | 16 | File ID |
| 17 | 8 | N, the length of the file stream, 0 to 2^63 - 1 |
| 25 | N | The file stream |

- 25 + N bytes.
- The file ID is the `id` of the file's record
  ([crypto-design.md](../security/crypto-design.md#file-keys)).
- The file stream is the stored file, byte for byte: blob kind 2, already
  encrypted with the file's own key. The container does not look inside.
- The file's key is not here. It is in the file's record, as a wrapped
  file key inside the content.
- So a file is encrypted twice in a backup: by its own key, and by the
  backup stream around it. The outer stream hides how many files there
  are and how long each is, and makes the backup one whole.

### End

| Offset | Size | Content |
|---|---|---|
| 0 | 1 | `04` |
| 1 | 8 | The number of Record entries in this body |
| 9 | 8 | The number of File entries in this body |

17 bytes.

Why it exists: the stream alone cannot tell a whole backup from one whose
writer stopped half way and still closed the stream. Such a file would be
a valid stream with fewer entries. With End and its counts, it does not
pass.

### What a reader refuses in the body

Each of these is "damaged or changed":

1. A first entry that is not a Manifest, or a second Manifest.
2. A tag other than `01` to `04`.
3. A Record after a File. Any entry after End. Any byte after End.
4. A body that ends before End, or in the middle of an entry.
5. A data version of 0 or above 2,147,483,647.
6. A type name of length 0 or above 64, or with another character.
7. A deleted byte other than `00` or `01`.
8. A content length above 16,777,216. A file length above 2^63 - 1.
9. Counts in End that are not the numbers of entries read.

The reader does not check that IDs are different from each other, or that
a file has a record. That is for the app.

### Sizes

For a body of P bytes, the file is:

```text
12 + L + 5 + 40 + P + 16 for each segment
```

There is one segment if P is at most 1,048,520. Each further 1,048,560
bytes, or part of them, add one more.

```text
P = 13 + every Record entry + every File entry + 17
```

The smallest backup, for `water` with no records and no files, is 108
bytes: a header of 17, then 5 + 40, a body of 30 and one tag of 16.

## What an app puts in

Each data app gives `core/backup` its records and files through one
interface ([The interface](#the-interface-each-app-implements)). The rules
for every app:

1. Every record of every record table, each one once. Deleted records
   too: they are the deletion markers, and a restore needs them.
2. For each record: its type name, its four fields and its content.
3. A file's record holds the wrapped file key in its content, exactly as
   it is in the row.
4. Each file whose stored stream is on this device, once, under the `id`
   of its record.
5. A file whose stream is not on the device is left out. Its record
   still goes in. Leaving a file out is never silent: the app tells the
   backup how many files it left out
   ([Files that are left out](#files-that-are-left-out)).
6. Records and files are listed as one snapshot: every file is the
   content that its listed record describes.
7. Records first, then files.

Never in a backup:

1. The recovery key, any keyset, anything wrapped by a hardware key.
2. Change numbers and the change counter. They are local to one database.
3. Anything that is not a record or a file: settings in DataStore,
   caches, logs. A setting that must come back with a restore is stored
   as a record.
4. A file key that is still sealed by the random key an app has before
   its recovery key. `core/crypto` refuses a backup until that move is
   done
   ([crypto-design.md](../security/crypto-design.md#the-file-key-keyset-without-a-recovery-key)).

Which tables, type names and contents one app has is part of that app's
own pages. The first is Water (step 2.1 in
[PROMPTS.md](../development/PROMPTS.md)).

### The data version

1. Each app has its own data version. It starts at 1 and only goes up.
2. The app raises it whenever an older version of the app could not use
   what a newer one writes into a backup:
   - a new record type, or a changed content of one,
   - a newer layout version of the file stream (kind 2) or of the wrapped
     file key (kind 4) inside.
3. A reader refuses a backup whose data version is higher than its own:
   "made by a newer version of the app".
4. An app keeps a reader for every older data version it ever wrote.

## Writing a backup

1. Ask `core/crypto` whether a backup may be made. It may when the app
   has its keys from a recovery key and no file key is still sealed by
   the old random key. If not, the answer is "not ready", and nothing is
   written.
2. Take the key ID of the current recovery key. If the `backup` keyset
   cannot be used now, the answer is "needs keys this app does not have
   now", and nothing is written. If the keys stop being usable in the
   moment after that, the answer is the same, and the app removes the
   document it had just opened.
3. Open the document for writing so that old content is cut off. Write
   the backup header.
4. Open the stream with the backup header as its context.
5. Write the Manifest: the app's data version, and now.
6. The app lists its records, then its files. Each becomes one entry.
   The app also says how many files it left out.
7. Write End with the two counts. Close the stream. Closing writes the
   last segment.

A backup that was written gives back three numbers: the records in it,
the files in it, and the files that were left out.

If anything fails on the way, the backup is not made. The app tries to
delete the document. If it cannot, a half-written file stays. It has no
End, so it never passes a check or a restore.

Mistakes of the calling code stop the backup at once: a record after a
file, an ID that is not a UUID, a type name or a content outside the
limits, a file whose bytes are not as many as the length given for it,
a number of files left out that is below 0, and a data version below 1.

### Files that are left out

An app can know of a file whose stream is not on this device, for
example a file that sync has listed and not yet fetched. Such a file
cannot be in a backup made here.

1. The file's record goes into the backup. The file's stream does not.
2. The app tells the backup how many files it left out. It may say so
   once, or several times while it lists. The numbers are added up.
3. The result of writing the backup carries that number. So a screen can
   say "N files are not on this device and are not in this backup".
4. The number is not written into the file. This is not a format
   change. A check or a restore of the file later cannot give it.
5. After a restore, the app has the record of such a file and no stream
   for it, as the device that made the backup had.

## Checking a backup

A backup can be checked without restoring it. The check reads a document
and does everything a restore does before it changes the app:

1. It reads the backup header and gives the same answers.
2. It decrypts the whole stream, to its end.
3. It checks every rule of the body, and the data version.
4. It stores nothing, changes nothing and never calls the app's code.

A good backup gives back its data version, when it was made, and how many
records and files it holds. A bad one gives the same answer a restore
would give.

Why: a backup that cannot be restored must be found on the day it is
made, not on the day it is needed. The app can read back the file it has
just written. The check also lets a screen say what a file holds before
the user restores it. When a screen calls the check is decided with the
screens (step 2.5).

What the check cannot know:

- Whether the document will still be there later.
- Whether the app's own code can take every record. That is what the
  tests of each app are for.
- How many files were left out when the backup was made. The file does
  not say it ([Files that are left out](#files-that-are-left-out)).

## Restoring a backup

A restore has two halves. The first only reads and checks. The second
changes the app.

### Reading and checking

In this order. The first rule that does not hold gives the answer.

1. Read 6 bytes. Fewer, or other bytes than `SHKBAK`: "not a backup of
   ours".
2. Read the version byte. `00`, or no byte: "damaged or changed". Higher
   than this reader knows: "made by a newer version of the app". The
   reader then stops and reads nothing more.
3. Read the rest of the header. A file that ends inside it, a length L
   outside 1 to 32, or a name with another character: "damaged or
   changed".
4. The app name is not this app's: "backup of another app". The answer
   names the app.
5. The `backup` keyset cannot be opened now: "needs keys this app does
   not have now". The key ID is not in the keyset: "needs another
   recovery key". The answer names the key ID.
6. Open the stream with the backup header as its context. Read every
   entry and check every rule of the body. Records and file streams go
   into staging, not into the app.
7. The data version is higher than the app's: "made by a newer version
   of the app".
8. The stream has ended without an error, right after End, and the
   counts are right. Only now is the backup good.

How the answers of `core/crypto` are taken, in steps 6 to 8:

- "Made by a newer version of the app", for the version byte of the
  stream, stays that answer.
- "Needs keys this app does not have now" stays that answer. It can
  still come here, for example when the phone was locked in between.
- Every other answer of `core/crypto` is "damaged or changed". After a
  good backup header, a stream that is not a backup stream is a damaged
  file.

### The answers

A check and a restore answer with one of these, and nothing more
detailed. They are the answers of
[crypto-design.md](../security/crypto-design.md#reading-a-blob), with one
more for the app name.

| Answer | When |
|---|---|
| Not a backup of ours | The file does not start with `SHKBAK` |
| Made by a newer version of the app | A higher format version, a higher version of the stream, or a higher data version |
| Backup of another app | The app name is not this app's. Names the app. |
| Needs another recovery key | The key ID is not in the `backup` keyset. Names the key ID. |
| Needs keys this app does not have now | The app has no `backup` keyset yet, or cannot use it now |
| Damaged or changed | Everything else that a reader refuses |

Writing a backup has two answers of its own: "not ready" and "needs keys
this app does not have now".

Three things are failures, not answers about the file. They stay apart
from the answers and from each other:

1. A read or a write of the document that fails. It stays the failure it
   was, as in crypto-design.md. It is not turned into "damaged or
   changed".
2. Staging that cannot be written, for example because the phone has no
   room.
3. The app's own code that fails while it takes the records.

No answer and no failure holds a record's content, a file's bytes or a
key.

The key ID in the header is a name, not a proof. If another recovery key
has the same four bytes, the backup header passes step 5 and the first
segment does not open: "damaged or changed".

### Staging

A restore must not change the app before the last byte was checked, and
a backup can be larger than memory. So what is read is first put aside.

1. The app gives `core/backup` one staging folder inside its private
   storage. It is not the cache folder, which Android may empty at any
   time. Proposed: `shk-restore/` in the app's no-backup files folder,
   next to `shk-keys/`.
2. Each restore gets a folder of its own inside it.
3. Records go into one file there. Each file stream goes into a file of
   its own, as it is: still encrypted with the file's key. A third file
   lists the file streams, with their IDs and lengths.
4. Staged records are plaintext, like the database rows they come from
   and go to. They have the protection the database has: the app's
   private storage and Android's file-based encryption
   ([ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)).
5. Before the app is called, the staged files are flushed to storage.
6. The folder is deleted when the restore ends, well or badly.
7. At app start, one call deletes whatever a stop left in the staging
   folder.

The staged record file is not part of the backup format. It never leaves
the app.

### Changing the app

Only after "Reading and checking" has passed, `core/backup` calls the
app's code once and hands it the checked backup: the data version, when
it was made, the counts, every record, and every staged file.

1. The app writes the records in one database transaction, through
   `RecordWriter`. If anything fails, the transaction rolls back and no
   record has changed.
2. After the transaction, the app moves the staged files it needs into
   its own file store. A move is a rename. Nothing is copied.
3. An app with no files stops after step 1.

The database and the file store cannot change in one step. So the order
is fixed, and a restore can always be done again:

- A stop after step 1 and before the end of step 2 leaves records whose
  files are not there yet. Restoring the same backup again brings the
  files: see "same" below.

## The restore rule

This section is about code. It is **not part of the file format**. It
can change, and a second rule can be added, without a new format
version.

The owner decided the rule in the planning session of this step: **the
newest edit wins, per record.**

For each record of the backup, `RecordWriter.takeFromBackup` gives one of
three answers:

| Answer | When | What is written |
|---|---|---|
| Taken | No record with this ID is stored, or the stored one has an older `updatedAt` | The record of the backup, with its four fields as they are and a new change number |
| Same | The stored record has the same `updatedAt` | Nothing |
| Stored is newer | The stored record has a later `updatedAt` | Nothing |

1. A record keeps its own `id`, `createdAt`, `updatedAt` and `deletedAt`.
   Only the change number is new, and only when something is written.
2. A deleted record is a record like any other. If the stored record was
   deleted after the backup, it stays deleted. If the backup's deletion
   is newer, the record becomes deleted.
3. Records that are stored and not in the backup are left as they are.
4. Restoring the same backup twice changes nothing the second time.
5. A file's stream is moved in when its record was "taken". It is also
   moved in when the answer is "same" and the app has no stream for that
   file. It is never moved in when the stored record is newer: that
   record holds another file key, which cannot open the backup's stream.

What this rule cannot do, said plainly:

- **A restore cannot undo a deletion or an edit made after the backup.**
  The later change is the newer edit, so it wins. A deleted record is
  still stored, as its deletion marker, and `RecordWriter.restore` can
  bring it back. Whether an app offers that on a screen is for that app.
- Into an app with no data, for example on a new phone, a restore gives
  exactly what the backup holds.

The file does not block another rule. It is a full list of the app's
records at one moment, each with its four fields and its content, and it
says when it was made. End proves the list is whole. A "restore as it
was" mode would need only code: write every record of the backup as a new
edit, and mark as deleted every stored record the backup does not list.
No field is missing for that. Whether to build it is an
[open question](#open-questions).

For sync, later:

- "Same keeps the stored record" is right for a restore, which touches
  one device. In sync it would let two devices keep different records
  with the same `updatedAt`. Phase 5 must decide ties so that all devices
  end the same ([ADR 0009](../adr/0009-sync-protocol-and-server.md)).
- `takeFromBackup` is the function for backups. It is not assumed to be
  the function sync uses. ADR 0027 gives sync its own.

## The interface each app implements

| What | Who writes it | What it does |
|---|---|---|
| `BackupContent` | Each app, once | `dataVersion`: the app's data version. `list(into)`: lists every record and then every file into a `BackupSink`, and says how many files it left out. `restore(from)`: takes a `CheckedBackup` into the app. |
| `BackupSink` | `core/backup` | Where an app lists: `record(...)`, `file(id, length, content)` and `filesLeftOut(count)` |
| `BackupRecord` | `core/backup` | One record on its way: type name, the four fields (`RecordFields` of `core/data`), content |
| `CheckedBackup`, `CheckedFile` | `core/backup` | A backup that passed every check, as the app gets it: its data version, when it was made, the counts, every record, and every file. A file can be opened or moved into the app's file store. |
| `Backups` | `core/backup` | Made with the app's `BackupContent`, its `BackupCrypto`, its app name, its staging folder and a clock. `export(to)` writes a backup to a URI and says how many records, files and left-out files there were. `check(from)` checks one. `restore(from)` restores one. `start()` empties the staging folder at app start. |
| `ExportResult`, `CheckResult`, `RestoreResult`, `BackupAnswer` | `core/backup` | What the three functions give back: a result, or one of the answers of this page |
| `BackupDocuments` | `core/backup` | The two intents for the system file picker, the result of the picker, and the suggested file name |
| `RecordWriter.takeFromBackup` | `core/data` | The only way a record of a backup is written ([ADR 0027](../adr/0027-record-fields-and-stamping.md), point 8). It answers with a `BackupTake`. |

1. An app's code is called for a restore only with a backup that passed
   every check.
2. `core` never depends on a feature. So `core/backup` knows no table and
   no record type of any app.
3. No screen is part of this step. The screens come with the first app
   (step 2.5).

## The system file picker

1. To make a backup, the app opens Android's "create document" screen
   (`ACTION_CREATE_DOCUMENT`) for a file that can be opened, with the
   type `application/octet-stream` and a suggested name.
2. The suggested name is the app name, the date on the phone and the
   ending `.shkbackup`, for example `water-2026-11-12.shkbackup`. The
   user may change it. A reader never looks at the name.
3. To check or restore one, the app opens Android's "open document"
   screen (`ACTION_OPEN_DOCUMENT`) for any file that can be opened. Any
   type is offered, because storage apps name the type of an unknown
   ending differently. The magic decides.
4. Both screens give back a `content:` URI. The code refuses every other
   kind of URI.
5. The document is opened for writing in the mode that cuts off old
   content (`wt`). Without it, writing over a longer file could leave its
   old end in place.
6. The app asks for no storage permission and keeps no lasting permission
   for the document. One pick is for one backup, one check or one
   restore.

## What a changed or cut file does

| What happened to the file | What the reader says |
|---|---|
| Cut anywhere, also exactly between two segments | Damaged or changed. No segment says "last". |
| Bytes added at the end | Damaged or changed. The last segment's tag fails. |
| One byte changed in the magic | Not a backup of ours |
| The version byte changed | Made by a newer version, or damaged or changed |
| One byte changed in the key ID | Needs another recovery key. If the changed ID is one the app has: damaged or changed. |
| One byte changed in the app name or its length | Backup of another app, or damaged or changed |
| One byte changed anywhere in the stream | Damaged or changed, at that segment |
| Segments swapped, repeated or dropped | Damaged or changed |
| The header of one backup put on the stream of another | Damaged or changed. The header is the stream's associated data. |
| The writer stopped half way | Damaged or changed. There is no End. |

In every row, the app is not changed.

What the format does not protect:

- The app name, the key ID and the format version are public.
- The length of the file shows roughly how much data the app holds. How
  many records and files there are, and how long each is, is hidden.
- A file name with the app and the date says both, unless the user
  changes it.
- An older backup of the same app is a good backup. The file cannot say
  whether a newer one exists.

## Changing the format

1. The format version is one byte. It covers the backup header after the
   version byte and the whole body: tags, fields, limits and order.
2. A change to any of them needs a new version and a decision record. A
   reader for every older version stays in the app.
3. A reader that meets a higher version stops: "made by a newer version
   of the app".
4. The stream has its own version, the version byte of blob kind 3. It
   changes only with crypto-design.md.
5. Each app has its own data version for what is inside records and
   files.
6. Not format changes: the restore rule, staging, the names in the code,
   the suggested file name and how the picker is opened.

## Example

The header and the body of one small backup, before encryption. All
values are hexadecimal unless marked.

```text
app name       water
key ID         b19d376f   (the recovery key of the vectors in
                           crypto-design.md)

backup header, 17 bytes
53484b42414b01b19d376f057761746572

associated data of the stream, 22 bytes
53484b010353484b42414b01b19d376f057761746572
```

The body has three records and one file. The type name is `example`.

```text
Manifest: data version 1, made on 2026-01-01 at 01:00:00.000 UTC
01000000010000019b77119680

Record: 00112233-4455-4677-8899-aabbccddeeff
        created 2026-01-01 00:00:00.000 UTC, updated 00:01:00.000,
        not deleted, content the ASCII text "backup record test"
02076578616d706c6500112233445546778899aabbccddeeff0000019b76daa8
000000019b76db926000000000126261636b7570207265636f72642074657374

Record: 0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff
        created and updated 2026-01-01 00:02:00.000 UTC, not deleted,
        content the ASCII text "file record test"
02076578616d706c650f1e2d3c4b5a49788695a4b3c2d1e0ff0000019b76dc7c
c00000019b76dc7cc0000000001066696c65207265636f72642074657374

Record: fedcba98-7654-4321-8fed-cba987654321
        created 2026-01-01 00:00:00.000 UTC, updated and deleted
        00:03:00.000, no content
02076578616d706c65fedcba98765443218fedcba9876543210000019b76daa8
000000019b76dd6720010000019b76dd672000000000

File: 0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff, 77 bytes: the file stream
      "file stream test" of the vectors in crypto-design.md
030f1e2d3c4b5a49788695a4b3c2d1e0ff000000000000004d53484b01022860
6162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f10
1112131415169a858c7fe385e11df99795433c2849a9996fb194fa42f3870561
2211e018459a

End: 3 records, 1 file
0400000000000000030000000000000001
```

The body is 312 bytes. The file is 390 bytes: 17 + 5 + 40 + 312 + 16.

The whole file, encrypted. Tink cannot be told which salt and nonce
prefix to use, so this file is a test for reading. Writing is tested by
round trips.

```text
backup key     the backup key for water, from the vectors in
               crypto-design.md
salt           505152535455565758595a5b5c5d5e5f
               606162636465666768696a6b6c6d6e6f
nonce prefix   f0f1f2f3f4f5f6

file, 390 bytes
53484b42414b01b19d376f05776174657253484b010328505152535455565758
595a5b5c5d5e5f606162636465666768696a6b6c6d6e6ff0f1f2f3f4f5f654bf
5afdd024a27da06faf28e79405d2d1f5e525868e2b70286a5e7254ec1d435d10
bac2edf4e76756382f3ad3cee77a933c3899a20b996ee737ad101333fe825b61
e6dc37ca14b88d0e8f7cf7f904652d82e223b8facd0d855e71b0f2418c453041
5e32c2d65b27a3e44cd6f7429b2f3a2e681ddac04cc80bcff9de0f170d382af6
152f94342eddae83e6a8aa5cccbf8628c6e44fb670400e91100fa706d75097dc
4dadcdbcf95ba25f735fb39515cd8a1bd7cffdf331b729b27eb65f03171ef7c1
15e348425c6ae05c4c8314e59e8e339ef5c152a5fd0238a4f11bc5ad7bc9d3e8
6b20c0e961128d775dc4395bbee7001cda7f075a04b386dffd9099976b23247e
14d19c5565ebff33f0440bf5c46fefeb054829bafcb68f68ddbc3d8e7610a8d3
0d3c96c510af78397016a35b216e7e2873b07f44070eac5f118c3d1c2e9b89dc
899b22808e26
```

How it was made, and how it is checked:

1. `BackupExampleFileTest` in `core/crypto` builds the stream from the
   values above with a second, separate build of the stream layout, from
   HMAC and AES-GCM alone (`ReferenceStream`, the code behind the
   vectors of crypto-design.md). The result must be these bytes. Tink
   must open them and give back the body above.
2. `ExampleFileTest` in `core/backup` reads the same bytes as a backup,
   in an app with the recovery words of the vectors. It must be a good
   backup with three records and one file, and a restore must give
   exactly the records and the file stream described above.
3. No tool outside the Gradle build made any of these bytes.

## What the tests must cover

Unit tests in `core/backup`, on the JVM, with real keys and a fake app.

1. Round trip: an empty app; records only, one of them deleted and one
   with no content; records and files, with an empty file, a small one
   and one of three segments. Restoring twice changes nothing.
2. A file cut short: every shorter length of a small backup; a longer
   one cut in the header, at the end of a segment, 17 bytes and 1 byte
   before its end.
3. One changed byte: every byte of a small backup, one at a time. The
   answer of each part of the file is the one in the table above. One
   byte added at the end.
4. A wrong recovery key: the answer names the key ID. An app with no
   keys. A key ID in the header changed to one the app has.
5. A newer version: a higher format version, a higher version of the
   stream, a higher data version. An older data version reaches the
   app's code.
6. A very large file that is never held in memory. See below.
7. Every rule of "What a reader refuses in the body", through real
   encryption.
8. The check gives, for every file of items 2 to 7, the answer a restore
   gives, and leaves the app and the staging folder as they were.
9. Nothing changes on any failure: the app is as before and the staging
   folder is empty. A backup whose writing failed never restores. The
   call at app start empties what was left.
10. URIs and the picker: a backup written to and read from a document
    through Android's content resolver; writing over a longer old file
    leaves nothing of it; another kind of URI is refused; the two
    intents.
11. The example of this page opens with the real code.
12. A backup is refused before the app has a recovery key. No
    `toString` shows content.
13. Files that are left out: the result of writing carries their number,
    their records are in the backup, and their streams are not.

In `core/data`: `takeFromBackup` gives each of its three answers, keeps
the four fields, takes a change number only when it writes, and several
calls in one transaction roll back together.

The very large file. The first plan was one file longer than all the
memory the test may use, 2 GiB, restored through staging. That needs a
little over 2 GiB of disk in every run. The check needs no disk, so the
proof is split in three, and all are cheap (`LargeFileTest`):

1. A file longer than all the memory of the test, a little over 2 GiB,
   goes into a backup and through the check. A writer and a reader run
   at the same time, joined by a pipe that holds a few megabytes at
   most. Nothing is stored. Neither the writer nor the reader can have
   held the file.
2. While a backup with a file of 64 MiB is written, the test watches how
   far the bytes taken from the file run ahead of the bytes written to
   the document. The gap never passes 4 MiB.
3. While that backup is restored, the test watches how far the bytes
   read from the document run ahead of the bytes put into staging. The
   gap never passes 4 MiB.

Measured on 2026-11-12 in the cloud environment: the first takes about 3
seconds and needs no disk. The other two together take under 1 second,
and the third needs 64 MiB in a temporary folder for that time. All 68
tests of `core/backup` together take about 11 seconds. The time
in CI is added here from its first run.

No test in this step runs on an emulator, and none opens the picker
itself. The picker is checked by hand with the first app.

## Decided by the owner

In the planning session of this step and after reading this page, on
2026-11-12.

| Question | Decision |
|---|---|
| A file that is left out because its stream is not on the device | It must not be silent. The app tells the backup how many files it left out, and the result of writing a backup carries that number. No change to the file format. |
| The other choices under "Assumptions" | Accepted as they are. |
| A record that is in the app and in the backup | The newest edit wins, by `updatedAt`. The same `updatedAt` keeps the stored record. |
| What the user is told | The user guide says plainly that a restore cannot undo a deletion or an edit made after the backup. |
| The restore rule and the format | The format stays free of the rule, so that a "restore as it was" mode can be added later without a new format version. |
| Checking a backup after it is written | Built in this step: one function that reads a backup from a URI, checks everything a restore checks, and changes nothing. The screen of step 2.5 decides when to call it. |
| Ties in sync | Not decided here. Phase 5 must decide ties so that all devices end the same. `takeFromBackup` is not assumed to be sync's function. |
| The very large file test | If it takes more than about a minute in CI, a cheaper proof is used. |
| When code starts | After the owner has read this page and ADR 0008. The owner gave the OK on 2026-11-12. |

## Assumptions

Things this page chose without a decision by the owner on that point.
The owner read them on 2026-11-12 and accepted them as they are. A later
reader may still object to each one.

1. The magic is `SHKBAK` and the format version is one byte.
2. The app name is in the public header.
3. The date and the counts are not in the public header.
4. The four record fields are in the container. The content is the
   app's own encoding, with the app's own data version.
5. Type names hold `a` to `z`, `0` to `9` and `_`, and are at most 64
   bytes. An app name in a backup is at most 32 letters.
6. The content of one record is at most 16 MiB. Records are small. Files
   are not records.
7. A backup holds records and files only. A setting that must come back
   is a record.
8. A file whose stream is not on the device is left out of a backup.
   The owner added that this is never silent
   ([Files that are left out](#files-that-are-left-out)).
9. A backup is of one app. There is no file for the whole suite.
10. No compression.
11. The staging folder is `shk-restore/` in the app's no-backup files
    folder. It is on the same file system as the app's file store, so a
    move is a rename. Staged records are plaintext there.
12. The suggested name is `<app>-<date>.shkbackup`, the type is
    `application/octet-stream`, and the open screen offers every type.
13. When writing fails, the app tries to delete the document.
14. A check or a restore reads the document once, from start to end.
15. A restore writes records first and moves files after.
16. A reader does not check that IDs differ or that a file has a record.

## Open questions

What is left, with the step that decides it.

1. **A "restore as it was" mode.** It would bring back records that were
   deleted or changed after the backup. The format allows it. It needs a
   second `RecordWriter` function and a choice on the screen. Not built.
   The owner decides whether and when.
2. **When the app checks a backup.** After every backup, before every
   restore, or when the user asks. Step 2.5, with the screens.
3. **Progress, stopping in the middle, and a long backup while the
   screen is off.** Keysets are dropped when the screen turns off, and a
   backup that is being written may finish
   ([crypto-design.md](../security/crypto-design.md#keys-in-memory)).
   What keeps the app running for a backup of many gigabytes is not
   decided. Step 2.5, and again with the first app that stores large
   files.
4. **One snapshot of records and files.** How an app with files makes
   sure that a file in a backup is the content its record describes,
   when a file can change while a backup runs. The first app that stores
   files.
5. **What Water puts in**, and its type names and contents. Step 2.1.
6. **Whether the content of a record is also the plaintext of a sealed
   record in sync.** One encoding for both would be less code. Phase 5.
7. **Ties in sync.** See [The restore rule](#the-restore-rule). Phase 5.
8. **Purged deletion markers and old backups.** If deletion markers are
   ever purged, an old backup holds a record whose marker is gone, and a
   restore would bring it back. When markers may be purged is for the
   sync design ([ADR 0009](../adr/0009-sync-protocol-and-server.md)).
   Phase 5 must look at backups too.
9. **A backup made with an older recovery key** opens while that key is
   still in the `backup` keyset. What happens to old backups when an old
   key is dropped belongs to the "new recovery key" flow
   ([crypto-design.md](../security/crypto-design.md#a-new-recovery-key)).
   Phase 5.
