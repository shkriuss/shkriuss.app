# Architecture decision records

One short file per decision that is costly to reverse. Files are numbered,
starting at 0001. Each one says what was decided, why, what was rejected and
what follows from it.

To write a new record, follow [template.md](template.md). Why the project
keeps these records is in
[0001](0001-record-architecture-decisions.md).

Records 0001 to 0018 come from section 18 of the [plan](../plan/PLAN.md).
Where the plan gives no reason for a rejected option, the record says
"Reason not recorded".

| No. | Decision | Status |
|---|---|---|
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md) | Accepted |
| 0002 | [GrapheneOS first, minimum Android 13](0002-grapheneos-first-minimum-android-13.md) | Accepted |
| 0003 | [Kotlin, Compose, Material 3, Navigation 3](0003-kotlin-compose-material-3-navigation-3.md) | Accepted |
| 0004 | [Room on system SQLite, no SQLCipher](0004-room-on-system-sqlite-no-sqlcipher.md) | Accepted |
| 0005 | [No network permission in data apps, separate Sync app](0005-no-network-permission-in-data-apps.md) | Accepted |
| 0006 | [Tink and the key hierarchy](0006-tink-and-key-hierarchy.md) | Accepted |
| 0007 | [Recovery key instead of passwords](0007-recovery-key-instead-of-passwords.md) | Accepted |
| 0008 | [Backup file format](0008-backup-file-format.md) | Accepted |
| 0009 | [Sync protocol and server](0009-sync-protocol-and-server.md) | Accepted |
| 0010 | [Exact alarms and reminder storage](0010-exact-alarms-and-reminder-storage.md) | Accepted |
| 0011 | [No native code, Grammar exception](0011-no-native-code-grammar-exception.md) | Accepted |
| 0012 | [No DI framework](0012-no-di-framework.md) | Accepted |
| 0013 | [Signing key custody and rotation](0013-signing-key-custody-and-rotation.md) | Accepted |
| 0014 | [Release flow and reproducible builds](0014-release-flow-and-reproducible-builds.md) | Accepted |
| 0015 | [Distribution channels](0015-distribution-channels.md) | Accepted |
| 0016 | [No developer registration with Google for now](0016-no-google-developer-registration-for-now.md) | Accepted |
| 0017 | [Design system tokens](0017-design-system-tokens.md) | Accepted |
| 0018 | [Licences](0018-licences.md) | Accepted |
