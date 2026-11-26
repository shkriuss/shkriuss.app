# Continuous integration

The GitHub Actions workflows that check every pull request, the one that
makes releases, the one that deploys the hub site, and the one that sends
the apps' libraries to GitHub's dependency graph. GitHub Actions is
the authoritative build (section 13 of the [plan](../plan/PLAN.md),
[ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md)).

| Workflow | File | Runs on | What it does |
|---|---|---|---|
| CI | [`ci.yml`](../../.github/workflows/ci.yml) | Every pull request, every push to `main` | Checks the Gradle wrapper, and that no released schema changed. Runs unit tests, lint, screenshot verification and the release rules checks. Runs the instrumented tests on emulators with Android 15 and 17. |
| PR preview | [`pr-preview.yml`](../../.github/workflows/pr-preview.yml) | Every pull request | Builds a preview APK of every app the pull request touches, and signs them all with one throwaway key. Uploads them and the changed screenshots. Keeps one comment on the pull request with the links. |
| Protected paths | [`protected-paths.yml`](../../.github/workflows/protected-paths.yml) | Every pull request, as `pull_request_target` | Labels a pull request `protected-paths` and keeps one comment listing its owner-only files, by CODEOWNERS on `main`. Never blocks a merge. |
| Release | [`release.yml`](../../.github/workflows/release.yml) | By hand, on `main` | Builds an app twice and compares the builds. Signs it after the owner's approval, attests it and creates a draft release. See [release.md](release.md). |
| Site | [`site.yml`](../../.github/workflows/site.yml) | Pull requests that change the site, every push to `main`, and by hand | Builds the hub site from `docs/` and `site/` and checks it. On `main` only, deploys it to the Cloudflare Worker `shkriuss-hub`, which serves static files only, and checks the live site and its security headers. See [site.md](site.md). |
| Dependency graph | [`dependency-graph.yml`](../../.github/workflows/dependency-graph.yml) | Every push to `main` that changes `android/`, and by hand. Never on pull requests | Lists the release runtime class path of every app, with dependency verification on, and sends it to GitHub's dependency graph, so that Dependabot alerts can name a library with a known vulnerability. See [Dependency graph](#dependency-graph). |

How to install a preview on a phone is in
[test-a-pull-request.md](test-a-pull-request.md). What the emulator tests
are and what they found is in [emulator-tests.md](emulator-tests.md). What
the protected-paths flag protects against, and what it does not, is in
[protected-paths.md](../security/protected-paths.md).

Still to come (plan section 13): `backend`.

## Rules every workflow follows

The full list is in `.claude/rules/workflows.md`. In short:

1. Every action is pinned to a full commit SHA, with its version in a
   comment.
2. Only GitHub's own actions are used. Everything else is a short shell
   step.
3. The token is read-only (`permissions: contents: read`). A job that needs
   more says why in a comment. Five jobs do. "Comment" in PR preview has
   `pull-requests: write` and nothing else. "Flag owner-only paths" in
   Protected paths has `pull-requests: write`, and `contents: read` only to
   read CODEOWNERS through the API. In Release, "Build" adds `actions: read`
   to read `ci.yml`'s run for the commit, and "Draft release" has
   `contents: write`, `id-token: write` and `attestations: write` to make
   the attestation and the draft. It checks out nothing. In Dependency
   graph, "Submit" has `contents: write`, only to send the list to the
   dependency graph. It checks out nothing and runs no code of the
   build.
4. No secrets, except in two steps. In Release, one step of the job "Sign"
   gets the three secrets of the `release` environment. In Site, one step
   of the job "Deploy" gets `CLOUDFLARE_API_TOKEN` of the `cloudflare`
   environment. No `pull_request_target`, except
   in Protected paths, which never checks out, builds or runs anything from
   the pull request.
5. Every job has a timeout and a concurrency group. A new push to a pull
   request cancels the older run. Protected paths, Release, Site's job
   "Deploy" and Dependency graph's job "Submit" are the exceptions: their
   runs wait for each other, so a run never stops half-way through
   writing.
6. Values from the event, from files and from earlier steps reach a shell
   only through `env`. File names are matched against fixed patterns and
   never run.
7. Checkouts do not keep the token on disk (`persist-credentials: false`),
   so the build cannot read it.

