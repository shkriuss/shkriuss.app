# Architecture decision records

One short file per decision that is costly to reverse. Files are numbered,
starting at 0001. Each one says what was decided, why, what was rejected and
what follows from it.

To write a new record, follow [template.md](template.md). Why the project
keeps these records is in
[0001](0001-record-architecture-decisions.md).

Records 0001 to 0018 come from section 18 of the [plan](../plan/PLAN.md),
with reasons and details the owner added in review. Record 0019 covers hard
rule 1 in [CLAUDE.md](../../CLAUDE.md). Record 0020 covers the dependency
verification asked for in section 17 of the plan and in Phase 0, step 3.
Record 0021 covers version codes, from the owner's review of the release
workflow in Phase 0, step 6. Records 0022 and 0023 cover the hub site, from
the owner's prompt for Phase 0, step 7. Record 0024 covers the adaptive
layouts of the design system, from the owner's decisions on pull request
16; it replaces part of 0003. Record 0025 adds secure app spawning to the
GrapheneOS checklist of 0002, from the owner's decision on pull request
19. Records 0026 and 0027 come from Phase 1, step 3: Room's build tools,
which the owner asked for, and how the record fields of 0004 are stored
and stamped, with the change number from the owner's decisions on pull
request 21. Records 0006 and 0007 were completed in Phase 1, step 4, with
the owner's decisions of 2026-11-12. Their detail is in
[crypto-design.md](../security/crypto-design.md).

How a record may be edited or replaced is in point 7 of
[0001](0001-record-architecture-decisions.md).

| No. | Decision | Status |
|---|---|---|
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md) | Accepted |
| 0002 | [GrapheneOS first, minimum Android 13](0002-grapheneos-first-minimum-android-13.md) | Accepted; point 4 extended by 0025 |
| 0003 | [Kotlin, Compose, Material 3, Navigation 3](0003-kotlin-compose-material-3-navigation-3.md) | Accepted; the adaptive libraries superseded by 0024 |
| 0004 | [Room on system SQLite, no SQLCipher](0004-room-on-system-sqlite-no-sqlcipher.md) | Accepted; detail in 0026 and 0027 |
| 0005 | [No network permission in data apps, separate Sync app](0005-no-network-permission-in-data-apps.md) | Accepted |
| 0006 | [Tink and the key hierarchy](0006-tink-and-key-hierarchy.md) | Accepted; detail in crypto-design.md |
| 0007 | [Recovery key instead of passwords](0007-recovery-key-instead-of-passwords.md) | Accepted; detail in crypto-design.md |
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
| 0019 | [No WebView, no runtime code loading](0019-no-webview-no-runtime-code-loading.md) | Accepted |
| 0020 | [Dependency verification](0020-dependency-verification.md) | Accepted |
| 0021 | [Version names and version codes](0021-version-names-and-version-codes.md) | Accepted |
| 0022 | [Hub site generator](0022-hub-site-generator.md) | Accepted |
| 0023 | [Hub site hosting and deploy](0023-hub-site-hosting-and-deploy.md) | Accepted |
| 0024 | [Own adaptive layouts, no Material 3 adaptive libraries](0024-own-adaptive-layouts.md) | Accepted |
| 0025 | [Secure app spawning in the GrapheneOS checklist](0025-secure-app-spawning-in-grapheneos-checklist.md) | Accepted |
| 0026 | [Room's build tools and committed schemas](0026-room-build-tools.md) | Accepted |
| 0027 | [How the record fields are stored and stamped](0027-record-fields-and-stamping.md) | Accepted |
