# shkriuss.app

Open-source suite of native Android apps (`app.shkriuss.<name>`), built from shared
core modules. GrapheneOS is the first target. Local-first, no Google services,
optional end-to-end encrypted sync through a self-hosted Cloudflare backend.

The owner works only from a phone or tablet browser. There is no computer, no
Android Studio, no adb, no local build. Never write instructions that need one.
Everything ships through pull requests and GitHub Actions.

## Hard rules

Breaking one of these is never the right way to make a build or test pass.
If a task seems to need it, stop and say so in the PR description.

1. No WebView. No runtime code loading (`DexClassLoader`, downloaded code, plugins).
2. No native libraries and no JNI. The only exception is `android/app/grammar`
   (Rust), governed by its ADR.
3. No Google Play services, Firebase, analytics, ads, trackers or crash reporters.
4. Data apps never declare `android.permission.INTERNET`. Only `android/app/sync` may.
5. No new dependency without an ADR. A dependency change always updates
   `android/gradle/libs.versions.toml` and `android/gradle/verification-metadata.xml`
   in the same PR. Tools outside Gradle, such as wrangler, are pinned with a
   lockfile and checksums in an owner-only folder, and also need an ADR.
6. Never edit signing config, release workflows (`.github/workflows/release*.yml`),
   repository settings files or anything listed in `.github/CODEOWNERS` as
   owner-only, unless the owner asked for exactly that change.
7. Never print, log, commit or echo secrets. Never add secrets to code or docs.
8. Never push to `main`, never force-push, never create tags. Work on a branch
   named `claude/<short-topic>` and open a pull request.
9. Never disable or weaken lint, tests, dependency verification or screenshot
   checks. Fix the cause.
10. Never log user content (note text, amounts, file names, reminder titles).

## Repository map

- `android/` Gradle project.
  - `build-logic/` convention plugins. All module build config lives here.
  - `core/design` design system. `core/data` Room base and record conventions.
    `core/crypto` all cryptography. `core/backup` backup file format.
    `core/notify` alarms and notifications. `core/sync-client` change-set export
    and import. `core/testing` shared test helpers.
  - `feature/<app>/...` screens and logic for one app.
  - `app/<app>` thin application modules. `app/catalog` is the debug-only
    design gallery. `app/sync` is the only networked app.
- `backend/` sync Worker (Cloudflare Workers, D1, R2).
- `site/` static hub website. Built from `docs/` plus `site/`.
- `docs/` all documentation. `docs/adr/` architecture decisions.
- `docs/plan/PLAN.md` the project plan.
- `tools/` scripts used by CI.
- `.claude/rules/` rules that apply only to some paths. Read the ones that match
  the files you touch.

## Commands

Run from `android/`. Keep this list correct when tasks change.

- `./gradlew check` unit tests, Android Lint, and the schema, DAO rules and instrumented test suite checks, for all modules.
- `./gradlew :app:<name>:assembleDebug` build one app.
- `./gradlew :<module>:assembleDebugAndroidTest` build a module's test APK for the emulator, for example `:core:crypto`. It shows that the instrumented tests compile. They run only in CI.
- `./gradlew verifyRoborazziDebug` compare screenshots with the committed ones.
- `./gradlew recordRoborazziDebug` re-record screenshots after an intended UI change.
- `./gradlew recordRoomSchemas` write the database schema files after an intended schema change. Commit them.
- `./gradlew --no-daemon --console=plain check verifyRoborazziDebug :app:<name>:checkReleaseApkRules :app:<name>:checkReleaseGraphicsPathUse`, with both release checks for every app, is what CI runs. See `docs/development/ci.md`.
- After a dependency change: delete the build folders (`build/` in
  `android/`, in `build-logic/` and in every module, and
  `android/.gradle/configuration-cache/`), then
  `./gradlew --write-verification-metadata sha256,pgp --export-keys help check verifyRoborazziDebug assembleDebug assembleRelease assemblePreview`.
  Then follow the checks in `docs/development/build.md`.

Run from the repository root:

- `python3 -B -m unittest discover -s tools/site -t tools/site` tests the hub site generator.
- `python3 -B tools/site/build.py <new or empty folder>` builds the hub site. See `docs/development/site.md`.

Emulator tests, signing and releases run only in GitHub Actions.

## Architecture rules

- Dependency direction: `app` → `feature` → `core`. `core` never depends on
  `feature`. Features never depend on each other.
- Only `core/design` imports `androidx.compose.material3`. Features use the
  `Shk*` components and tokens from `core/design`.
- Screen → ViewModel (exposes one immutable state as `StateFlow`) → repository →
  Room. No business logic in composables.
- Dependencies are passed through constructors. No DI framework, no service
  locators, no global mutable state.
- Every stored record has `id` (random UUID), `createdAt`, `updatedAt` and
  `deletedAt` (deletion marker), plus a local `changeNumber` that every
  write sets and that never goes into a backup or sync. Never hard-delete
  synced records.
- Cryptography only through `core/crypto`. No `javax.crypto` or Tink calls
  anywhere else. Never invent a construction; use the ones documented in
  `docs/security/crypto-design.md`.
- Alarms and notifications only through `core/notify`.
- Files and photos enter and leave only through the system pickers. No storage
  permissions.

## Changing formats

- Database schema change: bump the version, add a migration, add a migration
  test, commit the exported schema JSON.
- Backup or sync format change: bump the format version, keep readers for every
  older version, add an ADR, update `docs/architecture/`.

## UI and accessibility

- Layouts adapt by window size class. Never lock orientation.
- Light theme and true-black dark theme for every screen. No dynamic colour.
- Touch targets at least 48dp. Text contrast at least 4.5:1.
- Every interactive element has a TalkBack label. Decorative images have none.
- Screens must work at font scale 2.0 without clipped or overlapping text.
- All user-visible text lives in string resources, with plurals where needed.
- A new or changed screen needs screenshot tests: phone and tablet, light and
  dark, font scale 1.0 and 2.0.

## Code style

- Kotlin only. Small functions, clear names, no clever abstractions.
- Public classes and functions have a short KDoc that says why they exist.
- Prefer the platform and the libraries already in the version catalog.
- Compiler warnings are errors.

## Documentation

- A change is not done until its docs are updated in the same PR: user guide,
  `docs/architecture/`, `docs/security/permissions.md` for any permission, and
  the app's `CHANGELOG.md`.
- A decision that is costly to reverse gets an ADR in `docs/adr/` using the
  template there.
- Write in plain English, short sentences, steps numbered. Instructions are for
  a phone browser first.

## Pull requests

One topic per PR. The description states:

1. What changed and why.
2. How to check it on a phone (which APK, which steps).
3. Which docs were updated.
4. Risks, open questions, and anything you were unsure about.

## Definition of done

- `./gradlew check` and screenshot verification pass.
- Tests cover the new behaviour.
- Docs and changelog updated.
- No hard rule broken, no new permission or dependency without an ADR.

## When stuck

Stop and ask in the PR or session instead of guessing. Say what you tried, what
failed and which options you see. Do not widen the scope of a task to get
unblocked.
