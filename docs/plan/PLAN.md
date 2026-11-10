# shkriuss.app project plan

Agreed between the owner and Claude on 2026-11-10. This file is the source of
truth until Phase 0 turns each part into ADRs and docs. After that, the ADRs
and docs win and this file is kept as history.

## 1. Goal and hard constraints

- An open-source, self-hostable suite of native Android apps under
  `app.shkriuss.<name>`, built from shared core modules.
- GrapheneOS is the first target. Other Android systems come second.
- The owner has no computer. All work happens in a phone or tablet browser:
  Claude, the GitHub website and the Cloudflare dashboard.
- No Google Play services, Firebase, analytics, ads or trackers. No WebView.
- Local-first. Every app works fully with no account and no network.
- Owner's test devices: Pixel 9 Pro (main, memory tagging), Pixel Tablet
  (large screen), Pixel 6a (small screen, oldest hardware, second sync device).

## 2. Decisions

| # | Decision |
|---|----------|
| 1 | No Google developer registration for now. Stock Android users use the advanced flow. Revisit before the 2027 global rollout. |
| 2 | AndroidX, Compose and Kotlin libraries are allowed. "No Google" means no Google services. |
| 3 | System SQLite through Room. Database rows rely on Android's file-based encryption. Files, attachments, backups and sync data are encrypted by the app. No SQLCipher. |
| 4 | Data apps have no network permission. A separate Sync app does all networking. |
| 5 | One signing key for the whole suite, held in the GitHub `release` environment, with an encrypted backup. |
| 6 | Drive and Photos are encrypted on-device vaults with optional sync, not cloud-first products. |
| 7 | Grammar uses the Harper engine (Rust), on device, no language model. It is the only app with native code and is built last. |
| 8 | Minimum Android 13 (API 33). Target and compile SDK 37. |
| 9 | English first. Georgian later. All text in string resources from day one. |
| 10 | Licences: GPL-3.0 for apps, AGPL-3.0 for the backend. |
| 11 | Visual style: fixed palette, compact, rounded, true-black dark theme, teal accent. |
| 12 | Backup and restore to a file stays. No Cloudflare Access. The account is a recovery key plus per-device keys. |
| 13 | Distribution starts with GitHub Releases and Obtainium. |
| 14 | Pilot app is Water. |
| 15 | Claude works through a separate GitHub machine account with write access only (pending the smoke test). |
| 16 | No dependency-injection framework. |

## 3. Stack (versions checked November 2026; pin exact versions in Phase 0)

- Kotlin 2.4.x. Android Gradle Plugin, latest stable (9.5.1 on 2026-11-10),
  with the Gradle version it needs through the wrapper (9.6.0 worked in a
  test build). JDK 21.
- Jetpack Compose through the Compose BOM. Material 3 and its adaptive
  libraries. Navigation 3.
- Room 3.0.3 or newer with `AndroidSQLiteDriver` (system SQLite, no bundled
  native code). DataStore for settings.
- Tink for Java as the only cryptography library.
- kotlinx.coroutines and kotlinx.serialization.
- WorkManager in the Sync app only. AndroidX Biometric for app lock.
- Tests: JUnit, Robolectric, Roborazzi (JVM screenshots), Compose UI tests.
- Nothing else at runtime without an ADR.

Rejected: Java for new code, Kotlin Multiplatform, cross-platform toolkits,
XML views, Hilt, Koin, SQLCipher, the bundled SQLite driver,
EncryptedSharedPreferences (deprecated), libsodium, Argon2, Bouncy Castle,
Durable Objects, CRDT libraries, Google's Compose Preview Screenshot Testing
(still experimental).

## 4. Architecture

See `CLAUDE.md` for the rules. In short:

- `app` → `feature` → `core`. Features never depend on each other.
- Screen → ViewModel (one immutable state) → repository → Room.
- Only `core/design` touches Material 3 directly. Apps use `Shk*` components.
- `app/catalog` is a debug-only gallery of every component.
- `app/sync` is the only app with the network permission.

## 5. Data and formats

