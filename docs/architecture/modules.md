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
| `core/data` | Library | The base for every app database: `systemSqliteDatabaseBuilder` on the system SQLite, the record fields `RecordFields` and `Record`, `RecordDao`, `RecordWriter`, which stamps every write and only marks deletes, `Clock` and `IdSource`, and the "changed since" query (`RecordSql`, `ChangeCursor`). See [data.md](data.md). | Room runtime, `androidx.sqlite` framework driver |
| `core/testing` | Library, used only in tests | Shared test helpers: `TestClock`, `TestIdSource`, `inMemoryTestDatabaseBuilder`, the migration test rule `MigrationTestRule` and the record conventions check `recordConventionProblems`. See [data.md](data.md#migration-tests). | `core/data`, JUnit, Room testing |
| `app/catalog` | App, `app.shkriuss.catalog` | The design gallery: a start screen, one page each for colours, type, shape and spacing, and one page each for buttons, floating action buttons, chips, text fields, selection controls, sliders, cards, lists, the empty, loading and error states, top bars, navigation, list and detail, dialogs, bottom sheets, snackbars, menus, date pickers and time pickers. | `core/design`, Activity Compose |

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
- `core/testing` depends on `core/data` for the `Clock` and `IdSource` it
  fakes. `core/data`'s own tests depend on `core/testing`. That is no
  loop: the tests of a module are not part of the module.
- Other modules add `core/testing` only as a test dependency
  (`testImplementation`), never to their main code.
- A module with a database applies the `shkriuss.android.room` plugin
  ([build.md](../development/build.md#convention-plugins)).
- Build config for every module lives in the convention plugins in
  `android/build-logic/`. See [build.md](../development/build.md).

## Modules to come

From the repository map in CLAUDE.md: `core/crypto`, `core/backup`,
`core/notify`, `core/sync-client`, `feature/<app>/...` and one `app/<app>`
module per app. Each is added by the phase that needs it.
