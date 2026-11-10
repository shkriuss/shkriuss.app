# 0020 Dependency verification

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 10 and 17, hard rule 5 in
  [CLAUDE.md](../../CLAUDE.md), and the owner's prompt for Phase 0, step 3
  ([PROMPTS.md](../development/PROMPTS.md))

## Context

- The threat model defends against malicious dependencies (section 10).
- Every build downloads Gradle, its plugins and every library from public
  repositories. A changed file there would end up in a signed APK.
- Hard rule 5 says a dependency change always updates
  `android/gradle/verification-metadata.xml` in the same pull request.
- Section 17 asks to commit the keyring, turn key servers off so builds
  never contact one, and pin the Gradle wrapper with
  `distributionSha256Sum`.
- Key server lookups failed now and then in the cloud environment in
  Phase 0.

## Decision

1. Gradle's dependency verification is on, in strict mode, with SHA-256
   checksums and PGP signatures
   (`--write-verification-metadata sha256,pgp`).
2. A signed file must be signed by a trusted key. A file that is not signed
   must match its SHA-256 checksum.
3. The public keys are committed in
   `android/gradle/verification-keyring.keys`. Key servers are turned off
   in `verification-metadata.xml`. A normal build never contacts a key
   server.
4. The Gradle wrapper is pinned to one version with `distributionSha256Sum`.
5. Downloads come from Google's Maven repository and Maven Central only.
   Modules may not declare repositories.
6. Verification is never turned off or made lenient to make a build pass
   (hard rule 9).

## Options rejected

- **Checksums only.** They protect against a changed file, but every new
  version needs a new checksum taken on trust. A signature ties the file to
  its publisher's key.
- **Signatures only.** Many files are not signed, for example older
  AndroidX releases. They need checksums.
- **Fetching keys from key servers in every build.** Builds would depend on
  key servers being up, and a key server could hand out a different key.
- **Robolectric's own downloader for its Android image.** It downloads the
  image at test time, outside Gradle, so verification never sees it.

## Consequences

- The keys and checksums were recorded from the first download on
  2026-11-10. That is trust on first use. Nothing was checked by hand.
- Every new dependency, and every version change, needs new entries in the
  same pull request. The steps are in
  [build.md](../development/build.md#after-a-dependency-change).
- Robolectric's Android image is resolved by Gradle and checked like any
  other file. Robolectric runs offline.
- `build-logic` cannot use the `kotlin-dsl` plugin, because it is only on
  the Gradle Plugin Portal. It uses `java-gradle-plugin` and the Kotlin JVM
  plugin instead. See [build.md](../development/build.md#repositories).
- The wrapper's checksum comes from Gradle's version list on
  `services.gradle.org`. The cloud environment blocks `downloads.gradle.org`,
  where the `.sha256` files live.
- `verification-metadata.xml`, `verification-keyring.keys`,
  `gradle/wrapper/`, and both `settings.gradle.kts` files, which hold the
  repositories, are owner-only ([CODEOWNERS](../../.github/CODEOWNERS)).
  The keyring and the settings files were added by the owner's decision on
  [pull request 5](https://github.com/shkriuss/shkriuss.app/pull/5).
