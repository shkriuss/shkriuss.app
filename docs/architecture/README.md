# Architecture

How the code and the data formats fit together.

Pages:

- [Modules](modules.md): the modules and how they depend on each other.
- [Data](data.md): how records are stored, the record fields, how writes
  stamp them, the "changed since" query, and how schemas and migrations
  are kept and tested.

What else belongs here:

- The database schema of each app, when the app exists.
- The backup file format. File: `backup-format.md`.
- The sync protocol. File: `sync-protocol.md`.

A change to the backup or sync format must update this folder in the same
pull request.
