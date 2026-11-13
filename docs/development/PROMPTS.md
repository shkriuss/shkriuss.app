# Prompts for building shkriuss.app with Claude Code

Ready-to-paste prompts for every phase of `PLAN.md`. Everything here works
from a phone browser at claude.ai/code or the Code tab of the Claude app.

## How to use this file

1. Start a new session. Pick the repository `shkriuss.app` and the cloud
   environment `android`.
2. Set the mode in the mode menu. Use **Accept edits** unless the prompt says
   **Plan**.
3. Send `/model <name>` and then `/effort <level>` as two short messages. Each
   prompt lists both. Skip this when it says "default".
4. Paste the prompt. Replace anything in `<angle brackets>`.
5. When Claude is done: read its summary, open **Changes**, and comment on any
   line you want changed.
6. Select **Create PR**. Turn on **Auto-fix** in the pull request's menu if
   you want Claude to repair failing checks by itself.
7. In GitHub: wait for the checks, install the preview APK, look at the
   screenshots ([test-a-pull-request.md](test-a-pull-request.md)). Then
   approve and merge, or write what to change.

Rules of thumb:

- One prompt, one session, one pull request.
- Start a new session for the next prompt. Everything Claude needs is in the
  repository, not in the old chat.
- If a session gets long or confused, stop it and start a new one with the
  same prompt plus what is already done.
- Never paste a password, token or recovery key into a session.

## Which model and effort

| Kind of work | Model | Effort | Mode |
|---|---|---|---|
| Typos, wording, changelog, small doc edits | `haiku` | `low` | Accept edits |
| Docs, strings, small UI fixes, dependency updates | `sonnet` | `medium` | Accept edits |
| Normal feature work that follows an existing pattern | default | `medium` | Accept edits |
| New module, database migration, notifications, CI workflows, bug fixes | `opus` | `high` | Accept edits |
| Cryptography, backup format, sync protocol, release workflow | `opus` | `xhigh` | Plan first |
| Independent review of a finished pull request | `opus` | `high` | Plan |
| A problem that survived two attempts, or the hardest designs | `fable` | `high` | Plan first |

Notes:

- "default" is what Claude Code picks for your plan. On Pro and Max that is
  Opus at medium effort.
- `fable` may be billed to usage credits on some plans. Check before using it.
- Higher effort uses your plan's limits faster. `max` is rarely worth it.
- `opusplan` plans with Opus and writes with Sonnet. It is a good saver for
  large but routine features.

---

## Session 0: smoke test

Run this once, before Phase 0. Model: default. Effort: default.

```text
This is an environment check. Do not change project files except in step 6.

1. Run `check-tools` and report the Java and Gradle versions.
2. Report `echo $ANDROID_HOME` and list `$ANDROID_HOME/platforms` and
   `$ANDROID_HOME/build-tools`. If the SDK is missing, show
   `/var/log/android-sdk-setup.log`, run `install-android-sdk`, and report
   what happened.
3. In a temporary folder outside the repository, create the smallest possible
   Android app: latest stable Android Gradle Plugin, a Gradle wrapper for the
   version it needs, compile SDK 37, min SDK 33, one Kotlin activity and one
   Robolectric test. Run `./gradlew assembleDebug testDebugUnitTest`.
   Report success or the exact error, how long it took, and every host that
   was blocked or answered 429.
4. Report whether `/dev/kvm` exists (needed for an emulator).
5. Tell me which GitHub account your commits and pull requests come from.
6. Create the branch `claude/smoke-test`. Add one file `smoke-test.txt` with
   today's date. Push it and open a draft pull request titled
   "Smoke test (do not merge)". Give me the link.
7. Read CLAUDE.md and PLAN.md. List anything that is unclear, contradictory
   or impossible in this environment. Do not fix anything. Just list it.
```

Then check in GitHub:

1. The pull request author is the machine account, not you.
2. The merge button is blocked until you approve.
3. Close the pull request and delete the branch.

---

## Phase 0: Foundations

### 0.1 Repository skeleton

Model: default. Effort: `medium`.

