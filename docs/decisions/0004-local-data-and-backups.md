# ADR 0004: Local data model and encrypted backups

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Local-first apps need durable data whose format can evolve. Backups are the only copy of the data off the device and the only way to move it between devices, so importing must merge rather than overwrite. Future sync must remain possible without rewriting the apps.

## Decision

### Storage

- IndexedDB through Dexie, wrapped by `@shkriuss/data`, which is the only way apps reach storage.

### Records

- a permanent UUIDv7 id;
- a schema version;
- a hybrid-logical-clock (HLC) timestamp for every field;
- a tombstone flag for deletions; tombstones are kept indefinitely;
- a random device id per installation (per origin), used to break ties.

### Merge

- Field-level last-writer-wins by HLC, with ties broken by device id.
- A tombstone and later edits are compared by HLC like any other change.
- The merge must be deterministic, commutative, associative and idempotent, which property-based tests verify.

### Migrations

- Versioned and forward-only.
- They run inside the IndexedDB upgrade transaction, so they apply completely or not at all.
- Test fixtures from every schema version ever shipped stay in the repository forever.

### Backups

- A versioned JSON envelope: format id, format version, app id, schema version, export time, records and settings.
- Encrypted by default in the [age](https://age-encryption.org) format with a passphrase (scrypt), using the `age-encryption` library.
- Plain JSON only after an explicit warning.
- Readable formats such as CSV, Markdown and iCalendar are offered per app, for use in other tools.

### Import

- Treated as hostile input.
- Size check → decrypt → parse → validate → migrate → preview → merge → one transaction.

### Specs

- The exact formats are specified in `docs/specs/` before implementation (Phase 1.1).

## Consequences

- Field-level merging makes moving data between devices by hand safe: edits to different fields are both kept.
- Tombstones grow slowly, which is acceptable for personal data volumes.
- `age` files can be decrypted with standard tools, so users are never locked in.
- Every backup format version must stay importable forever.

## Alternatives considered

- **SQLite (WebAssembly) in the Origin Private File System:** more powerful queries, but a larger bundle and single-connection coordination across tabs. Not needed.
- **Record-level last-writer-wins:** simpler, but concurrent edits to different fields would be lost. Rejected.
- **A custom encryption format:** rejected. Use a standard, reviewed format.
- **CRDT libraries (Yjs, Automerge) for all data:** overkill for structured records. They may be used for rich text later, through a new ADR.