The workflows are owner-only ([CODEOWNERS](../../.github/CODEOWNERS)). Their
shell steps live inside the workflow files, not in `tools/`, so that a
change to them always needs the owner's review. A script that two
workflows share lives in `.github/scripts/`, which is owner-only too. Today
that is one: `check-version-code.sh`, used by CI and Release.

Site has two more files outside its workflow file:

- The generator, `tools/site/build.py`. It is not owner-only. It runs only
  in the job "Build", which has no secrets. The job "Check the site"
  checks what it writes, on a runner of its own, before anything is
  deployed.
- The deploy tool's pin, its install script and the Worker's
  configuration, in `.github/site-deploy/`. They are owner-only, like the
  workflow.

Dependency graph has one, for the same reason as the site generator:

- The snapshot script, `tools/dependency-graph/snapshot.py`, with its
  tests. It is not owner-only. It runs only in the job "List", which has
  no secrets and a read-only token. It reads Gradle's reports and writes
  one file. The job "Submit" checks that file before it sends it.

## CI

### Job "Gradle wrapper"

It runs no project code. It checks that:

1. `android/gradle/wrapper/gradle-wrapper.jar` is the only `.jar` file in
   the repository, so a second wrapper cannot hide under another name.
2. `distributionUrl` is a `-bin.zip` release on `services.gradle.org`.
3. That release is in Gradle's list of releases
   (`https://services.gradle.org/versions/all`), final and not broken.
4. `distributionUrl` and `distributionSha256Sum` are the address and the
   checksum that list gives for that release.
5. The SHA-256 of the wrapper jar is the one that list gives for that
   release's wrapper.