```text
Read CLAUDE.md and PLAN.md first. This is Phase 0, step 1: the repository
skeleton. No Gradle files and no workflows yet.

Create:
- `.gitignore`, `.gitattributes` (LF line endings, images as binary) and
  `.editorconfig`.
- `README.md`: what the project is, status "early development", links to docs.
- `SECURITY.md`: report privately with GitHub's "Report a vulnerability".
  No email address unless I give one.
- `CONTRIBUTING.md`: short, points to `docs/development/`.
- `.github/CODEOWNERS`: owner-only paths are `.github/`, `CLAUDE.md`,
  `.claude/`, `android/gradle/verification-metadata.xml`,
  `android/gradle/wrapper/` and any signing config. The owner is @shkriuss.
- `.github/pull_request_template.md` with the four points from CLAUDE.md.
- Move `PLAN.md` to `docs/plan/PLAN.md` and `PROMPTS.md` to
  `docs/development/PROMPTS.md`. I am the owner and I ask you to add one line
  to CLAUDE.md that says where the plan is.
- The `docs/` folders from PLAN.md section 12, each with a short index page
  that says what belongs there.
- `docs/development/working-with-claude.md` and
  `docs/development/cloud-environment.md` from PLAN.md sections 13 and 15.
  Leave a marked place for the setup script; I will paste it in a review.
- `.claude/rules/` with short path-scoped rule files for `android/`,
  `backend/`, `docs/` and `.github/workflows/`.

Keep the root LICENSE as it is. Do not invent decisions. Where PLAN.md leaves
something open, write "Open" and list it in the pull request.
```

### 0.2 Decision records

Model: `sonnet`. Effort: `medium`.

```text
Read CLAUDE.md and docs/plan/PLAN.md. Write `docs/adr/template.md` and the
ADRs listed in PLAN.md section 18, one file each, numbered 0001 to 0018.

Each ADR has: status, date, context, decision, options rejected and why,
consequences. Use plain English and short sentences. Take the content from
PLAN.md. Do not add new decisions. If the plan does not say why something was
rejected, write "Reason not recorded" and list it in the pull request so I
can fill it in.
```

### 0.3 Gradle project and empty Catalog app

Model: `opus`. Effort: `high`.

```text
Read CLAUDE.md and docs/plan/PLAN.md. This is Phase 0, step 3: the Gradle
project with one empty app. I am the owner and I ask you to create the files
under `android/gradle/`, including the wrapper and verification metadata.

- `android/` with the Gradle wrapper (pinned version and
  `distributionSha256Sum`), `settings.gradle.kts` (repositories: google and
  mavenCentral only, project repositories forbidden), the version catalog and
  `gradle.properties`.
- `android/build-logic/` convention plugins: application, library, Compose,
  unit tests, screenshot tests. All module build config lives there.
  Warnings are errors.
- Modules `core/design` (a theme stub) and `app/catalog` (application ID
  `app.shkriuss.catalog`, one screen that says "Catalog").
- Min SDK 33, target and compile SDK 37. A preview build type with the
  application ID suffix `.preview`, as in PLAN.md section 13.
- No permissions at all. No dependency outside PLAN.md section 3.
- Dependency verification with sha256 and PGP. Commit the keyring and turn
  key servers off.
- The settings needed for byte-identical APKs across two clean builds. Say in
  the docs what you set and why.
- One unit test and Roborazzi screenshot tests for the Catalog screen: phone
  and tablet, light and dark, font scale 1.0 and 2.0.
- Settle the "to confirm" items in PLAN.md section 17 that this step touches.
  Record each answer in the right doc or ADR.
- Write `docs/development/build.md`. I am the owner and I ask you to correct
  the Commands section of CLAUDE.md if a command differs.

Before you push, run `./gradlew check verifyRoborazziDebug
:app:catalog:assembleDebug` and build twice to compare the APK hashes. If a
download is blocked or answers 429, stop and tell me. Do not add repositories.
```

### 0.4 Continuous integration and preview builds

Model: `opus`. Effort: `high`.

```text
Read CLAUDE.md, docs/plan/PLAN.md section 13 and `.claude/rules/`. I am the
owner and I ask you to add these workflow files.

- `.github/workflows/ci.yml`, on pull requests and on pushes to main:
  Gradle wrapper validation, `./gradlew check`, screenshot verification.
- `.github/workflows/pr-preview.yml`, on pull requests: build the preview APK
  of every app the pull request touches, sign it with a throwaway key made in
  the job, upload the APK and the screenshot images, and write a job summary
  that says in plain words where to tap to get them.
- An emulator job for instrumented tests on API 33 and the newest image.
  Add it only if an instrumented test exists. Otherwise write down the plan
  for Phase 1 and stop.

Rules for every workflow:
- Actions pinned to a full commit SHA with the version in a comment.
- `permissions: contents: read` at the top. More only per job, with a comment
  that says why.
- No secrets. No `pull_request_target`. A timeout and a concurrency group on
  every job. Inputs go through `env`, never straight into a shell line.
- Only GitHub's own actions are allowed in this repository today. If you need
  another one, list it in the pull request with the reason and the SHA, and I
  will allow it in the settings. Prefer a short shell step.

Find the simplest way to get a preview APK from a pull request onto a phone
using only a browser. Write it as numbered steps in
`docs/development/test-a-pull-request.md`.
```

