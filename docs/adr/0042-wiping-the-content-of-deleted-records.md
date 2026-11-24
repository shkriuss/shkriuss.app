# 0042 Wiping the content of deleted records

- Status: Proposed
- Date: 2026-11-24
- Source: the specification of Notes
  ([spec.md](../apps/notes/spec.md#removing-a-file-and-the-wipe)). The
  owner decided that the text and the files of a deleted note are wiped
  when its **Undo** ends, with a new write in `core/data` for every app.
  Claude proposed the details.

## Context

- Deleting a record only marks it. The row stays, with its content, as
  its deletion marker ([data.md](../architecture/data.md#writing-records),
  points 3 and 5). A deleted record cannot be updated.
- Deletion markers are needed: the restore rule compares them with the
  records of a backup, and sync will send them. When a marker may be
  purged is for the sync design ([0009](0009-sync-protocol-and-server.md)).
- So the content of a deleted record stays on the phone, and in every
  later backup, for good. Tasks keeps the titles of deleted tasks this
  way ([its spec](../apps/tasks/spec.md#open), point 2).
- Notes holds long private text and files. Someone who deletes a note
  expects it to be gone.
- [0027](0027-record-fields-and-stamping.md), point 8, gives restore and
  sync writes of their own in `RecordWriter`, and no direct writes.

## Decision

1. `RecordWriter` gets one more write, `wipe(id) { current -> wiped }`.
   It acts only on a record that is deleted. The app's function returns
   the record with its content in the table's wiped form. It returns
   null for a record that is not stored, not deleted, or already wiped.
2. A wipe keeps all four record fields as they are, `updatedAt` too, and
   gives the record a new change number. A wipe is not an edit: it must
   not change which edit wins in a restore, or later in sync.
3. Each table that is wiped has a **wiped form**: the value of every
   content column after a wipe. Its spec names it. A record that is not
   deleted is never in that form. A restore refuses a record that is not
   deleted and in the wiped form, and a deleted one that is partly wiped.
4. A wiped record is never brought back with `restore`. **Undo** is for
   the time before the wipe.
5. A file's wrapped key is content, so a wipe clears it. The app removes
   the file's stream after the wipe commits. Without the key, any copy of
   the stream that the flash storage keeps can never be opened.
6. An app that wipes opens its database with SQLite's `secure_delete` on,
   and after a wipe checkpoints the write-ahead file and cuts it to zero.
   So the cleared bytes are written over in both files.
7. Each app decides whether and when it wipes. Notes is the first: when
   the **Undo** of a delete ends, at every start, before a backup lists
   its records, and after a restore.

## Options rejected

- **Keep the content until a purge**, as Tasks does. The owner rejected
  it for Notes: deleted private text and files would stay on the phone
  and in every later backup.
- **Purge the row.** A purge removes the marker. A restore of an older
  backup would then bring the note back, and sync needs the markers.
  When markers may be purged is for the sync design.
- **Clear the content with `update` before `markDeleted`.** Two edits
  that move `updatedAt`. **Undo** could not bring the text back, and the
  clearing would count as an edit by the user.
- **A trash for 30 days.** The owner chose **Undo**.

## Consequences

- [data.md](../architecture/data.md) gets the write and its rules when it
  is built, with tests in `RecordWriterTest`. `checkDaoRules` needs no
  change: the write goes through `rawUpdate` in `RecordWriter`.
- The wiped form is part of each app's backup content. A change of it
  raises the app's data version.
- What a wipe cannot do: a backup made before it still holds the
  content, and the phone's flash storage may keep old blocks, under
  Android's file-based encryption. The user guide of each app that wipes
  says so.
- The sync design must carry wipes, and end a wiped and an unwiped
  marker with the same `updatedAt` as wiped on every device.
- Tasks and later apps may use the wipe. Each decides in its own spec.
- [threat-model.md](../security/threat-model.md) and
  [data-inventory.md](../security/data-inventory.md) say what a wipe
  removes once Notes is built.
