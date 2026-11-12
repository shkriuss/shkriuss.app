# Architecture

How the code and the data formats fit together.

Pages:

- [Modules](modules.md): the modules and how they depend on each other.
- [Data](data.md): how records are stored, the record fields, how writes
  stamp them, the "changed since" query, and how schemas and migrations
  are kept and tested.
- [Backup file format](backup-format.md): the bytes of a backup file,
  what an app puts into it, and how a backup is written, checked and
  restored.

What else belongs here:

- The database schema of each app, when the app exists.
- The sync protocol. File: `sync-protocol.md`.

A change to the backup or sync format must update this folder in the same
pull request.