### 0.5 Protected-paths flag

Model: `opus`. Effort: `high`.

```text
I am the owner and I ask you to add `.github/workflows/protected-paths.yml`.

Purpose: when a pull request touches an owner-only path from CODEOWNERS, add
the label `protected-paths` and one comment that lists those files, so I
notice on my phone. It never blocks a merge.

Requirements:
- It runs on `pull_request_target`, so the workflow file always comes from
  main. It must never check out, build or run code from the pull request.
- It reads the list of changed files through the GitHub API only.
- Permissions: `pull-requests: write` and nothing else.
- Treat file names as untrusted text. Never put them into a shell line.
- Update the comment in place when the pull request changes.

Explain in `docs/security/` what this flag protects against and what it does
not.
```

### 0.6 Release workflow

Model: `opus`. Effort: `xhigh`. Mode: **Plan** first, then Accept edits.

```text
Read CLAUDE.md and docs/plan/PLAN.md sections 13 and 15. I am the owner and I
ask for exactly this change: create `.github/workflows/release.yml`.

Show me the design first. Do not write files until I agree.

The flow:
1. I start it by hand on main with two inputs: app name and version. Check
   both strictly (a fixed list of app names, a semantic version). Pass inputs
   through `env`.
2. Job "build": no secrets, no caches. Builds the unsigned release APK.
3. Job "rebuild": a second clean build. Compare the two files byte for byte.
   Fail if they differ.
4. Job "sign": uses the `release` environment, so it waits for my approval.
   Sign with `apksigner` only. Write the keystore to a temporary file with
   private permissions and delete it in a trap. Never print a secret. Verify
   the result and compare the certificate SHA-256 with
   `docs/security/fingerprints.md`. Ask me for the fingerprint; it is public.
5. Add a build provenance attestation for the signed APK.
6. Create a draft release named `<app>-v<version>` with the APK and its
   SHA-256. Do not create a tag. I publish the draft myself.

Also:
- The secrets are named in PLAN.md section 13. Use only those.
- List every action that is not GitHub's own. Prefer none.
- Write `docs/development/release.md`: how I run a release from a phone, step
  by step, and a rehearsal with the Catalog app.
- Write ADRs 0013 and 0014 in full if they are still short.
- Tell me which parts you could not test here.
```

### 0.7 Hub website placeholder

Model: `sonnet`. Effort: `medium`.

```text
Read CLAUDE.md and docs/plan/PLAN.md. I am the owner and I ask you to add
`.github/workflows/site.yml`.

- `site/`: a static site built from `docs/` and `site/`. Pages: home, list of
  apps with status, how to install with Obtainium, how to verify with
  AppVerifier and the signing fingerprint, link to the source.
- No JavaScript, no external fonts, no analytics, no cookies. Strict security
  headers. Light and dark by system setting, same palette as PLAN.md
  section 9.
- A generator that is one pinned, checksum-verified download, or a tiny
  script in the repository. Say which you chose and why in an ADR.
- The workflow builds on pull requests without deploying. On main it deploys
  to Cloudflare using the `cloudflare` environment and its
  `CLOUDFLARE_API_TOKEN`. Pin the deploy tool to an exact version.
- Tell me which values that are not secret (for example the account ID) you
  need and where I should store them.
```

### Phase 0 gate (you, on the phone)

Done on 2026-11-11 with Catalog 0.1.0.

1. Run the release workflow for Catalog. Approve the signing step.
2. Publish the draft release.
3. Add the repository to Obtainium and install Catalog.
4. Check the certificate with AppVerifier against the hub page.
5. Open any pull request and confirm you get a preview APK and screenshots.

---

## Phase 1: Core

### 1.1 Design tokens and theme

Model: default. Effort: `medium`.

```text
Read CLAUDE.md and docs/plan/PLAN.md section 9. Build the base of
`core/design`:

- Colour, type, shape and spacing tokens exactly as in the plan. Light theme
  and true-black dark theme. No dynamic colour.
- `ShkTheme` and the six text styles. System font only.
- A unit test that computes the contrast of every text and background pair
  and fails under 4.5:1, and every outline pair under 3:1.
- Catalog pages for colours, type, shape and spacing.
- Screenshot tests: phone and tablet, light and dark, font scale 1.0 and 2.0.
- `docs/development/design-system.md` and ADR 0017.
```

