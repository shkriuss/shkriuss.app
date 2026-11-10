# 0008 Backup file format

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decisions 3 and 12), 5 and 6

## Context

- Backup and restore to a file stays (decision 12).
- Backups are encrypted by the app (decision 3).
- Files enter and leave only through the system pickers. Apps have no
  storage permissions ([CLAUDE.md](../../CLAUDE.md)).

## Decision

1. A backup is one file, in a place the user picks with the system file
   picker.
2. The file has a versioned header, then streaming authenticated
   encryption.
3. Backup keys derive from the recovery key. See
   [0007](0007-recovery-key-instead-of-passwords.md).
4. The format carries a version number, a migration path and tests.
5. Changing the format needs a decision record and readers for every older
   version.

## Options rejected

None recorded.

## Consequences

- Backups need no storage permission.
- A format change bumps the format version, keeps readers for every older
  version, adds a decision record, and updates `docs/architecture/`
  ("Changing formats" in CLAUDE.md).
- Open: the byte layout of the header and the body, and what each app puts
  in the file. They come in `docs/architecture/backup-format.md` in
  Phase 1, step 5, which completes this record
  ([PROMPTS.md](../development/PROMPTS.md)).
