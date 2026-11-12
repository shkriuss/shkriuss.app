# 0008 Backup file format

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decisions 3 and 12), 5 and 6,
  and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4).
  Completed on 2026-11-12 in Phase 1, step 5
  ([PROMPTS.md](../development/PROMPTS.md)) with the owner's decisions in
  the planning session of that step and while it was built, for
  [pull request 25](https://github.com/shkriuss/shkriuss.app/pull/25).
  The detail is in
  [backup-format.md](../architecture/backup-format.md).

## Context

- Backup and restore to a file stays (decision 12).
- Backups are encrypted by the app (decision 3).
- Files enter and leave only through the system pickers. Apps have no
  storage permissions ([CLAUDE.md](../../CLAUDE.md)).
- [crypto-design.md](../security/crypto-design.md#kind-3-backup-stream)
  fixes the encrypted part of a backup: blob kind 3, a Tink stream under
  the `backup` keyset, with the whole backup header as associated data.
  It asks five things of this format:
  1. The backup header is not secret and is given to `core/crypto` byte
     for byte.
  2. It holds the key ID, so the app can say "wrong recovery key" before
     it decrypts.
  3. A backup never holds the recovery key, a keyset, or anything wrapped
     by a hardware key.
  4. A backup holds file keys only as wrapped file keys, exactly as they
     are in the rows.
  5. A restore changes nothing in the app until the whole stream has
     ended without an error.
- Every app has its own keys, derived from the recovery key for that app
  ([0006](0006-tink-and-key-hierarchy.md)). An app cannot open what
  another app encrypted.
- Every record has `id`, `createdAt`, `updatedAt` and `deletedAt`, and a
  local change number that never goes into a backup
  ([0027](0027-record-fields-and-stamping.md)). Only `RecordWriter` may
  write a record. 0027 promises the backup step a `RecordWriter` function
  of its own.
- A backup can be larger than the memory of the phone. Drive and Photos
  will hold large files.
- `core` never depends on a feature. So the code that writes a backup
  cannot know the tables of any app.
- A stream that is closed in the normal way is a valid stream, also when
  the code that wrote into it stopped half way.

## Decision

1. A backup is one file, in a place the user picks with the system file
   picker.
2. The file has a versioned header, then streaming authenticated
   encryption. The encryption is Tink's AES-GCM-HKDF streaming scheme. See
   [0006](0006-tink-and-key-hierarchy.md).
3. Backup keys derive from the recovery key. See
   [0007](0007-recovery-key-instead-of-passwords.md).
4. The format carries a version number, a migration path and tests.
5. Changing the format needs a decision record and readers for every older
   version.
6. A backup is of one app. It is encrypted with that app's `backup` key.
7. The file is a public backup header and, right after it, one stream of
   blob kind 3. Nothing else.
   - The header is `SHKBAK`, a format version byte, the key ID, and the
     app name.
   - The whole header is the associated data of the stream.
   - The header holds only what a reader needs before it can decrypt.
     The date, the counts and everything else are inside the stream.
8. Inside the stream is a row of entries: one Manifest, the Records, the
   Files, one End.
   - The Manifest holds the app's data version and when the backup was
     made.
   - End holds the number of records and of files. A backup with no End,
     or with other counts, is refused. So a backup that was written only
     half is never taken for a whole one.
9. A record is written with its four fields, a type name, and content in
   the app's own encoding. The change number is never written. Each app
   has a data version for its contents, which only goes up, and keeps a
   reader for every older one.
10. A file is written as its stored ciphertext, byte for byte. Backup
    never opens a file key and never encrypts a file's content again.
    The wrapped file key travels inside the file's record. A file whose
    stored ciphertext is not on the device is left out, and its record
    still goes in. That is never silent: the app says how many files it
    left out, and the result of writing a backup carries the number. The
    number is not in the file.
11. A backup holds records and files only. It never holds the recovery
    key, a keyset, anything wrapped by a hardware key, or a setting that
    is not a record.
12. A reader answers with one of six answers and never guesses: not a
    backup of ours, made by a newer version of the app, backup of another
    app, needs another recovery key, needs keys this app does not have
    now, damaged or changed.
13. A restore first reads and checks the whole file. What it reads is put
    aside in a staging folder in the app's private storage. Only when the
    stream has ended without an error and every rule holds does the app's
    own code get the records and files. Until then nothing in the app
    changes.
14. A backup can be checked without restoring it. One function reads a
    backup from a URI, checks everything a restore checks, and changes
    nothing. A backup that cannot be restored must be found on the day it
    is made. The screens decide when to call it.
15. The restore rule: the newest edit wins, per record, by `updatedAt`.
    If both are the same, the stored record stays. The record keeps its
    four fields and gets a new change number. `RecordWriter` gets the
    function `takeFromBackup` for this.
16. The restore rule is not part of the file format. The file is a full
    list of the app's records at one moment and says nothing about how
    it is merged. Another rule can be added later without a new format
    version.
17. A backup is written to and read from a `content:` URI that the system
    file picker gave. No other kind of URI is taken.
18. Each data app implements one interface: it says its data version,
    lists every record and file, and takes a checked backup. The shared
    code is `core/backup`.

The byte layouts, the limits, the order of every check and the rules for
apps are in [backup-format.md](../architecture/backup-format.md). The code
follows that page exactly.

## Options rejected

- **Sync instead of a backup file.** Sync is not a backup. A deletion or a
  damaged record spreads to every device. Apps must also work with no
  account.
- **A ZIP or tar file inside the stream.** Their readers accept many
  forms that this project does not need: paths, links, extra fields,
  several ways to say a length. Each is a place for a mistake. The body
  has four entry types with fixed fields.
- **One file for the whole suite.** Every app has its own keys and its
  own storage, and no app can read another's. A file for all apps would
  need an app that holds every key.
- **The date and the counts in the public header.** They would be shown
  before they are checked, and they tell a reader of the file more than
  it needs. Inside the stream they are checked first.
- **Files next to the stream, each as its own encrypted file.** The
  number of files and the length of each would show. And nothing would
  bind the set: a file could be left out or put back from an older
  backup.
- **Opening file keys to encrypt files again with the backup key.**
  crypto-design.md forbids it. A backup would then need the file-key
  keyset, which is behind the system prompt while the app lock is on.
- **A copy of the database file, or a dump of its tables.** It holds the
  change numbers and tables that are not records. It ties the backup to
  one schema version. It cannot be merged into an app that already holds
  data.
- **A password for the backup.** There are no passwords
  ([0007](0007-recovery-key-instead-of-passwords.md)).
- **Compression.** Not needed in version 1. Files are encrypted before
  they reach the backup, so they do not shrink.
- **The backup wins.** Every record of the backup would replace the
  stored one. It brings back what was deleted or changed later, and it
  also overwrites good newer edits. The owner chose "the newest edit
  wins".
- **Restore only into an empty app.** The simplest rule. The user would
  have to clear the app's data first. The owner chose "the newest edit
  wins".
- **A restore that writes while it reads.** One long database
  transaction, rolled back on a failure, would also change nothing on a
  bad file. But it blocks every other write for as long as a large
  backup takes to read, and it gives the app's code records that are not
  checked to the end yet.

## Consequences

- Backups need no storage permission.
- A format change bumps the format version, keeps readers for every older
  version, adds a decision record, and updates `docs/architecture/`
  ("Changing formats" in CLAUDE.md).
- A restore cannot undo a deletion or an edit that was made after the
  backup. The later change is the newer edit, so it wins. This is said
  plainly, because the first rejected option names exactly this as a
  reason for backups. The user guide must say it too. The file itself
  holds what a "restore as it was" mode would need. That mode needs code,
  not a new format version. Open: whether and when to build it.
- Into an app with no data, a restore gives exactly what the backup
  holds.
- Restoring the same backup twice changes nothing the second time.
- "The same `updatedAt` keeps the stored record" is right for a restore,
  which touches one device. In sync it would let two devices keep
  different records. Phase 5 must decide ties so that all devices end the
  same ([0009](0009-sync-protocol-and-server.md)). `takeFromBackup` is
  not assumed to be the function sync uses. Sync gets its own
  ([0027](0027-record-fields-and-stamping.md), point 8).
- A backup holds deletion markers. If markers are ever purged, an old
  backup can bring a deleted record back. Phase 5 decides when markers
  may be purged ([0009](0009-sync-protocol-and-server.md)) and must look
  at backups too.
- A file is encrypted twice in a backup: by its own key and by the
  stream around it. That costs time on a large backup. It hides the
  number and the lengths of the files.
- A restore needs free room for the whole backup in the app's private
  storage. Files are then moved, not copied.
- Staged records are plaintext in the app's private storage, like the
  database rows. The staging folder is emptied when a restore ends and at
  app start.
- A backup can be made only after the app has its keys from a recovery
  key, and can be opened only with that recovery key
  ([0007](0007-recovery-key-instead-of-passwords.md)). The user guide
  must say that nobody can open a backup without the recovery words.
- A setting that must come back with a restore has to be stored as a
  record.
- The database and the file store cannot change in one step. A restore
  writes the records first and moves the files after. If it stops in
  between, restoring the same backup again brings the files.
- `core/data` gets `RecordWriter.takeFromBackup`
  ([0027](0027-record-fields-and-stamping.md), point 8). `core/backup`
  depends on `core/crypto` and `core/data`.
- The tests of `core/backup` need real keys with no Android Keystore.
  They get them from the test fixtures of `core/crypto`
  ([0029](0029-test-fixtures-for-the-keystore-stand-in.md)).
- No screen is part of this step. The screens for backup and restore
  come with the first app (step 2.5 in
  [PROMPTS.md](../development/PROMPTS.md)). What Water puts into a backup
  is part of its specification (step 2.1).
- Open: the points listed under "Open questions" in
  [backup-format.md](../architecture/backup-format.md#open-questions).
  Those that touch this record are a "restore as it was" mode, when the
  app checks a backup, a long backup while the screen is off, the
  snapshot of records and files in an app with files, and ties and
  purged deletion markers in sync (Phase 5).