### 1.2 Components

Model: default. Effort: `medium`. Run it once per batch.

```text
Read CLAUDE.md and docs/development/design-system.md. Add this batch of
`Shk*` components to `core/design`: <batch>.

For every component: a short KDoc that says when to use it, a Catalog page
with all states, a TalkBack label where it is interactive, a touch target of
at least 48dp, no clipped text at font scale 2.0, and screenshot tests in the
eight standard configurations. Only `core/design` may import Material 3.
```

Batches:

1. Buttons (filled, tonal, text, icon), floating action button, chips.
2. Text field, checkbox, switch, radio button, slider.
3. Card, list item, divider, section header, empty, loading and error states.
4. Top bar, navigation bar and rail that switch by window size, adaptive
   list-and-detail scaffold.
5. Dialog, bottom sheet, snackbar, menu, date picker, time picker.

### 1.3 Data base module

Model: `opus`. Effort: `high`.

```text
Read CLAUDE.md and docs/plan/PLAN.md sections 3, 5 and 7. Build `core/data`:

- Room on the system SQLite driver. No bundled SQLite.
- The record conventions: `id`, `createdAt`, `updatedAt`, `deletedAt`.
  Helpers so that every write sets `updatedAt` and deletes only mark.
- Clock and ID sources passed in through constructors, so tests control them.
- A "changed since" query pattern that sync can use later. Do not design
  sync here.
- Schema export and a migration test harness in `core/testing`, with one
  example migration and its test.
- `docs/architecture/data.md`.

I am the owner and I ask you to add the include lines for the new
modules to android/settings.gradle.kts, and nothing else in that file.
```

### 1.4 Cryptography

Model: `opus` (or `fable`). Effort: `xhigh`. Mode: **Plan** first. Three
sessions, one pull request each.

Session A, design only:

```text
Read CLAUDE.md and docs/plan/PLAN.md sections 6 and 10. Write
`docs/security/crypto-design.md` and complete ADRs 0006 and 0007. No code.

Cover: the key hierarchy from recovery key and device key down to record,
file and backup keys; the exact Tink primitives and parameters; nonce and key
ID handling; what is bound as associated data; the versioned byte layout of
every encrypted blob; key rotation; what happens when StrongBox is missing;
how the recovery key is shown and re-entered; test vectors.

Use only standard constructions that Tink provides. Do not invent any. End
with a list of every assumption and every open question for me.
```

Session B, after you approve the design:

```text
Read CLAUDE.md and docs/security/crypto-design.md. Implement `core/crypto`
exactly as designed. If the design is wrong or unclear, stop and tell me
instead of changing it.

Tests: items 1 to 8 of "What the tests must cover" in crypto-design.md:
known-answer vectors, round trips, tampering, truncation, wrong key,
wrong version, empty and very large inputs. No key material in logs, errors
or `toString`. No `javax.crypto` or Tink calls outside this module; add a
lint or test that enforces it.

Item 9 of that list, the emulator tests of the hardware keys, is not part
of this session. It is session C. Add no emulator job and no instrumented
test here.

Also not part of this session: the handover between apps (step 3.0), and
the recovery key screens and the QR code (step 1.7).

Create `docs/development/third-party.md` as crypto-design.md says: the
word list, and Tink and the four libraries it brings, each with its source,
its licence and its notice. Put the MIT licence text next to the word list.

I am the owner and I ask you to add Tink 1.24.0 and the four libraries it
brings to android/gradle/verification-metadata.xml and the keyring, and
nothing else in those files.

I am the owner and I ask you to add the include lines for the new
modules to android/settings.gradle.kts, and nothing else in that file.

I am the owner and I ask you to add one rule to the APK rules check, in
`CheckApkRulesTask.kt`, and nothing else in that file: the build fails if
an APK holds a class under `com.google.android.gms`. R8 can rename classes
in a release APK, so say how the rule still finds them. If the rule needs
another owner-only file, stop and tell me.
```

Session C, after session B is merged: the hardware key tests on an
emulator. Model: `opus`. Effort: `high`.

