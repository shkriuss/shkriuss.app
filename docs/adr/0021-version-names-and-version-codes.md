# 0021 Version names and version codes

- Status: Accepted
- Date: 2026-11-11
- Source: the owner's review of
  [pull request 9](https://github.com/shkriuss/shkriuss.app/pull/9)
  (Phase 0, step 6, the release workflow)

## Context

- Android installs an APK as an update only if its `versionCode` is higher
  than the installed app's. A lower or equal code is refused.
- Releases may be pre-releases, such as `1.0.0-rc.1`. People who install a
  pre-release must be able to update to the next pre-release, and to the
  final version.
- Release tags carry the version name: `<app>-v<version>`
  ([0014](0014-release-flow-and-reproducible-builds.md)).
- The owner has no computer and cannot run a tool to work out a code. A
  wrong code must be caught in the pull request, not during a release.
- Before this record, each app wrote any `versionCode` it liked. Catalog
  had `1`.

## Decision

1. A `versionName` has one of these forms:
   - `MAJOR.MINOR.PATCH`, for example `1.0.0`,
   - `MAJOR.MINOR.PATCH-alpha.N`, `-beta.N` or `-rc.N`, for example
     `1.0.0-rc.1`.

   MAJOR is 0 to 209. MINOR, PATCH and N are 0 to 99, and N starts at 1.
   No leading zeros. No other pre-release names, and no build metadata
   (`+...`).
2. The `versionCode` follows from it:

   `MAJOR × 10,000,000 + MINOR × 100,000 + PATCH × 1,000 + STAGE × 100 + N`

   STAGE is 1 for `alpha`, 2 for `beta`, 3 for `rc`, and 9 for a final
   version, which has N = 0.
3. Examples:

   | versionName | versionCode |
   |---|---|
   | `0.1.0` | 100900 |
   | `1.0.0-alpha.1` | 10000101 |
   | `1.0.0-beta.2` | 10000202 |
   | `1.0.0-rc.1` | 10000301 |
   | `1.0.0-rc.2` | 10000302 |
   | `1.0.0` | 10000900 |
   | `1.0.1` | 10001900 |
   | `1.1.0` | 10100900 |

4. Each app still writes both numbers in its `build.gradle.kts`. The build
   does not work out the code.
5. One script checks the rule:
   [`.github/scripts/check-version-code.sh`](../../.github/scripts/check-version-code.sh).
   - CI runs it for every app on every pull request and every push to
     `main`, with the version of the release APK that the job "Check"
     builds.
   - The release workflow runs it on the APK it releases, before the
     owner is asked to approve.
   - Either fails if the code is not the one the rule gives.
6. The release workflow accepts only these version forms as its `version`
   input.

## Options rejected

- **The build works out `versionCode` from `versionName`.** The owner chose
  the check instead, on pull request 9. It would have changed the
  owner-only `AndroidApplicationConventionPlugin.kt`.
- **Any semantic-version pre-release, such as `-preview` or `-1`.** Such
  names have no fixed order that fits into one number. The release
  workflow first accepted them, and now accepts only `alpha`, `beta` and
  `rc`.

## Consequences

- A higher version always has a higher code, in the same order as
  semantic versioning: `1.0.0-alpha.1` < `1.0.0-beta.1` < `1.0.0-rc.1` <
  `1.0.0-rc.2` < `1.0.0` < `1.0.1-alpha.1` < `1.0.1`. So `1.0.0-rc.2`
  updates `1.0.0-rc.1`, and `1.0.0` updates both.
- The highest code, for `209.99.99`, is 2,099,999,900. That stays below
  2,100,000,000, Google Play's limit, and below Android's own limit of
  2,147,483,647.
- Catalog's code changes from `1` to `100900`. No Catalog build was ever
  released, so no installed copy has a higher code.
- Preview and debug builds have the same code as the release of the same
  version. A preview has another package name (`.preview`), so it never
  updates or blocks the real app.
- A wrong code fails CI in the pull request that sets it. Claude works out
  the code when it prepares a release (prompt R6 in
  [PROMPTS.md](../development/PROMPTS.md)).
- More than 99 pre-releases of one stage, or a MINOR or PATCH above 99,
  need a new rule. A new rule must give every new version a higher code
  than every code already released. That needs a new record.
- The script lives in `.github/`, which is owner-only in
  [CODEOWNERS](../../.github/CODEOWNERS), like the workflows that call it.