- Every record: `id` (random UUID), `createdAt`, `updatedAt`, `deletedAt`.
  Synced records are never hard-deleted.
- Database schema, backup format and sync protocol each carry a version
  number, a migration path and tests.
- Backup: one file in a place the user picks with the system file picker.
  A versioned header, then streaming authenticated encryption.
- Changing a format needs an ADR and readers for every older version.

## 6. Cryptography

- Device key: Android Keystore, StrongBox-backed where available, usable only
  while the device is unlocked. Optional app lock ties the key to user
  authentication.
- Tink: XChaCha20-Poly1305 for records, AES-GCM-HKDF streaming for files,
  HKDF for key derivation.
- Account: a random 256-bit recovery key shown as words and a QR code. All
  backup and sync keys derive from it. No passwords.
- Sync identity: a non-exportable signing key per device, checked by the
  server.
- All cryptography lives in `core/crypto` and is documented in
  `docs/security/crypto-design.md`.

## 7. Sync

- Courier model: each data app exposes a signature-protected interface that
  hands out encrypted change-sets and encrypted file streams. The Sync app
  moves ciphertext only.
- Server: one Cloudflare Worker, D1 for encrypted records with
  server-assigned sequence numbers, R2 for encrypted file chunks.
- Devices pull changes since a cursor and push batches. Conflicts are
  resolved on the device: last writer wins per record, with deletion markers.
- Free-plan limits to design for: 10 ms CPU per request, 100,000 requests a
  day, 100,000 D1 row writes a day.
- Each user deploys the backend to their own Cloudflare account from this
  repository.

## 8. Notifications

- Exact alarms through AlarmManager, only through `core/notify`.
- `USE_EXACT_ALARM` in Calendar, Reminders, Tasks and Water.
- Alarms are re-registered after reboot, app update and time-zone change.
- Reminder data stays in credential-encrypted storage, so nothing fires
  between a reboot and the first unlock. An opt-in mode that keeps only times
  and a generic title available before unlock may be added later.
- A locked Private Space stops its apps. Secondary profiles deliver
  notifications only while running. Document both.

## 9. Design system

- Fixed palette. No dynamic colour.
  - Light: background `#FFFFFF`, surfaces `#F3F4F2` and `#E7E9E6`, text
    `#131514`, secondary text `#4A4F4C`, outline `#7A807C`, accent `#00695C`.
  - Dark: background `#000000`, surfaces `#0D0E0E` and `#191B1A`, text
    `#ECEEEC`, secondary text `#A9AEAA`, outline `#6F7571`, accent `#5FD6C2`,
    text on accent `#00201B`.
  - Status colours (light / dark): error `#B3261E` / `#FFB4AB`, success
    `#1B6E3C` / `#7FDB9A`, warning `#7A5800` / `#F2C24B`.
  - Checked: every text pair is at least 5.1:1, outlines at least 3.3:1.
- Shape: pill buttons, 12dp fields, 16dp cards, 28dp sheets and dialogs.
- Compact density: 4dp grid, 16dp margins on phones, 24dp on tablets, 14sp
  body text. Touch targets stay at least 48dp.
- True black: raised surfaces use a lighter grey plus an outline, not shadows.
- System font, six text styles, no bundled fonts.
- Adaptive app icons with a monochrome layer.

## 10. Security and privacy

- Baseline: OWASP MASVS 2.1.0 at profile L2 plus the privacy controls. The
  resilience profile (anti-tampering, obfuscation) is deliberately skipped.
- Threat model to write in `docs/security/threat-model.md`:
  - Protects: records and files, recovery key, device keys, signing key,
    release pipeline.
  - Defends against: lost or stolen device, other apps on the device, network
    attackers, a compromised or curious sync server, malicious dependencies
    or CI actions, takeover of GitHub, Cloudflare or the domain, unsafe
    changes by an AI agent.
  - Out of scope: a compromised OS, an unlocked phone in an attacker's hands,
    a malicious keyboard or accessibility service, coercion, traffic analysis
    of sync timing and sizes.

## 11. Accessibility