```text
Read CLAUDE.md, docs/security/crypto-design.md and
docs/development/emulator-tests.md. This is item 9 of "What the tests must
cover" in crypto-design.md: the tests of the four hardware keys on an
emulator.

I am the owner and I ask you to add the emulator job to
`.github/workflows/ci.yml`.

- The job as planned in emulator-tests.md: AOSP images only, no
  third-party action. Android 13, 14, 15 and the newest image.
- Instrumented tests in `core/crypto`: each kind of hardware key is made
  and used. After the screen lock is set, changed, removed and set again,
  each key is there or gone as the table "When things change" in
  crypto-design.md says. Test the system prompt too, if a test on an
  emulator can answer it.
- List what an emulator cannot check, such as StrongBox and a real
  fingerprint. Write those as numbered steps for my three devices.
- New test libraries need a decision record, a version catalog entry and
  verification metadata. If you need an owner-only file other than ci.yml,
  list it and stop before you change it.
- If Android does not behave as crypto-design.md says, stop and tell me.
  Do not change the design.
- Update emulator-tests.md, ci.md and the assumptions in crypto-design.md
  with what the tests showed.
```

### 1.5 Backup

Model: `opus`. Effort: `xhigh`. Mode: **Plan** first.

```text
Read CLAUDE.md, docs/plan/PLAN.md section 5 and
docs/security/crypto-design.md. Design and build `core/backup`.

First write ADR 0008 and `docs/architecture/backup-format.md` and show me.
Then implement: a versioned header, streaming authenticated encryption,
export and import only through the system file picker, and an interface that
each app implements to list and restore its records and files.

Tests: round trip, a file cut short, one changed byte, wrong recovery key, a
file from a newer format version, a very large file without loading it into
memory. Write the user guide page "Back up and restore".

I am the owner and I ask you to add the include lines for the new
modules to android/settings.gradle.kts, and nothing else in that file.
```

### 1.6 Notifications

Model: `opus`. Effort: `high`.

```text
Read CLAUDE.md and docs/plan/PLAN.md section 8. Build `core/notify`:

- Exact alarms with AlarmManager behind a small interface.
- Notification channels, the notification permission request, and a clear
  state when the user says no.
- Alarms registered again after reboot, app update, and time or time-zone
  change.
- Tests with a fake clock for all of the above.
- `docs/architecture/notifications.md` and a user page that explains what
  happens after a reboot before the first unlock, in Private Space, and in a
  secondary profile.
- Update `docs/security/permissions.md` for every permission and receiver.

I am the owner and I ask you to add the include lines for the new
modules to android/settings.gradle.kts, and nothing else in that file.
```

### 1.7 Recovery key screens and app lock

Model: `opus`. Effort: `high`. Two sessions, one pull request each.

Session A, the recovery key screens. Mode: **Plan** first.

```text
Read CLAUDE.md and docs/security/crypto-design.md, sections "The recovery
key", "The system prompt" and "StrongBox and other hardware". Build the
recovery key screens as a shared piece that every app uses.

First decide with me, before any code:
- The QR code: whether to build it now, what it holds, what draws it and
  what scans it. crypto-design.md has a proposal and the open points.
- The permission `USE_BIOMETRIC` for the system prompt: its decision
  record, and which owner-only files must change for it.
- Whether AndroidX Biometric is still needed anywhere (ADR 0003).
- Open questions 11 and 12 of crypto-design.md: how a user starts over
  after a setup that stopped half way, and what happens to a keyset file
  that is damaged while its hardware key lives.

Then build:
- Create a recovery key: show the 24 words, ask for four of them, then
  store the keys.
- Enter the words, with the word list and the checksum. No paste.
- Show the words again in a keeper app, after the system prompt.
- The security screen: which keys exist and their hardware level, whether
  the phone has a screen lock, and whether this app keeps the recovery key.
- Every one of these screens blocks screenshots and the recent-apps
  preview.
- Catalog page, screenshot tests, user guide page.
- Add the StrongBox check to docs/development/release-checklist.md, as
  crypto-design.md says.

I am the owner and I ask you to add the include lines for the new
modules to android/settings.gradle.kts, and nothing else in that file.
```

Session B, the app lock:

```text
Read CLAUDE.md and docs/security/crypto-design.md. Add the optional app lock
as a shared piece that every app can turn on:

- Unlock with the system biometric or device credential prompt.
- Turning it on follows "The app lock" in crypto-design.md: a recovery key
  first, four of the words again, and a plain warning about a removed
  screen lock and lost words. The user guide says the same.
- Lock after a time the user picks, and when the app leaves the screen if the
  user wants.
- File keys require user authentication as designed. Database rows are behind
  an access gate only; say so honestly in the user guide.
- An option to hide the app in the recent-apps view and block screenshots.
- Catalog page, screenshot tests, user guide page.

I am the owner and I ask you to add the include lines for the new
modules to android/settings.gradle.kts, and nothing else in that file.
```

