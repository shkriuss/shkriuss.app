# Continuous integration

The GitHub Actions workflows that check every pull request, and the one
that makes releases. GitHub Actions is the authoritative build (section 13
of the [plan](../plan/PLAN.md),
[ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md)). Set up in
Phase 0, step 4. Release was added in Phase 0, step 6.

| Workflow | File | Runs on | What it does |
|---|---|---|---|
| CI | [`ci.yml`](../../.github/workflows/ci.yml) | Every pull request, every push to `main` | Checks the Gradle wrapper. Runs unit tests, lint, screenshot verification and the release rules checks. |
| PR preview | [`pr-preview.yml`](../../.github/workflows/pr-preview.yml) | Every pull request | Builds and signs a preview APK of every app the pull request touches. Uploads it and the changed screenshots. Keeps one comment on the pull request with the links. |
| Protected paths | [`protected-paths.yml`](../../.github/workflows/protected-paths.yml) | Every pull request, as `pull_request_target` | Labels a pull request `protected-paths` and keeps one comment listing its owner-only files, by CODEOWNERS on `main`. Never blocks a merge. |
| Release | [`release.yml`](../../.github/workflows/release.yml) | By hand, on `main` | Builds an app twice and compares the builds. Signs it after the owner's approval, attests it and creates a draft release. See [release.md](release.md). |

How to install a preview on a phone is in
[test-a-pull-request.md](test-a-pull-request.md). Emulator tests are not set
up yet. The plan is in [emulator-tests.md](emulator-tests.md). What the
protected-paths flag protects against, and what it does not, is in
[protected-paths.md](../security/protected-paths.md).

Still to come (plan section 13): `site`, and later `backend`.

## Rules every workflow follows

The full list is in `.claude/rules/workflows.md`. In short:

1. Every action is pinned to a full commit SHA, with its version in a
   comment.
2. Only GitHub's own actions are used. Everything else is a short shell
   step.
3. The token is read-only (`permissions: contents: read`). A job that needs
   more says why in a comment. Four jobs do. "Comment" in PR preview has
   `pull-requests: write` and nothing else. "Flag owner-only paths" in
   Protected paths has `pull-requests: write`, and `contents: read` only to
   read CODEOWNERS through the API. In Release, "Build" adds `checks: read`
   to read the commit's CI results, and "Draft release" has
   `contents: write`, `id-token: write` and `attestations: write` to make
   the attestation and the draft. It checks out nothing.
4. No secrets, except in Release: one step of its job "Sign" gets the three
   secrets of the `release` environment. No `pull_request_target`, except
   in Protected paths, which never checks out, builds or runs anything from
   the pull request.
5. Every job has a timeout and a concurrency group. A new push to a pull
   request cancels the older run. Protected paths and Release are the
   exceptions: their runs wait for each other, so a run never stops
   half-way through writing.
6. Values from the event, from files and from earlier steps reach a shell
   only through `env`. File names are matched against fixed patterns and
   never run.
7. Checkouts do not keep the token on disk (`persist-credentials: false`),
   so the build cannot read it.

The workflows are owner-only ([CODEOWNERS](../../.github/CODEOWNERS)). Their
shell steps live inside the workflow files, not in `tools/`, so that a
change to them always needs the owner's review.

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

1. It uses the JDK 21 that GitHub's Ubuntu runners come with.
2. It installs the SDK packages the build pins: `platforms;android-37.0`
   and `build-tools;36.0.0`. Keep them in step with `ShkBuild.kt` and the
   cloud setup script ([cloud-environment.md](cloud-environment.md)).
3. It restores Gradle's downloads (see [The download cache](#the-download-cache)).
4. It finds every app: a folder in `android/app/` with a build file.
5. It runs one Gradle command:
   `./gradlew check verifyRoborazziDebug`, plus, for every app,
   `:app:<name>:checkReleaseApkRules` and
   `:app:<name>:checkReleaseGraphicsPathUse`.
6. It checks that both release checks wrote their report for every app.
7. If anything failed, it uploads the screenshot differences, if there
   are any.
8. On `main`, it saves the downloads for later runs.

Why the release checks are named one by one:

- The two checks guard hard rules 2, 3 and 4 in [CLAUDE.md](../../CLAUDE.md).
  They are described in [build.md](build.md#apk-rules-check) and
  [build.md](build.md#the-graphics-path-check).
- They run before every `assemble`, but `check` alone runs only the debug
  graphics-path check.
- Named by task, a check that is removed from the build makes Gradle fail
  with "task not found". A check that is turned off writes no report, and
  step 6 fails. Both were tried in the cloud environment: removing
  `registerApkRulesCheck()` failed with "Cannot locate tasks that match
  ':app:catalog:checkReleaseApkRules'".
- Naming the task builds the release APK, so R8 runs on every pull request
  too.

With nothing cached, the Gradle command took 3 minutes 43 seconds on
GitHub's runner on 2026-11-11, and 4 minutes 35 seconds in the cloud
environment.

### When CI fails

1. Open the pull request, tap the failed check, and read the open step.
   Lint and test failures are in its log.
2. A screenshot failure says "is changed". Go to the run's **Summary** and
   download **screenshot-differences**. Each `_compare.png` shows the
   committed image, the new one and their difference. Each `_actual.png` is
   the new image alone.
3. If the change was intended, Claude records the screenshots again with
   `./gradlew recordRoborazziDebug` and commits them.
4. Ask Claude with prompt R1 in [PROMPTS.md](PROMPTS.md). Never weaken a
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

### Job "Preview (app)"

One job per touched app, side by side:

1. Same JDK, SDK packages and download cache as CI. It only restores the
   cache, never saves it.
2. Builds the preview:
   `./gradlew :app:<name>:assemblePreview :app:<name>:checkPreviewApkRules :app:<name>:checkPreviewGraphicsPathUse`.
3. Makes a throwaway RSA 4096 key in the job, with a random password that
   is never printed.
4. Signs the APK with `apksigner`, then deletes the key.
5. Checks the signature with `apksigner verify` and the alignment with
   `zipalign -c`.
6. Uploads the APK as it is, not zipped, named
   `<app>-preview-pr<number>-<commit>.apk`.
7. Writes a summary with the link to tap, the APK's SHA-256 and the
   throwaway certificate's SHA-256.

Why a throwaway key: the plan says so (section 13), and
[ADR 0013](../adr/0013-signing-key-custody-and-rotation.md) keeps the suite
key in the `release` environment only. A pull request can change its own
workflow, so a preview job must never have a real key.

The preview is built from the test merge commit, so it shows the pull
request as it would be after merging.

Each job also hands the APK's artifact number to "Comment", as a tiny
`comment-data-<app>` file that is kept for one day. Job outputs cannot
carry it, because every app's job would overwrite the same output.

### Job "Comment"

The owner's decision on
[pull request 6](https://github.com/shkriuss/shkriuss.app/pull/6). It keeps
one comment on the pull request, **Preview of this pull request**, with a
direct link to each APK and to the screenshots zip. It saves the owner
three taps ([test-a-pull-request.md](test-a-pull-request.md)).

1. It has only `pull-requests: write`. It checks out nothing and runs no
   code from the pull request.
2. It runs after the preview jobs, also when one failed or none was
   needed. A failed app gets the line "no APK" with a link to the run.
3. It reads the app list from "Find apps and screenshots", which ran no
   code from the pull request. From the preview jobs, which did, it takes
   only one number per app, and only if it is a number. Every link is
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
`download-artifact`, plus `attest`.

| Action | Version | Commit | Used for |
|---|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | Getting the code |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | The APK, the screenshots, the screenshot differences, the artifact numbers for the comment. In Release, the files passed between jobs |
| `actions/download-artifact` | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | The artifact numbers, in the comment job. In Release, the files from earlier jobs |
| `actions/cache/restore` and `actions/cache/save` | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | The download cache. Not used in Release |
| `actions/attest` | v4.2.2 | `1e69f48acb82d1966a394da916b4c1698aa569d6` | Release only: the build provenance attestation of the signed APK |

The commits were read from the actions' own repositories on 2026-11-10 and
2026-11-11. Each version was more than a month old then. `actions/attest`
v4.2.2 is from 2026-08-04. The comment is
written with the GitHub CLI, `gh`, which GitHub's runners come with. Prompt R5 in
[PROMPTS.md](PROMPTS.md) updates them.

Not used, and why:

- `gradle/actions` (wrapper validation, Gradle setup and caching): not
  GitHub's own. A shell step and `actions/cache` do the same.
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
   branch. But every job stops unless the branch is `main`, and the
   `release` environment lets only `main` use its secrets. So a change to
   `release.yml` reaches the key only after the owner merges it.
4. In CI and PR preview, pull requests from forks get a read-only token
   from GitHub anyway. The repository settings decide whether a first-time
   contributor's run needs the owner's approval. Protected paths gets a
   token that can write the label and the comment, also for forks. That is
   why it never runs anything from the pull request.

## Required checks

The owner's decision on
[pull request 6](https://github.com/shkriuss/shkriuss.app/pull/6): "Gradle
wrapper" and "Check" must pass before a pull request can be merged into
`main`. The owner turns this on after their first green run, because GitHub
suggests only checks that have run.

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

What a required check proves: that the jobs named "Gradle wrapper" and
"Check" passed, as the pull request's own copy of `ci.yml` defines them. A
pull request that changes `ci.yml` can change what they do. So read every
change to `.github/` yourself before you approve it.
