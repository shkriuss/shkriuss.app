# Modules

The Gradle modules in `android/` and how they depend on each other. The
rules are in [CLAUDE.md](../../CLAUDE.md), "Architecture rules".

## Direction

`app` → `feature` → `core`. A `core` module never depends on a `feature`
module. Feature modules never depend on each other.

## Modules today

| Module | Kind | What it holds | Depends on |
|---|---|---|---|
| `core/design` | Library | The design system. For now a stub: `ShkTheme`, `ShkScreen`, `ShkText`, and the window theme `Theme.Shk`. | Compose UI, Foundation, Material 3 |
| `app/catalog` | App, `app.shkriuss.catalog` | The design gallery. For now one screen that says "Catalog". | `core/design`, Activity Compose |

- Only `core/design` uses Material 3. It is an `implementation`
  dependency, so other modules cannot import it by accident.
- `core/design` exposes Compose UI and Foundation to the modules that use
  it.
- Build config for every module lives in the convention plugins in
  `android/build-logic/`. See [build.md](../development/build.md).

## Modules to come

From the repository map in CLAUDE.md: `core/data`, `core/crypto`,
`core/backup`, `core/notify`, `core/sync-client`, `core/testing`,
`feature/<app>/...` and one `app/<app>` module per app. Each is added by the
phase that needs it.