### 1.8 Threat model

Model: `opus`. Effort: `high`. Mode: **Plan** first. It can run at any time
after step 1.4, session A.

```text
Read CLAUDE.md, docs/plan/PLAN.md section 10 and
docs/security/crypto-design.md. Write `docs/security/threat-model.md`. No
code.

Cover: what is protected; every attacker of section 10, what stops each one
and what does not; what is out of scope and why; what the app lock protects
and what it does not; what the sync server and the network can still learn;
the OWASP MASVS 2.1.0 controls of profile L2 and the privacy controls, each
with where it is met or why it does not apply; the resilience profile as
skipped on purpose.

Do not add decisions. Where something is not decided, write "Open". Update
docs/security/README.md, and the table "What the design protects" in
crypto-design.md if the two differ. End with every open question.
```

### Phase 1 gate (you)

The design part was done on 2026-11-12 with Catalog 0.2.0, on the Pixel
9 Pro, the Pixel Tablet and the Pixel 6a. It covers the tokens and
components of steps 1.1 and 1.2. The teal accent and the six text styles
stay as they are ([ADR 0017](../adr/0017-design-system-tokens.md)). The
rest of the gate waits for steps 1.3 to 1.7.

1. Install Catalog on the Pixel 9 Pro, Pixel Tablet and Pixel 6a.
2. Look at every page in light and dark, with large font, with TalkBack.
3. Write what you dislike as a comment. Use prompt R3 to change it.

---

## Phase 2: Water (pilot app)

### 2.1 Specification

Model: `opus`. Effort: `high`. Mode: **Plan**.

```text
Read CLAUDE.md and docs/plan/PLAN.md. Write the specification for the Water
app in `docs/apps/water/spec.md`. No code.

Ask me up to five questions first if the answer changes the design.

Cover: what the app is for in two sentences; every screen described in words
for phone and tablet; the data model; units; reminder behaviour (quiet hours,
snooze, missed reminders); settings; backup contents; permissions; TalkBack
notes; what is out of scope for version 1.0. Keep version 1.0 small.

For the backup contents, follow docs/architecture/backup-format.md: name the
record types, say what the content of each one holds, and give the app's
data version for a backup.
```

### 2.2 to 2.5 Build it

Model: default. Effort: `medium` (`high` for 2.4). One session each.

```text
Read CLAUDE.md and docs/apps/water/spec.md. Build step <n> of the Water app:
<step>. Follow the spec. If the spec is wrong or silent, stop and ask.
Include tests, screenshot tests for new or changed screens, docs and the
changelog.
```

Steps:

- 2.2 Data and logic: tables, repository, view models, unit tests, exported
  schema. Create `feature/water` and `app/water`. I am the owner and I ask
  you to add the include lines for the new modules to
  android/settings.gradle.kts, and nothing else in that file.
- 2.3 Screens: all screens from the spec with the `Shk*` components.
- 2.4 Reminders: through `core/notify`, with the permission flow. Follow
  docs/architecture/notifications.md: the app class is a `NotifyHost`
  and calls `Notify.start()`, the app names its alarms in an
  `AlarmSource`, shows the notification in an `AlarmHandler`, and calls
  `Notify.sync()` after every change. The reminder screen shows what
  `Notify.state` says. Water gets three permissions from `core/notify`.
  List them under Water in docs/security/permissions.md. Write the
  reminder steps of docs/development/emulator-tests.md with the app's
  real button names.
  - Before you paste this step: the APK rules check allows no permission
    today, and its files are owner-only. Add a sentence of your own
    here that asks Claude to allow the three permissions for Water in
    `CheckApkRulesTask.kt`, as the sentence in step 2.2 does for the
    include lines. Without it, Claude stops at the failing check.
- 2.5 Backup, restore, app lock and settings. The settings get a screen
  that shows the notices of all third-party material in the app. Complete
  `docs/development/third-party.md` with everything that ships in the app.
  For backup and restore, use `core/backup`: the screens call
  `Backups.export`, `Backups.check` and `Backups.restore`, and the app
  calls `Backups.start()` when it starts. Decide with me when a backup is
  checked.

### 2.6 Release preparation

Model: `sonnet`. Effort: `medium`.