WCAG 2.2 level AA as applied to mobile. 48dp touch targets, contrast 4.5:1
for small text and 3:1 for large, TalkBack labels, font scale 2.0, automated
Compose accessibility checks in emulator tests, a manual TalkBack pass per
release.

## 12. Documentation

- `docs/user/` install and verify, one guide per app, backup, sync setup.
- `docs/self-hosting/` deploy, upgrade, costs.
- `docs/security/` threat model, crypto design, permissions, data inventory,
  fingerprints, how to report a problem.
- `docs/architecture/` modules, schemas, backup format, sync protocol.
- `docs/adr/` one short file per decision.
- `docs/development/` build, test, release, design system, cloud environment,
  working with Claude, prompts.
- The hub site is built from these files.

## 13. Build, CI and release

- GitHub Actions is the authoritative build. Claude Code's cloud environment
  is the fast loop for compiling, unit tests, lint and screenshots.
- Cloud environment `android`: network access Custom with `dl.google.com`,
  `keys.openpgp.org` and `pgp.mit.edu` plus the default list (Gradle asks
  these key servers, and `keyserver.ubuntu.com`, when it writes PGP
  verification metadata); variables `ANDROID_HOME=/opt/android-sdk`,
  `BASH_DEFAULT_TIMEOUT_MS=600000`, `BASH_MAX_TIMEOUT_MS=1800000`; the setup
  script installs the Android SDK and a cloud-only Gradle init script that
  asks Google's public mirror of Maven Central first. No secrets there.
  Keep a copy of the script in `docs/development/cloud-environment.md`.
- The cloud environment cannot run an emulator (no KVM) and holds no keys.
  Emulator tests, signing and releases run only in GitHub Actions.
- Actions are pinned to full commit SHAs. Workflow tokens are read-only by
  default. There are no repository-level secrets, only environment secrets.
- Planned workflows: `ci`, `pr-preview` (installable preview APK plus
  screenshots on every pull request), `protected-paths` (flags pull requests
  that touch workflows, signing, dependency verification), `release`, `site`,
  later `backend`.
- Preview builds use the application ID suffix `.preview` and a throwaway
  key, so they install next to the real app.
- Release flow:
  1. The owner starts the `release` workflow on `main`.
  2. A job with no secrets builds the unsigned APK.
  3. A second job rebuilds and compares, to prove reproducibility.
  4. A signing job in the `release` environment waits for the owner's
     approval, then signs with apksigner only and verifies the result.
  5. The workflow attaches a build attestation and creates a draft release.
  6. The owner publishes the draft. That creates the tag. Releases are
     immutable.
- `release` environment secrets: `SIGNING_KEYSTORE_B64`,
  `SIGNING_KEYSTORE_PASSWORD`, `SIGNING_KEY_ALIAS`. Key: RSA 4096,
  `CN=shkriuss.app`, alias `shkriuss`.
- `cloudflare` environment secret: `CLOUDFLARE_API_TOKEN`.
- Key rotation uses signature scheme v3.1 (Android 13 and later). Rehearse
  restore and rotation with a throwaway key before the first public release.
- Tag format: `<app>-v<version>`, for example `water-v1.0.0`.

## 14. Distribution

- Now: GitHub Releases with Obtainium. Users verify the certificate with
  AppVerifier against the fingerprints on the hub.
- Later: IzzyOnDroid, an F-Droid-format repository on a subdomain, the main
  F-Droid repository through its reproducible-build route, Accrescent when it
  reopens to new apps.

## 15. Who can do what

- Owner account `shkriuss`: admin. Reviews and merges every pull request,
  approves every release, publishes every release, holds all settings.
- Machine account for Claude: write access only. Opens branches and pull
  requests. Cannot merge without the owner, cannot create tags, cannot read
  secrets, cannot change settings.
- Claude has no Cloudflare access and no access to the signing-ceremony
  repository.
- Rules that enforce this: `main` needs a pull request with one approval and
  approval of the latest push (the owner may bypass for the owner's own pull
  requests only); only the owner may create tags; secrets live only in
  environments limited to `main`; the `release` environment needs the owner's
  approval.
