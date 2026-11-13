# Modules

The Gradle modules in `android/` and how they depend on each other. The
rules are in [CLAUDE.md](../../CLAUDE.md), "Architecture rules".

## Direction

`app` → `feature` → `core`. A `core` module never depends on a `feature`
module. Feature modules never depend on each other.

## Modules today

| Module | Kind | What it holds | Depends on |
|---|---|---|---|
| `core/design` | Library | The design system: `ShkTheme`, the colour, type, shape and spacing tokens, `ShkText`, `ShkScreen`, the window widths `ShkWindowWidth`, the window theme `Theme.Shk`, and the `Shk*` components: buttons, floating action buttons, chips, the text field, the checkbox, switch and radio button, the slider, the card, the list item, the divider, the section header, the empty, loading and error states, the top bar, the navigation bar and rail, the list-and-detail scaffold, the dialog, the bottom sheet, the snackbar, the menu, and the date and time pickers. See [design-system.md](../development/design-system.md). | Compose UI, Foundation, Material 3, Activity Compose |
| `core/data` | Library | The base for every app database: `systemSqliteDatabaseBuilder` on the system SQLite, the record fields `RecordFields` and `Record`, the change counter `ChangeCounter`, `RecordDao`, `RecordWriter`, which stamps every write, gives it a change number and only marks deletes, `Clock` and `IdSource`, the "changed since" query (`RecordSql`, `BEFORE_FIRST_CHANGE`), and the marker `PurgesDeletedRecords`. See [data.md](data.md). | Room runtime, `androidx.sqlite` framework driver |
| `core/crypto` | Library | All cryptography of the suite, as [crypto-design.md](../security/crypto-design.md) says: the entry point `ShkCrypto`, sealed records (`RecordSealer`), file keys and file streams (`FileCrypto`, `FileKey`), backup streams (`BackupCrypto`), the recovery key and its words (`RecoveryKey`, `RecoveryWords`, `KeySetup`), the app lock (`AppLock`), one step for one system prompt (`PromptStep`), what the security screen shows (`KeyStatus`), the answers of a reader (`BlobException`, `BlobAnswer`), and the app name (`AppName`). The BIP-39 word list is in its resources. | Tink (`tink-android`) |
| `core/backup` | Library | The backup file of an app, as [backup-format.md](backup-format.md) says: `Backups`, which writes a backup to a document, checks one and restores one; the interface each app implements, `BackupContent`, with `BackupSink`, `BackupRecord`, `CheckedBackup` and `CheckedFile`; the results `ExportResult`, `CheckResult`, `RestoreResult` and the answers `BackupAnswer`; and `BackupDocuments`, the two intents of the system file picker. | `core/crypto`, `core/data` |
| `core/notify` | Library | Alarms and notifications of an app, as [notifications.md](notifications.md) says: the entry point `Notify`, the interface of the app class `NotifyHost`, what the app names and gets back (`Alarm`, `AlarmId`, `AlarmSource`, `AlarmHandler`), the small interface in front of Android's alarms `AlarmScheduler`, channels (`NotifyChannel`, `ChannelImportance`), `Notifications` and `ShkNotification`, the state for a screen `NotifyState`, and the two receivers `AlarmReceiver` and `SystemEventReceiver`. While the app lock is on, notifications hide their text (`hidesText`, `hideShownText`). Its manifest declares three permissions and the two receivers ([permissions.md](../security/permissions.md#apps-that-use-corenotify)). | `core/data` |
| `core/security` | Library | The recovery key screens, the security screen and the optional app lock, as [security-screens.md](security-screens.md) says: one activity per flow (`SecurityActivity`, `CreateRecoveryKeyActivity`, `EnterRecoveryKeyActivity`, `ShowRecoveryKeyActivity`, `AppLockActivity`, `TurnOnAppLockActivity`), the ways in (`SecurityScreens`), the interface of the app class (`SecurityHost`), `secureWindow`, the app lock's `AppLockWatcher`, which decides when the app locks, and `AppLockGate`, which every screen of an app puts its content in, the settings of the app lock in a small preferences file ([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)), a ViewModel per screen, and the content of each screen, public for the Catalog only behind the opt-in `SecurityScreenSamples`. It is the only module that shows Android's system prompt. Its manifest declares `USE_BIOMETRIC` and the six screens ([permissions.md](../security/permissions.md#apps-that-use-coresecurity)). | `core/crypto`, `core/design`, Activity Compose, Lifecycle ViewModel |
| `core/testing` | Library, used only in tests | Shared test helpers: `TestClock`, `TestIdSource`, `inMemoryTestDatabaseBuilder`, the migration test rule `MigrationTestRule`, and the checks `recordConventionProblems` and `changeNumberProblems`. See [data.md](data.md#migration-tests). For tests on an emulator: the runner `InstrumentedTestRunner` and `TestDevice`. See [emulator-tests.md](../development/emulator-tests.md). | `core/data`, JUnit, Room testing |
| `app/catalog` | App, `app.shkriuss.catalog` | The design gallery: a start screen, one page each for colours, type, shape and spacing, and one page each for buttons, floating action buttons, chips, text fields, selection controls, sliders, cards, lists, the empty, loading and error states, top bars, navigation, list and detail, dialogs, bottom sheets, snackbars, menus, date pickers and time pickers; and, in a group of shared screens, a page with every state of the recovery key screens and a page with every state of the app lock screens, with sample data. Its manifest removes `USE_BIOMETRIC` and the screens of `core/security`. | `core/design`, `core/security`, Activity Compose |

- Only `core/design` uses Material 3. It is an `implementation`
  dependency, so other modules cannot import it by accident.
- `core/design` exposes Compose UI and Foundation to the modules that use
  it.
- `core/design` uses Activity Compose only for the back gesture in
  `ShkListDetailScaffold`. It is an `implementation` dependency, at the
  version the apps use. Material 3 already brings an older version at run
  time.
- `core/data` exposes Room and the system SQLite driver to the modules
  that use it, because `RecordDao` and `RecordWriter` are built on them.
- Only `core/crypto` uses Tink, `javax.crypto`, `java.security.KeyStore`
  and `android.security.keystore`. Tink is an `implementation`
  dependency, so other modules cannot import it, and no Tink or
  `javax.crypto` type is in what `core/crypto` shows to them. The one
  platform type it hands out is `BiometricPrompt.CryptoObject`, for the
  system prompt. A unit test in `core/crypto`, `CryptoBoundaryTest`,
  reads the source of every other module and fails if one of them names
  any of the four ([build.md](../development/build.md#unit-tests)).
- `core/crypto` depends on no other module. It takes the app's hardware
  keys through an interface, so its unit tests run without the Android
  Keystore.
- `core/crypto` has test fixtures: the stand-in for the Android Keystore
  and `SoftwareKeysApp`, which builds a real `ShkCrypto` on it. Other
  modules use them only in their tests, with
  `testImplementation(testFixtures(project(":core:crypto")))`. They are
  never part of an app
  ([ADR 0029](../adr/0029-test-fixtures-for-the-keystore-stand-in.md),
  [build.md](../development/build.md#test-fixtures)).
- `core/backup` adds no cryptography. It gets the encrypted stream of a
  backup from `BackupCrypto` of `core/crypto`, and the record fields and
  the clock from `core/data`. It exposes both modules to the apps that
  use it. It knows no table and no record type of any app: an app hands
  its records and files over through `BackupContent`.
- `core/backup` reads and writes a backup only through a `content:` URI
  that the system file picker gave. It asks for no permission.
- Only `core/notify` uses Android's `AlarmManager` and
  `NotificationManager`, and it adds no library for them. A unit test in
  `core/notify`, `NotifyBoundaryTest`, reads the source of every other
  module and fails if one of them names an alarm or notification class
  of Android or AndroidX.
- `core/security` lives in `core` because every app's feature modules
  must be able to open it, and features may not depend on each other. It
  uses the `Shk*` components, never Material 3. It exposes `core/crypto`,
  because `SecurityHost` hands out `ShkCrypto`.
- `core/notify` depends on `core/data` only for the `Clock`, and exposes
  it. It knows no table and no record type of any app: an app names its
  alarms through `AlarmSource` and shows its notifications in
  `AlarmHandler`.
- Every app that uses `core/notify` gets its three permissions and two
  receivers through the module's manifest
  ([ADR 0030](../adr/0030-how-core-notify-keeps-alarms.md)).
- `core/testing` depends on `core/data` for the `Clock` and `IdSource` it
  fakes. `core/data`'s own tests depend on `core/testing`. That is no
  loop: the tests of a module are not part of the module.
- Other modules add `core/testing` only as a test dependency
  (`testImplementation`, and `androidTestImplementation` for tests on an
  emulator), never to their main code or their test fixtures. The build
  enforces it: any other configuration that declares `core/testing`
  fails every Gradle command
  ([build.md](../development/build.md#logging-check)).
- A module with tests on an emulator applies the
  `shkriuss.android.instrumented-test` plugin
  ([emulator-tests.md](../development/emulator-tests.md#how-a-module-gets-instrumented-tests)).
- A module with a database applies the `shkriuss.android.room` plugin
  ([build.md](../development/build.md#convention-plugins)).
- Build config for every module lives in the convention plugins in
  `android/build-logic/`. See [build.md](../development/build.md).

## Modules to come

From the repository map in CLAUDE.md: `core/sync-client`,
`feature/<app>/...` and one `app/<app>` module per app. Each is added by
the phase that needs it.