```text
Prepare Water 1.0.0 for release. Do not start the release workflow.

- User guide in `docs/user/water.md`, written for a phone screen.
- `docs/security/permissions.md` and the data inventory are complete.
- `docs/development/third-party.md` lists everything that ships in the
  app, and the app shows those notices.
- `CHANGELOG.md` for the app.
- The reminder steps of `docs/development/release-checklist.md` (part 1,
  step 10), which are Open until now, as exact steps.
- `docs/apps/water/release-checklist-1.0.0.md`: a copy of
  `docs/development/release-checklist.md`, filled in for Water 1.0.0.
- Add Water to the hub site and to the release workflow's list of apps:
  the `app` options and the "Check the inputs" step of every job (I am the
  owner and I ask for exactly that change).
- List every known problem honestly.
```

### Phase 2 gate (you)

Work through the release checklist on the Pixel 9 Pro, check the layout on the
other two devices, use the app daily for two weeks, then run the release.

---

## Before Phase 3: the handover between apps

### 3.0 Handover

Model: `opus` (or `fable`). Effort: `xhigh`. Mode: **Plan** first.

```text
Read CLAUDE.md, docs/security/crypto-design.md (sections "Keeper apps and
other apps" and "Setting up a second app on the same phone") and ADRs 0005,
0006 and 0007. Design and build the handover: how a keeper app gives a
second app of the suite its own derived keys, and never the recovery key.

First write its decision record and show me. No code until I agree. Cover:
- The screen of the keeper that the asking app opens, and what the user
  sees and allows.
- The signature permission: which app defines it, what happens when the
  apps are installed in any order, and its entry in
  docs/security/permissions.md.
- How the keeper checks the caller's signing certificate itself.
- That the keys travel with no further encryption, and why that is enough.
  Confirm both, or tell me why not.
- How an app finds out which apps on the phone are keepers, for "keep it
  here too" and for "the recovery key is kept in ...".
- How an app that is not a keeper checks the paper copy before its app lock
  is turned on.
- What a preview build can and cannot do.
- Every way another app could try to get keys, and how each one fails.

Then build it with tests, update crypto-design.md and the user guide, and
tell me how to try it on a phone with two apps.

I am the owner and I ask you to add the include lines for the new
modules to android/settings.gradle.kts, and nothing else in that file.
```

---

## Phases 3, 4, 6, 7, 8 and 9: every further app

Use the Water prompts 2.1 to 2.6 with the app's name. Add these lines to the
specification prompt:

- **Reminders**: one-time and repeating reminders, snooze, time-zone changes,
  what happens to reminders missed while the phone was off.
- **Tasks**: lists, due dates, repeating tasks, optional reminder per task.
- **Notes**: plain text with simple formatting, attachments as encrypted
  files through the system picker, search.
- **Budget** and **Trades**: money as whole minor units, never floating
  point. Currencies. No network price data.
- **Meals**, **Repairs**, **Shelf**: photos as encrypted files, no camera
  permission (use the system camera or picker).
- **Calendar**: Georgian public holidays and Georgian Orthodox feasts
  computed on the device. Tests against published dates for 2020 to 2040.
  No network calendar accounts in version 1.0.
- **Drive** and **Photos**: streaming encryption for large files, encrypted
  thumbnails, import and export only through the system pickers, no storage
  permission. Model `opus`, effort `high`, and a storage design doc first.
- **Grammar**: read ADR 0011 first. Plan mode, `opus` at `xhigh` or `fable`.
  The Rust build, its supply chain and memory tagging tests need their own
  design doc and my approval before any code.

---

## Phase 5: Sync

### 5.1 Protocol design

Model: `fable` or `opus`. Effort: `xhigh`. Mode: **Plan**. No code.

```text
Read CLAUDE.md, docs/plan/PLAN.md sections 6, 7 and 10, and
docs/security/crypto-design.md. Write `docs/architecture/sync-protocol.md`
and complete ADRs 0005 and 0009.

Cover: device enrolment with the recovery key; device signing keys and how
the server checks them; the request and response formats; cursors and
sequence numbers; batching within the free-plan limits; file chunks; conflict
rules on the device; deletion markers and when they may be purged; replay,
rollback and reordering by a hostile server; lost and revoked devices; what
the server can still learn (sizes, timing, counts); format versioning.

The server stores only ciphertext and must never be trusted. End with a list
of attacks you considered and how each one fails, and every open question.
```

### 5.2 to 5.5 Build it

Model: `opus`. Effort: `high`. One session each.

```text
Read CLAUDE.md and docs/architecture/sync-protocol.md. Build step <n> of
sync: <step>. Follow the protocol document exactly. If it is wrong or silent,
stop and ask.
```

