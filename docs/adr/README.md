# Architecture decision records

One short file per decision that is costly to reverse. Files are numbered,
starting at 0001. Each one says what was decided, why, what was rejected and
what follows from it.

The template comes in Phase 0, step 2.

The first records to write, from section 18 of the [plan](../plan/PLAN.md):

- 0001 Record architecture decisions
- 0002 GrapheneOS-first, minimum Android 13
- 0003 Kotlin, Compose, Material 3, Navigation 3
- 0004 Room on system SQLite, no SQLCipher
- 0005 No network permission in data apps, separate Sync app
- 0006 Tink and the key hierarchy
- 0007 Recovery key instead of passwords
- 0008 Backup file format
- 0009 Sync protocol and server
- 0010 Exact alarms and reminder storage
- 0011 No native code, Grammar exception
- 0012 No DI framework
- 0013 Signing key custody and rotation
- 0014 Release flow and reproducible builds
- 0015 Distribution channels
- 0016 No developer registration with Google for now
- 0017 Design system tokens
- 0018 Licences

None of them exist yet.
