# Modules

The Gradle modules in `android/` and how they depend on each other. The
rules are in [CLAUDE.md](../../CLAUDE.md), "Architecture rules".

## Direction

`app` → `feature` → `core`. A `core` module never depends on a `feature`
module. Feature modules never depend on each other.

## Modules today

| Module | Kind | What it holds | Depends on |
|---|---|---|---|
| `core/design` | Library | The design system: `ShkTheme`, the colour, type, shape and spacing tokens, `ShkText`, `ShkScreen`, the window widths `ShkWindowWidth`, the window theme `Theme.Shk`, and the `Shk*` components: buttons, floating action buttons, chips, the text field, the checkbox, switch and radio button, the slider, the progress bar, the card, the list item, the divider, the section header, the empty, loading and error states, the top bar, the navigation bar and rail, the list-and-detail scaffold, the dialog, with up to three buttons, and the progress dialog (`ShkProgressDialog`), the bottom sheet, the snackbar, the menu, and the date and time pickers. See [design-system.md](../development/design-system.md). | Compose UI, Foundation, Material 3, Activity Compose |
| `core/data` | Library | The base for every app database: `systemSqliteDatabaseBuilder` on the system SQLite, the record fields `RecordFields` and `Record`, the change counter `ChangeCounter`, `RecordDao`, `RecordWriter`, which stamps every write, gives it a change number and only marks deletes, `Clock` and `IdSource`, the "changed since" query (`RecordSql`, `BEFORE_FIRST_CHANGE`), and the marker `PurgesDeletedRecords`. See [data.md](data.md). | Room runtime, `androidx.sqlite` framework driver |
| `core/crypto` | Library | All cryptography of the suite, as [crypto-design.md](../security/crypto-design.md) says: the entry point `ShkCrypto`, sealed records (`RecordSealer`), file keys and file streams (`FileCrypto`, `FileKey`), backup streams (`BackupCrypto`), the recovery key and its words (`RecoveryKey`, `RecoveryWords`, `KeySetup`), the app lock (`AppLock`), one step for one system prompt (`PromptStep`), what the security screen shows (`KeyStatus`), the answers of a reader (`BlobException`, `BlobAnswer`), and the app name (`AppName`). The BIP-39 word list is in its resources. | Tink (`tink-android`) |
| `core/backup` | Library | The backup file of an app, as [backup-format.md](backup-format.md) says: `Backups`, which writes a backup to a document, checks one and restores one; the interface each app implements, `BackupContent`, with `BackupSink`, `BackupRecord`, `CheckedBackup` and `CheckedFile`; the results `ExportResult`, `CheckResult`, `RestoreResult` and the answers `BackupAnswer`; what a checked backup says about itself, `BackupSummary`, with how many records of each type name are not deleted; and `BackupDocuments`, the two intents of the system file picker. | `core/crypto`, `core/data` |
| `core/notify` | Library | Alarms and notifications of an app, as [notifications.md](notifications.md) says: the entry point `Notify`, the interface of the app class `NotifyHost`, what the app names and gets back (`Alarm`, `AlarmId`, `AlarmSource`, `AlarmHandler`), the small interface in front of Android's alarms `AlarmScheduler`, channels (`NotifyChannel`, `ChannelImportance`), `Notifications` and `ShkNotification`, the state for a screen `NotifyState`, buttons on a notification (`ShkNotificationButton`, `ButtonPress`, `ButtonHandler`), and the three receivers `AlarmReceiver`, `SystemEventReceiver` and `ButtonReceiver`. While the app lock is on, notifications hide their text and have no buttons (`hidesText`, `hideShownText`). Its manifest declares three permissions and the three receivers ([permissions.md](../security/permissions.md#apps-that-use-corenotify)). Its test fixtures, `NotifyTestDevice`, are for the unit tests of apps with reminders. | `core/data` |
| `core/security` | Library | The recovery key screens, the security screen and the optional app lock, as [security-screens.md](security-screens.md) says: one activity per flow (`SecurityActivity`, `CreateRecoveryKeyActivity`, `EnterRecoveryKeyActivity`, `ShowRecoveryKeyActivity`, `AppLockActivity`, `TurnOnAppLockActivity`, and for the handover between apps `HandoverActivity` and `GetKeysActivity`), the handover's status provider `KeeperStatusProvider`, its permission and how an app sees the other apps of the suite (`SuiteApps`; [ADR 0041](../adr/0041-the-handover-between-apps.md)), the ways in (`SecurityScreens`), the interface of the app class (`SecurityHost`), `secureWindow` and the shield against other apps (`WindowShield.kt`), the app lock's `AppLockWatcher`, which decides when the app locks, and `AppLockGate`, which every screen of an app puts its content in, the settings of the app lock in a small preferences file ([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)), a ViewModel per screen, the dialog for the moment the recovery key is first needed (`RecoveryKeyFirstNeed`, `RecoveryKeyNeed`; [ADR 0035](../adr/0035-recovery-key-when-first-needed.md)), and the content of each screen, public for the Catalog only behind the opt-in `SecurityScreenSamples`. It is the only module that shows Android's system prompt. Its manifest declares `USE_BIOMETRIC`, `HIDE_OVERLAY_WINDOWS` and the six screens ([permissions.md](../security/permissions.md#apps-that-use-coresecurity)). | `core/crypto`, `core/design`, Activity Compose, Lifecycle ViewModel |
| `core/testing` | Library, used only in tests | Shared test helpers: `TestClock`, `TestIdSource`, `inMemoryTestDatabaseBuilder`, the migration test rule `MigrationTestRule`, and the checks `recordConventionProblems` and `changeNumberProblems`. See [data.md](data.md#migration-tests). For tests on an emulator: the runner `InstrumentedTestRunner` and `TestDevice`. See [emulator-tests.md](../development/emulator-tests.md). The check that every screen, sheet and dialog of an app is behind the app lock: `AppLockCheck`, its app classes `LockedAppForTests`, `AppLockOnForTests` and `UnlockedAppForTests`, and `MergedManifest`, which reads the app's merged manifest ([security-screens.md](security-screens.md#every-screen-is-behind-the-gate)). The app classes `NewAppForTests`, with no recovery key, and `StoppedSetupAppForTests`, with a setup that stopped. `TestDocuments`, the documents of the system file picker for unit tests. | `core/data`, JUnit, Room testing. Only to compile: `core/security`, the test fixtures of `core/crypto`, Activity Compose, the Compose test library |
| `feature/water` | Library | The data and logic of Water, as [its specification](../apps/water/spec.md) says: the database `water.db` with the record tables `intake`, `goal` and `settings` (`WaterDatabase`, its DAOs, `WaterMigrations`), the repository `WaterRepository`, the rules as plain code (`WaterUnit` and `AmountInput`, `GoalRules`, `SettingsRules`, `NextReminder`), the local day and time (`WaterTime`), the ViewModels of Today and a day (`DayViewModel`), History and Settings, the backup content (`WaterBackupContent`, `WaterBackupCodec`), what the app class hands to the screens (`WaterServices`, `WaterHost`), and the reminders (`WaterReminders`, the `AlarmSource`, `AlarmHandler` and `ButtonHandler` of the app, the phone-only `ReminderBook`, and `RemindersViewModel`, the reminder line and the question for notifications). It also holds backup and restore on `core/backup` (`WaterBackups`, which also finishes a pending move of the file keys, and `BackupViewModel`, with the rows "Recovery key" and "App lock" of Settings), and the third-party parts that ship in Water (`Licences`, with their notices and licence texts in `res/raw`). Its package `ui` holds the screens: `WaterScreens`, the three destinations in `ShkNavigationScaffold`, with Today, History and its open day, Settings, the drink sheet and the dialogs, among them those of backup and restore (`BackupFlow`), and the Licences screen; `WaterModels`, which makes the six ViewModels for the activity; and `WaterFormat`, how numbers, amounts, times and dates are shown and read by TalkBack. No navigation library ([ADR 0003](../adr/0003-kotlin-compose-material-3-navigation-3.md), point 2). | `core/data`, `core/backup`, `core/design`, `core/notify`, `core/security`, Lifecycle ViewModel, Activity Compose, Room. `core/crypto` comes with `core/backup` and `core/security`, which show it. |
| `feature/reminders` | Library | The data and logic of Reminders, as [its specification](../apps/reminders/spec.md) says: the database `reminders.db` with the record table `reminder` (`RemindersDatabase`, `ReminderDao`, `RemindersMigrations`), the repository `RemindersRepository`, which also does the work on the phone-only `ReminderBook` after each write, the rules as plain code (`Schedule` and `Repeat`, `Occurrences`, the rule and the mark in `ReminderRule`, the two lists in `ReminderLists`, the limits in `ReminderLimits`, `TitleRules` and `ScheduleRules`, and the form's `FormRules`), the phone's clock (`RemindersTime`, `ClockReading`) and the clock of the screens (`RemindersNow`), the ViewModels of Upcoming, Past and the reminder form, the backup content (`RemindersBackupContent`, `RemindersBackupCodec`), what the app class hands to the screens (`RemindersServices`, `RemindersHost`), and the notifications (`RemindersAlarms`, the `AlarmSource`, `AlarmHandler` and `ButtonHandler` of the app, and `NotificationsViewModel`, the line about notifications on Upcoming, the question for notifications and a tap on a notification). It also holds backup and restore on `core/backup` (`RemindersBackups`, which also finishes a pending move of the file keys, and `BackupViewModel`, with the rows "Recovery key" and "App lock" of Settings), and the third-party parts that ship in Reminders (`Licences`, with their notices and licence texts in `res/raw`). Its package `ui` holds the screens: `RemindersScreens`, the three destinations in `ShkNavigationScaffold`, with Upcoming, Past and Settings, the reminder form, as a sheet or as a pane beside its list, the question of Delete all, the line and the question about notifications, the dialogs of backup and restore (`BackupFlow`), and the Licences screen; `RemindersModels`, which makes the ViewModels for the activity, with a form for each list; and `RemindersFormat`, how dates, times and repeats are shown and read by TalkBack. No navigation library ([ADR 0003](../adr/0003-kotlin-compose-material-3-navigation-3.md), point 2). | `core/data`, `core/backup`, `core/design`, `core/notify`, `core/security`, Lifecycle ViewModel, Activity Compose, Room. `core/crypto` comes with `core/backup` and `core/security`, which show it. |
| `app/catalog` | App, `app.shkriuss.catalog` | The design gallery: a start screen, one page each for colours, type, shape and spacing, and one page each for buttons, floating action buttons, chips, text fields, selection controls, sliders, progress bars, cards, lists, the empty, loading and error states, top bars, navigation, list and detail, dialogs, bottom sheets, snackbars, menus, date pickers and time pickers; and, in a group of shared screens, a page with every state of the recovery key screens, a page with every state of the app lock screens, and a page with the four forms of the dialog for the moment the recovery key is first needed, with sample data. Its manifest removes `USE_BIOMETRIC`, `HIDE_OVERLAY_WINDOWS` and the screens of `core/security`. | `core/design`, `core/security`, Activity Compose |
| `app/water` | App, `app.shkriuss.water` | The Water app: its app class `WaterApp`, a `SecurityHost`, a `WaterHost` and a `NotifyHost` that builds the one `Notify`, and its one activity `WaterActivity`, which makes `WaterModels` and shows `WaterScreens` in `AppLockGate`. When it starts, it also has `WaterServices` empty what a restore left behind (`Backups.start()`). Its manifest has the two permissions and the six screens of `core/security` ([permissions.md](../security/permissions.md#water-appshkriusswater)). | `feature/water`, `core/design`, `core/security`, `core/notify`, Activity Compose |
| `app/reminders` | App, `app.shkriuss.reminders` | The Reminders app: its app class `RemindersApp`, a `SecurityHost`, a `RemindersHost` and a `NotifyHost`, which builds the one `Notify`, and its one activity `RemindersActivity`, which makes `RemindersModels`, shows `RemindersScreens` in `AppLockGate`, and opens the form of the reminder a tap on a notification names. Its manifest has the three permissions and the three receivers of `core/notify`, and the two permissions and the six screens of `core/security` ([permissions.md](../security/permissions.md#reminders-appshkriussreminders)). | `feature/reminders`, `core/design`, `core/notify`, `core/security`, Activity Compose |

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
- Every app that uses `core/notify` gets its three permissions and three
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
  ([build.md](../development/build.md#convention-plugins)). Room's plugin
  works in library modules only, so an app's database is in its feature
  module, as Water's is in `feature/water` and Reminders' in
  `feature/reminders`.
- `feature/water` and `feature/reminders` show `core/data` to the app,
  which builds `WaterServices` or `RemindersServices` with the `Clock`
  and the `IdSource` of `core/data`.
- `core/testing` names `core/security`, the test fixtures of
  `core/crypto` and the Compose test library only to compile. An app's
  unit tests bring them at run time. So the tests on an emulator that use
  `core/testing` get none of them
  ([build.md](../development/build.md#shared-test-helpers)).
- Build config for every module lives in the convention plugins in
  `android/build-logic/`. See [build.md](../development/build.md).

## Modules to come

From the repository map in CLAUDE.md: `core/sync-client`,
`feature/<app>/...` and one `app/<app>` module per app. Each is added with
the first work that needs it.