Gradle's own `wrapper-validation` action does a similar check, but it is not
one of GitHub's own actions. This one is stricter: the jar must belong to
the version in `gradle-wrapper.properties`. After a Gradle update, run the
wrapper task a second time, so the jar comes from the new version
([build.md](build.md#gradle-wrapper)).

### Job "Check"

It waits for "Gradle wrapper", so it never runs a wrapper that was not
checked. Then:

1. It checks that no released schema changed (see
   [Released schemas](#released-schemas) below).
2. It uses the JDK 21 that GitHub's Ubuntu runners come with.
3. It checks that no trust uses a pattern
   ([see below](#trust-patterns)).
4. It installs the SDK packages the build pins: `platforms;android-37.0`
   and `build-tools;36.0.0`. Keep them in step with `ShkBuild.kt` and the
   cloud setup script ([cloud-environment.md](cloud-environment.md)).
5. It restores Gradle's downloads (see [The download cache](#the-download-cache)).
6. It finds every app: a folder in `android/app/` with a build file.
7. It runs one Gradle command:
   `./gradlew check verifyRoborazziDebug`, plus, for every app,
   `:app:<name>:checkReleaseApkRules` and
   `:app:<name>:checkReleaseGraphicsPathUse`. Which build check runs
   inside `check` and which by name is below and in
   [build.md](build.md#which-check-runs-where).
8. It checks that both release checks wrote their report for every app.
9. It checks every app's version: the `versionCode` must follow from the
   `versionName` by the rule in
   [ADR 0021](../adr/0021-version-names-and-version-codes.md). It reads
   both from the release APK's `output-metadata.json` and runs
   `.github/scripts/check-version-code.sh`, the same script that Release
   runs. So a wrong code fails the pull request, not the release.
10. If anything failed, it uploads the screenshot differences, if there
   are any, and Gradle's dependency verification report, if Gradle wrote
   one.
11. On `main`, it saves the downloads for later runs.

Which build check runs where:

- Inside `check`: the Room schema check, the DAO rules check, the
  instrumented test suite check, the logging check in every Android
  module, and the tests of the build checks in `build-logic`
  (`:build-logic:test`).
- By name, the two release checks below. The APK rules check reads the
  release APK: rules 1 to 6 and rule 10 (the screens of `core/security`
  with both permissions) for every APK, and rules 7 to 9
  (WebView and code loading) for the APKs that ship.
- In every Gradle command: the refusal of the bundled SQLite driver, and
  the refusal of `core/testing` outside tests.

Why the release checks are named one by one:

- The two checks guard hard rules 1 to 4 in [CLAUDE.md](../../CLAUDE.md),
  and that Android's own backup and device transfer are off.
  They are described in [build.md](build.md#apk-rules-check) and
  [build.md](build.md#the-graphics-path-check).
- They run before every `assemble`, but `check` alone runs only the debug
  graphics-path check.
- Named by task, a check that is removed from the build makes Gradle fail
  with "task not found". A check that is turned off writes no report, and
  step 8 fails. Removing `registerApkRulesCheck()`, for example, makes
  Gradle fail with "Cannot locate tasks that match
  ':app:catalog:checkReleaseApkRules'".
- Naming the task builds the release APK, so R8 runs on every pull request
  too.

#### Released schemas

A schema file that a release shipped never changes, and is never
deleted. Otherwise an installed app could no longer open its database.
`checkRoomSchemas` cannot see this: it compares Room's output with the
files of the same commit, so a changed entity with its file recorded
again passes it
([data.md](../architecture/data.md#where-schemas-are-kept)). The step
"Check that no released schema changed" fails instead:

1. It fetches the commit and the tree of every tag from the repository,
   without file contents and without a token, into a copy of its own.
2. Release tags are the tags `<app>-v<version>`, such as `water-v1.0.1`,
   that a published release creates ([release.md](release.md)). Other
   tags are left out.
3. A schema file is a `.json` file in a `schemas/` folder under
   `android/`.
4. For each schema file of each release tag, the commit under test must
   have the same file, with the same object ID. The check names each
   file that is changed or deleted, and the tag it was released in.
5. It fails if it finds no schema file in any release tag, so it never
   passes by reading nothing.

It runs before Gradle and runs no project code: only `git`. It is part
of "Check", a required check, so it needs no rule of its own. A changed
schema needs a new version and a migration
([data.md](../architecture/data.md#how-to-change-a-schema)).

#### Trust patterns

Gradle can trust a key for a pattern of group names (`regex="true"` in
`verification-metadata.xml`), such as `^com[.]google($|([.].*))`. That
one would trust the key for Play services and Firebase too. A strict
build still passes with a pattern, because it only widens what is
trusted. So the file names each group, and the step "Check that no trust
uses a pattern" fails when:

1. any entry has `regex="true"`: a trusted key, one of its `trusting`
   lines, or an entry of `trusted-artifacts`;
2. an entry has no group. With a `name`, `version` or `file`, such as a
   key with only a `name`, Gradle trusts it for that name in every group,
   `com.google` included. With none of them, Gradle trusts nothing for a
   key such as `<trusted-key id="…"/>`, and refuses such an entry of
   `trusted-artifacts`. The step refuses both, so that the file says what
   it means. A key whose groups are all in its `trusting` lines is read
   by those lines;
3. the file has no trusted keys, so the step read the wrong layout.

It runs no project code: Python's standard library reads the file. How
to replace a pattern is in
[build.md](build.md#after-a-dependency-change), step 6.

The job takes about ten minutes.

### Job "Emulator"

Two jobs side by side, one for each Android version: "Emulator (Android
15)", the minimum, and "(Android 17)", the newest. Each runs the
instrumented tests of every module that has a folder `src/androidTest/`.
Today that is `core/crypto`, with the tests of the hardware keys,
`core/notify`, with the tests of the alarms, and `feature/notes`, with
the tests of Notes at its limits
([emulator-tests.md](emulator-tests.md)). One version that fails does not
stop the others.

Each job waits for "Gradle wrapper". Then:

1. It uses the JDK 21 of the runner, as "Check" does.
2. It checks that the system image is an AOSP image:
   `system-images;android-<level>;default;x86_64`. Any other name stops
   the job (hard rule 3).
3. It installs the two SDK packages the build pins, and for the emulator
   `platform-tools`, `emulator` and the system image. It writes the
   installed revisions into the log.
4. It lets the runner's user use KVM, with one udev rule. Without KVM an
   emulator is too slow to use.
5. It restores Gradle's downloads. It never saves them.
6. It builds the test APK of each module with instrumented tests:
   `./gradlew :<module>:assembleDebugAndroidTest`. Gradle does nothing
   else in this job. It does not start the emulator.
7. It makes an emulator with `avdmanager` and starts it with `emulator`,
   with no window, no sound and no saved state. Both tools are told the
   same folder for the emulator's files. It waits until Android has
   started, turns the animations off, keeps the screen on and unlocks
   it.
8. It installs each test APK with `adb` and runs it with
   `am instrument -w`. The project's own runner writes one line per test
   ([ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md)).
   - Before each test APK after the first, it waits until Android
     answers again: 10 seconds, and then until a broadcast and the
     package manager answer. On the Android 17 image Android starts
     again when a test APK's run ends
     ([emulator-tests.md](emulator-tests.md#android-17-the-job-waits-for-android)).
   - The wait has a limit of 5 minutes. If Android does not come back,
     the job fails and says after which tests.
   - The log says how long the job waited. If Android started again, the
     line is a warning that shows on the run's page, so a restart is
     never hidden.
9. `am instrument` ends without an error also when a test fails. So only
   the runner's last line counts: `INSTRUMENTED_TESTS_PASSED`. The job
   fails without it. It also fails if an installed test APK does not use
   the project's runner.
10. If anything failed, it prints the crashes from Android's log and the
    warnings from the emulator's own log, to read in the browser. It
    also uploads `emulator-logs-android-<version>`: the test output, the
    emulator's own log, Android's whole log and a picture of the screen.
    If Gradle could not verify a downloaded file while it built the test
    APKs, it uploads `dependency-verification-report-android-<version>`.

No action starts the emulator. The usual one,
`reactivecircus/android-emulator-runner`, is not one of GitHub's own
actions. The Android Gradle Plugin's Managed Devices are not used either:
they need artifacts that are not in the verification metadata (ADR 0028).

A job takes ten to fifteen minutes. About four go to the SDK packages,
the test APKs and the start of the emulator, and about one and a half
to the tests of `core/crypto` and `core/notify`. The rest goes to the
tests of Notes at its limits, which write and read hundreds of megabytes
([emulator-tests.md](emulator-tests.md#the-tests-of-notes-at-its-limits)).

### When CI fails

1. Open the pull request, tap the failed check, and read the open step.
   Lint and test failures are in its log.
2. A screenshot failure says "is changed". Go to the run's **Summary** and
   download **screenshot-differences**. Each `_compare.png` shows the
   committed image, the new one and their difference. Each `_actual.png` is
   the new image alone.
3. If the change was intended, Claude records the screenshots again with
   `./gradlew recordRoborazziDebug` and commits them.
4. An emulator failure names the Android version in the check's name.
   Open the step **Run the instrumented tests**. Each test has a line
   that starts with `OK`, `FAIL` or `SKIP`. A failed test has its stack
   trace above its `FAIL` line. If the run stops with "System has
   crashed", open the step **Collect the logs**: it shows the crash.
   More is in the run's **Summary**, under
   **emulator-logs-android-&lt;version&gt;**.
5. A step that stops with "Dependency verification failed" names the
   file, but not the reason. Go to the run's **Summary** and download
   **dependency-verification-report**. For an emulator job the name ends
   in `-android-<version>`. How to read it is in
   [build.md](build.md#when-verification-fails).
6. Ask Claude with prompt R1 in [PROMPTS.md](PROMPTS.md). Never weaken a
   check to make it pass (hard rule 9).

## PR preview

### Job "Find apps and screenshots"

It reads which files the pull request changes: the difference between the
test merge commit that GitHub makes and the tip of the base branch. It runs
no project code.

Which apps a pull request touches:

| The pull request changes | Preview built for |
|---|---|
| `android/app/<app>/...` | That app |
| `android/feature/<app>/...` | That app |
| `android/feature/<name>/...` with no app of that name | Every app |
| Anything else in `android/` (core modules, `build-logic`, Gradle files) | Every app |
| `.github/workflows/pr-preview.yml` | Every app, so a change to the workflow is tested |
| Anything else (docs, other workflows) | No app |

It copies every screenshot image the pull request adds or changes, from any
module's `src/test/screenshots/`, and uploads them as one zip,
`screenshots-pr<number>.zip`. A deleted image is not included. A file that
is not a plain file, such as a link, is skipped.

### Job "Build preview (app)"

One job per touched app, side by side:

1. Same JDK, SDK packages and download cache as CI. It only restores the
   cache, never saves it.
2. Builds the preview:
   `./gradlew :app:<name>:assemblePreview :app:<name>:checkPreviewApkRules :app:<name>:checkPreviewGraphicsPathUse`.
3. Uploads the unsigned APK and the build's list of it,
   `output-metadata.json`, both named after the app, as `unsigned-<app>`,
   kept for one day.

The preview is built from the test merge commit, so it shows the pull
request as it would be after merging.

### Job "Sign the previews"

One job for the whole run. It runs when at least one preview was built,
also when another failed. When none was built, because every build
failed or a newer push stopped them, it leaves a notice, makes no key and
ends, and the preview jobs are skipped. It checks out nothing and runs no
code from the pull request. It reads the APKs and their lists as data
only.

1. Installs only the build tools, for `apksigner` and `zipalign`, and
   downloads the unsigned APKs of the run into one folder.
2. Makes one throwaway RSA 4096 key, with a random password that is never
   printed.
3. For each app whose preview was built: checks every value it reads from
   the list, and that both the list and the APK itself, read with
   `aapt2`, name the app's own preview ID, `app.shkriuss.<app>.preview`,
   and that the APK asks for no shared user ID (`android:sharedUserId`)
   and declares no key sets for its updates (`<key-sets>`). So no APK can
   update another app's preview of the same run, or share its data, and
   no key but the run's can update it. Then it
   signs the APK with `apksigner`, checks the signature with
   `apksigner verify` and the alignment with `zipalign -c`.
4. Deletes the key. Nothing of it leaves the job: no artifact, cache or
   output.
5. Checks that every preview of the run has the same certificate.
6. Uploads the signed APKs as `signed-previews`, kept for one day, and
   hands each one's app ID, version, APK SHA-256 and certificate SHA-256
   to the next job.

Why a throwaway key: the plan says so (section 13), and
[ADR 0013](../adr/0013-signing-key-custody-and-rotation.md) keeps the suite
key in the `release` environment only. A pull request can change its own
workflow, so a preview job must never have a real key.

Why one key for the run: the apps of the suite take part in a handover
between apps only with apps signed with exactly their own certificate
([ADR 0041](../adr/0041-the-handover-between-apps.md), point 22). So the
previews of one run can give each other keys, and a preview never takes
part with a real app or with a preview of another run.

### Job "Preview (app)"

One job per app the run signed, side by side:

1. Takes its app's APK from `signed-previews` and checks it against the
   SHA-256 that "Sign the previews" handed over. An app whose build failed
   or was stopped has no APK: the job only leaves a notice, and the build
   job shows the result.
2. Uploads the APK as it is, not zipped, named
   `<app>-preview-pr<number>-<commit>.apk`.
3. Writes a summary with the link to tap, the APK's SHA-256 and the
   throwaway certificate's SHA-256.

Each job also hands the APK's artifact number to "Comment", as a tiny
`comment-data-<app>` file that is kept for one day. Job outputs cannot
carry it, because every app's job would overwrite the same output.

### Job "Comment"

The owner's decision. It keeps one comment on the pull request,
**Preview of this pull request**, with a direct link to each APK and to
the screenshots zip. It saves the owner three taps
([test-a-pull-request.md](test-a-pull-request.md)).

1. It has only `pull-requests: write`. It checks out nothing and runs no
   code from the pull request.
2. It runs after the preview jobs, also when one failed or none was
   needed. A failed app gets the line "no APK" with a link to the run.
3. It reads the app list from "Find apps and screenshots", which ran no
   code from the pull request. From the preview jobs, whose files the
   pull request's code made, it takes only one number per app, and only
   if it is a number. Every link is
   built from the run's own values.
4. It finds its earlier comment by a hidden marker and by its author,
   GitHub Actions, and updates it in place. It never edits anyone else's
   comment.
5. If a newer commit was pushed in the meantime, it does nothing. The
   newer run writes the comment.
6. A pull request that changes no app and no screenshot gets no new
   comment. An existing comment is updated to say so.
7. Pull requests from forks get a read-only token, so the job is skipped
   for them. If writing is refused anyway, as for Dependabot, the job only
   warns. The links are still in the job summaries.

## Protected paths

One job, "Flag owner-only paths". It runs on `pull_request_target`, so
GitHub always runs the copy of the workflow on `main`. It checks out
nothing and uses no action. It reads CODEOWNERS from `main` and the
pull request's changed files from the API. Then it adds the label
`protected-paths` and writes or updates one comment.

It runs when a pull request is opened or reopened, after every push, and
when the base branch changes. It is not a required check. The full
description, with what it protects against and what it does not, is in
[protected-paths.md](../security/protected-paths.md).

## Release

Started by hand on `main`. Four jobs: "Build", "Rebuild and compare",
"Sign" and "Draft release". What each does, and how to run a release from a
phone, is in [release.md](release.md). Why it works this way is in
[ADR 0013](../adr/0013-signing-key-custody-and-rotation.md) and
[ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md).

## Site

Four jobs: "Build", "Check the site", "Deploy tool" and "Deploy". Pull
requests run all but "Deploy", with no secrets. "Check the site" checks
out nothing and runs no project code. "Deploy" runs only on `main`, in
the `cloudflare` environment, and runs no project code. Its token may
only edit the one Worker of the site. What each job
does, the security headers, and how to set up Cloudflare from a phone are
in [site.md](site.md). Why it works this way is in
[ADR 0022](../adr/0022-hub-site-generator.md) and
[ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md).

## Dependency graph

The owner's decision on threat model point 4
([threat-model.md](../security/threat-model.md#code), CODE-3). GitHub
cannot read Gradle files by itself, so this workflow tells it which
libraries each app has. Dependabot alerts then name a library with a
known vulnerability.

It runs on every push to `main` that changes `android/`, the snapshot
script or the workflow, and by hand on `main`. Never on pull requests.
Two jobs:

| Job | Token | What it does |
|---|---|---|
| List | `contents: read` | Runs the tests of the snapshot script. Runs `./gradlew :app:<app>:dependencies --configuration releaseRuntimeClasspath` for every app in `android/app/`, with dependency verification on and no caches. Turns the reports into one snapshot with `tools/dependency-graph/snapshot.py`, and uploads it with its SHA-256. |
| Submit | `contents: write`, only to send | Checks out nothing and runs no code of the build. Checks the snapshot's SHA-256 and form, then sends it to GitHub's dependency submission API with `gh`. Its summary shows GitHub's answer and links to the alerts. |

What the snapshot holds: every library on each app's release runtime
class path, with what it needs, as Gradle resolved it. That is what ships
in the app, and a few more that R8 removes
([third-party.md](third-party.md#on-the-class-path-not-in-the-apk)).

What it does not hold, so no alert comes for it:

- the build tools, such as the Android Gradle Plugin and the Kotlin
  compiler, the test libraries, and the Gradle wrapper;
- the actions of the workflows. GitHub reads them itself, but gives no
  alert for an action pinned to a commit, and every action here is.

GitHub reads the lockfile of the site's deploy tool, Wrangler
(`.github/site-deploy/package-lock.json`), by itself, so its alerts come
without this workflow.

Not used, and why:

- GitHub's **Automatic dependency submission**. For Gradle it runs
  `actions/gradle-build-tools-actions`, which builds the project with
  dependency verification turned off
  (`-Dorg.gradle.dependency.verification=off`) and with a plugin that it
  downloads from the Gradle Plugin Portal. This project uses neither.
- Dependabot security updates and version updates. Their pull requests
  change versions without `verification-metadata.xml`, so CI fails them.
  Updates come from prompt R5 ([PROMPTS.md](PROMPTS.md)).

### Turn it on (owner, once)

These are repository settings, so only you can change them. The names
are the ones in GitHub's documentation. They can differ a little.

1. Open `github.com/shkriuss/shkriuss.app/settings` in the browser.
2. In the menu, under **Security and quality**, tap **Advanced
   Security**.
3. Under **Dependency graph**, tap **Enable**. Leave **Automatic
   dependency submission** at **Disabled**.
4. Under **Dependabot**, enable **Dependabot alerts**. Leave
   **Dependabot security updates**, **Grouped security updates** and
   version updates off.
5. Open `github.com/shkriuss/shkriuss.app/actions/workflows/dependency-graph.yml`.
   Tap **Run workflow**, leave the branch at `main`, and tap **Run
   workflow**. Pull the page down to reload it, and open the new run.
6. Wait until both jobs are green. The summary of "Submit" says
   "GitHub answered:" and then "SUCCESS" or "ACCEPTED".
7. Open `github.com/shkriuss/shkriuss.app/security/dependabot`. It lists
   the open alerts, or says there are none.

If "Submit" fails because the dependency graph is off, do step 3, then
step 5 again.

### Before every release

Step 4 of [Before and after a release](release.md#before-and-after-a-release)
asks that the newest run of this workflow is green, and that no alert is
open. If one is, tell Claude in a session which library it names. Claude
checks whether the library ships in the app, and updates it as prompt R5
does.

## The download cache

Gradle downloads about 950 MB: the Gradle distribution, the Android Gradle
Plugin, every library and Robolectric's Android image.

1. The cache holds `~/.gradle/caches/modules-2` and `~/.gradle/wrapper/dists`.
2. Its key is the hash of `gradle-wrapper.properties` and
   `verification-metadata.xml`. Every downloaded file is listed in the
   metadata, so a dependency change makes a new key.
3. Only CI on a push to `main` saves it. Pull requests only restore it.
   GitHub gives pull request runs their own cache space and never lets them
   change the cache of `main`. So a pull request cannot change what another
   run restores.
4. Gradle checks every file against the verification metadata when it uses
   it ([ADR 0020](../adr/0020-dependency-verification.md)).
5. It also means fewer downloads from Maven Central, which limits busy
   shared addresses (see [cloud-environment.md](cloud-environment.md)).
6. The release workflow uses no cache (plan section 13,
   [release.md](release.md)).

## Actions used

All are GitHub's own. No other action is used, so nothing needs to be
allowed in the repository settings. Protected paths uses no action at all.
Release uses the same commits of `checkout`, `upload-artifact` and
`download-artifact`, plus `attest`. Site and Dependency graph use the same
commits of `checkout`, `upload-artifact` and `download-artifact`, and no
other action.
Its deploy tool, Wrangler, is not an action: it is an npm package, pinned
with a lockfile ([ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md)).

| Action | Version | Commit | Used for |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | Getting the code |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | The APK, the screenshots, the screenshot differences, the dependency verification report, the emulator logs, the artifact numbers for the comment. In Release, the files passed between jobs. In Site, the built site. In Dependency graph, the snapshot |
| `actions/download-artifact` | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | The artifact numbers, in the comment job. In Release, the files from earlier jobs. In Site, the built site, in "Deploy". In Dependency graph, the snapshot, in "Submit" |
| `actions/cache/restore` and `actions/cache/save` | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | The download cache. Not used in Release |
| `actions/attest` | v4.2.2 | `1e69f48acb82d1966a394da916b4c1698aa569d6` | Release only: the build provenance attestation of the signed APK |

Each commit is the one its version's tag names in the action's own
repository. Only versions more than a month old are pinned, the same
habit as for Wrangler
([ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md)). The comment is
written with the GitHub CLI, `gh`, which GitHub's runners come with. Prompt R5 in
[PROMPTS.md](PROMPTS.md) updates them.

Not used, and why:

- `gradle/actions` (wrapper validation, Gradle setup and caching, and
  dependency submission): not GitHub's own. A shell step and
  `actions/cache` do the same. For dependency submission, Gradle's own
  `dependencies` task and a short script do it, with dependency
  verification on ([Dependency graph](#dependency-graph)).
- `actions/setup-java`: GitHub's own, but not needed. The runners already
  have JDK 21.
- `actions/attest-build-provenance`: GitHub's own, but since version 4 it
  only passes its inputs on to `actions/attest`. Release uses
  `actions/attest` directly.
- Third-party actions for signing or releases: not GitHub's own.
  `apksigner` and `gh` do the same in a few lines.

## What a pull request can do in these workflows

1. For CI and PR preview, the workflow file comes from the pull request
   itself. A pull request that changes one of them runs its own version.
   CODEOWNERS and the protected-paths flag make such a change visible. The
   flag tells you only after that run has started
   ([protected-paths.md](../security/protected-paths.md)).
2. Build code from the pull request runs on GitHub's runner, with a
   read-only token and no secrets. It cannot push, cannot change the cache
   of `main`, and cannot reach the release key. The two jobs that may write
   (comments and a label) run none of that code.
3. Release has no pull request trigger. A pull request can change its own
   copy of `release.yml`, and the **Run workflow** form can pick any
   branch. But every job stops unless the branch is `main` and the owner
   both started the run and started this attempt, and the `release`
   environment lets only `main` use its secrets. So a change to
   `release.yml` reaches the key only after the owner merges it.
4. Site deploys only from `main`. A pull request runs its own copy of
   `site.yml`, but only the jobs "Build", "Check the site" and "Deploy
   tool", which have no secrets. The `cloudflare` environment lets only `main` use its token. So
   a change to `site.yml`, to the generator or to the deploy tool reaches
   the token only after the owner merges it.
5. In CI and PR preview, pull requests from forks get a read-only token
   from GitHub anyway. The repository settings decide whether a first-time
   contributor's run needs the owner's approval. Protected paths gets a
   token that can write the label and the comment, also for forks. That is
   why it never runs anything from the pull request.
6. Dependency graph has no pull request trigger, and its job "List"
   stops unless the branch is `main`. A pull request that changes the
   workflow or the snapshot script runs nothing. The change runs only
   after the owner merges it.

## Required checks

The owner's decision: "Gradle wrapper" and "Check" must pass before a
pull request can be merged into `main`. A check can be added to the
ruleset by its name at any time. GitHub suggests only checks that have
run, though, and offers **GitHub Actions** as a check's source only once
the check has run recently. So a new check is added after its first run,
with its source set as the steps below say.

The names are the job names in `ci.yml`. A pull request that renames either
job must say so in its description, because the owner must then update the
rule. Otherwise every pull request waits for a check that never comes.

To require them, on a phone:

1. Open `github.com/shkriuss/shkriuss.app/settings/rules` in the browser.
2. Tap the ruleset that protects `main`.
3. Tick **Require status checks to pass**.
4. Tap **Add checks**. Type `Gradle wrapper` and pick it. Do the same for
   `Check`.
5. Next to each check, set the source to **GitHub Actions**, not "any
   source". Then a status that someone posts by hand through the API
   cannot stand in for it.
6. Leave **Require branches to be up to date before merging** off, unless
   you want every pull request to be updated after each merge.
7. Tap **Save changes**.

If `main` is protected by a branch protection rule instead of a ruleset:
open `github.com/shkriuss/shkriuss.app/settings/branches`, tap **Edit** on
the rule for `main`, tick **Require status checks to pass before
merging**, add the same two checks, and tap **Save changes**.

The preview jobs are not required. They run only when a pull request
touches an app, so a required preview would block every docs-only pull
request.

### The emulator jobs

The owner's decision:

- "Emulator (Android 15)" is a required check, set in the ruleset with
  the steps below. A red one blocks a merge.
- "Emulator (Android 17)" stays **not required**. Its system image
  crashes Android's own system process when a screen of the tests closes
  ([emulator-tests.md](emulator-tests.md#what-the-tests-showed), point
  3). The job keeps
  running on every pull request and every push to `main`. A red result
  is information, not a block.
- Whether "Emulator (Android 17)" becomes required is an open point
  with no date. The owner decides it when asking for it.

A pull request that renames one of the emulator jobs, or changes the
list of Android versions, must say so in its description. Otherwise
every pull request waits for a check that never comes.

To add the check, on a phone:

1. Open `github.com/shkriuss/shkriuss.app/settings/rules` in the browser.
2. Tap the ruleset that protects `main`.
3. Under **Require status checks to pass**, tap **Add checks**. GitHub
   lists only checks that have run, and the emulator jobs have.
4. Type `Emulator (Android 15)` and pick it. Do not add `Emulator
   (Android 17)`.
5. Next to it, set the source to **GitHub Actions**, not "any source".
6. Check the list. It must show three checks: "Gradle wrapper", "Check"
   and "Emulator (Android 15)".
7. Tap **Save changes**.

If `main` is protected by a branch protection rule instead of a ruleset:
open `github.com/shkriuss/shkriuss.app/settings/branches`, tap **Edit** on
the rule for `main`, add the same check, and tap **Save changes**.

If an emulator job fails with a fault of the emulator and not of the
tests, run it again with **Re-run failed jobs**. If it fails the same way
on several pull requests, tell Claude in a session. Do not take the check
out of the ruleset to get a merge through.

What a required check proves: that the jobs named "Gradle wrapper",
"Check" and "Emulator (Android 15)" passed, as the pull request's own copy of `ci.yml` defines them. A
pull request that changes `ci.yml` can change what they do. So read every
change to `.github/` yourself before you approve it.
