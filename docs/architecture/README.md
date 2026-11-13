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

- [Notifications and alarms](notifications.md): how `core/notify` sets
  exact alarms, keeps them right after a reboot, an update and a change
  of the time or the time zone, shows notifications, and what a screen
  shows when the user does not allow them.
- [Recovery key screens](security-screens.md): the screens of
  `core/security` that every app uses to create, enter and show the
  recovery key, the security screen, and what keeps the words safe.

What else belongs here:

- The database schema of each app, when the app exists.
- The sync protocol. File: `sync-protocol.md`.

A change to the backup or sync format must update this folder in the same
pull request.