- What the machine account can still do: push branches (including workflow
  files, which then run without secrets), start workflows on `main`, and
  create draft releases. The owner publishes only the draft that the release
  workflow just made. A file not signed with the suite key fails the
  fingerprint check and cannot update an installed app.

## 16. Roadmap

Each phase ends at a gate the owner checks on real devices.

0. Foundations. Gate: an empty Catalog app builds reproducibly in CI, is
   signed, and installs through Obtainium. Every pull request gives a preview
   APK and screenshots.
1. Core: design system, data, crypto, backup, notifications. Gate: Catalog
   approved on all three devices; backup round-trip and alarm tests pass.
2. Water (pilot). Gate: GrapheneOS checklist below, TalkBack pass, two weeks
   of daily use, docs complete, release 1.0.
3. Reminders, then Tasks.
4. Notes.
5. Sync: backend, Sync app, self-hosting guide. Gate: three devices stay
   consistent through offline edits and conflicts.
6. Budget, Meals, Repairs, Shelf, Trades.
7. Calendar (Georgian public and Orthodox holidays, computed on device).
8. Drive, then Photos.
9. Grammar.

GrapheneOS checklist for every release (Pixel 9 Pro unless noted):

- Hardened memory allocator on, memory tagging on.
- Dynamic code loading via memory and via storage restricted.
- Native code debugging blocked. WebView JIT restricted.
- Network permission revoked (data apps declare none anyway).
- Sensors permission revoked.
- Works in a secondary user profile and in Private Space.
- Layout check on Pixel Tablet and Pixel 6a.
- Reminders fire on time with the screen off, after reboot and unlock.

## 17. To confirm in Phase 0

- Exact compile SDK (37.0 or later minor) that AGP and Robolectric support.
  In a test build, `compileSdk = 37` with `platforms;android-37.0` and
  `build-tools;36.0.0` worked.
- Roborazzi rendering with the current Robolectric Android image. In a test,
  Robolectric 4.17 ran a test on its Android 17 image with JDK 21 only after
  adding the test JVM flags `--add-opens=java.base/java.io=ALL-UNNAMED` and
  `--add-exports=java.base/jdk.internal.access=ALL-UNNAMED`. Check whether
  both are still needed and whether a newer release removes the need.
- Maven Central answered "429 Too Many Requests" several times from the
  shared cloud address. The cloud-only mirror init script avoided it. Never
  add the mirror to the project's own repositories.
- Commit the dependency verification keyring and turn key servers off, so
  builds never contact a key server. Pin the wrapper with
  `distributionSha256Sum`.
- Room 3 transactions with `AndroidSQLiteDriver`.
- Tink artifact choice, and that no Play services provider is ever used.
- Code scanning setup for Kotlin.
- Static site generator for the hub: a single pinned binary, no client-side
  JavaScript.
- The simplest way to get a preview APK from a pull request onto a phone.
- That a draft release works with the tag rules, and the owner can publish.
- `sdkmanager` is deprecated in favour of the Android CLI; switch when ready.
- That the Cloudflare token works with the deploy tool.
- Which third-party actions are needed, so the owner can allow them in
  repository settings (Claude cannot change settings).
- Licence wording: "GPL-3.0-only" or "GPL-3.0-or-later".

## 18. First ADRs to write

0001 record architecture decisions · 0002 GrapheneOS-first, minimum Android 13 ·
0003 Kotlin, Compose, Material 3, Navigation 3 · 0004 Room on system SQLite,
no SQLCipher · 0005 no network permission in data apps, separate Sync app ·
0006 Tink and the key hierarchy · 0007 recovery key instead of passwords ·
0008 backup file format · 0009 sync protocol and server · 0010 exact alarms
and reminder storage · 0011 no native code, Grammar exception · 0012 no DI
framework · 0013 signing key custody and rotation · 0014 release flow and
reproducible builds · 0015 distribution channels · 0016 no developer
registration with Google for now · 0017 design system tokens · 0018 licences.