Steps:

- 5.2 `backend/`: the Worker with D1 and R2, tests that run locally, pinned
  dependencies with a lockfile, an AGPL-3.0 licence file, and a deploy
  workflow that uses the `cloudflare` environment (I am the owner and I ask
  for that workflow).
- 5.3 `core/sync-client`: change-set export and import, conflict rules,
  property tests with many random edit orders. I am the owner and I ask you
  to add the include lines for the new modules to
  android/settings.gradle.kts, and nothing else in that file.
- 5.4 `app/sync` and the signature-protected interface in Water. Only
  `app/sync` declares the network permission. I am the owner and I ask you
  to add the include lines for the new modules to
  android/settings.gradle.kts, and nothing else in that file.
- 5.5 `docs/self-hosting/`: deploy from a phone browser, upgrade, costs,
  limits, how to delete everything.

### 5.6 Independent security review

Use prompt R2 in a new session on each sync pull request before you merge it.

---

## Recurring prompts

### R1 Checks fail on a pull request

Model: default. Effort: `high`.

```text
The checks on pull request #<number> fail. Find the cause and fix the cause.
Never weaken or skip a check. If the check is right and the change is wrong,
say so. Push the fix to the same branch.
```

### R2 Independent review

New session. Model: `opus`. Effort: `high` (`xhigh` for crypto, sync, backup
and workflows). Mode: **Plan**.

```text
Review pull request #<number> as a strict reviewer who did not write it.
Do not change any files.

Check, in this order:
1. The hard rules in CLAUDE.md. Quote the rule for anything that breaks one.
2. Security against docs/security/threat-model.md: secrets, permissions,
   exported components, input handling, logging of user content.
3. Correctness and the tests: what is not tested that should be?
4. Accessibility and the eight screenshot configurations.
5. Docs and changelog.

Give me a list ordered by severity. For each finding: file and line, what
could go wrong for a real user, and the smallest fix. Then one line:
"merge", "merge after fixes" or "do not merge".
```

### R3 Change something you saw on the phone

Model: default. Effort: `medium`.

```text
In <app>, on the <screen> screen: <what you see>. I want: <what you want>.
Device: <Pixel 9 Pro / Pixel Tablet / Pixel 6a>, <light / dark>, font size
<normal / large>. Change it, update the screenshots, and tell me if this
should change the shared component instead of one screen.
```

### R4 Bug report

Model: `opus`. Effort: `high`.

```text
Bug in <app> <version> on <device>, GrapheneOS build <number>.
Steps: 1. <...> 2. <...>
Expected: <...>
Actual: <...>
First write a test that fails because of this bug. Then fix the cause. Tell
me the cause in two sentences and whether other apps share it.
```

### R5 Dependency and action updates (monthly)

Model: `sonnet`. Effort: `medium`.

```text
Check for updates to: the Gradle wrapper, the Android Gradle Plugin, Kotlin,
every library in the version catalog, every pinned action, and the hub site's
deploy tool, Wrangler, pinned in `.github/site-deploy/`. I am the owner and I
ask you to update the wrapper, the verification metadata, the action pins,
and the Wrangler pin and its lockfile as needed. For Wrangler, follow "Update
Wrangler" in docs/development/site.md.

One pull request per group that belongs together. For each update: read the
release notes, say what changed that matters to us, update the catalog and
the verification metadata together, and run all checks. Never trust a key or
checksum without saying where it comes from. Skip pre-releases.

After an Android Gradle Plugin update, try the build without the lint
suppression on `AlarmManagerScheduler.set` in `core/notify`, and remove it if
lint passes (ADR 0030, point 10).
```

### R6 Prepare a release

Model: `sonnet`. Effort: `medium`.

```text
Prepare <app> <version>. Bump versionName, and set versionCode by the rule
in docs/adr/0021-version-names-and-version-codes.md. Finish the changelog
from the merged pull requests since the last release, update the user guide, and copy
docs/development/release-checklist.md to
docs/apps/<app>/release-checklist-<version>.md, filled in for this version.
Do not start the release workflow and do not create a tag.
```

### R7 Explain a pull request

Model: `sonnet`. Effort: `low`. Mode: **Plan**.

```text
Explain pull request #<number> in plain language in under 200 words: what
changes for the user, what could go wrong, and exactly what I should test on
my phone.
```

### R8 When a session is stuck

```text
Stop. Do not widen the scope. Tell me what you tried, what failed, and the
options you see, with the one you recommend.
```
