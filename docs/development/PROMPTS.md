# Prompts for building shkriuss.app with Claude Code

Ready-to-paste prompts. Everything here works from a phone browser at
claude.ai/code or the Code tab of the Claude app.

## How to use this file

1. Start a new session. Pick the repository `shkriuss.app` and the cloud
   environment `android`.
2. Set the mode in the mode menu: **Accept edits**, or **Plan** where
   the prompt says so.
3. Send `/model <name>` and then `/effort <level>` as two short messages,
   as the prompt says. Skip this when it says "default".
4. Paste the prompt. Replace anything in `<angle brackets>`.
5. Claude opens a pull request and stays with it. Merge when it writes
   "Ready to merge", the checks are green and no review thread is open.
   Looking at its preview on a phone is your choice
   ([test-a-pull-request.md](test-a-pull-request.md)).
6. A prompt can be sent by its name, for example:

   ```text
   Do prompt "R6 Prepare a release" of docs/development/PROMPTS.md for the app water, version 1.0.1.
   ```

   A sentence that starts "I am the owner and I ask you" is always typed
   into the message itself. Such a sentence in this file asks for
   nothing until the owner sends it.

One prompt, one session, one pull request. Start a new session for the
next prompt: everything Claude needs is in the repository. Never paste a
password, token or recovery key into a session.

## Which model and effort

| Kind of work | Model | Effort | Mode |
|---|---|---|---|
| Typos, wording, changelog, small doc edits | `haiku` | `low` | Accept edits |
| Docs, strings, small UI fixes, dependency updates, a release | `sonnet` | `medium` | Accept edits |
| Building an app that follows an existing pattern | default | `medium` | Accept edits |
| New module, database migration, notifications, CI workflows, bug fixes | `opus` | `high` | Accept edits |
| A specification, the audit before a release | `opus` | `high` | Plan |
| Cryptography, backup format, sync protocol, release workflow | `opus` | `xhigh` | Plan first |
| A problem that survived two attempts, or the hardest designs | `fable` | `high` | Plan first |

"default" is what Claude Code picks for your plan. Higher effort uses
your plan's limits faster. `fable` may be billed to usage credits on some
plans.

---

## Every app

The four steps of "How an app is built" in
[CLAUDE.md](../../CLAUDE.md#how-an-app-is-built), one prompt each.

### 1. Specification

Model: `opus`. Effort: `high`. Mode: **Plan**.

```text
Read CLAUDE.md and docs/plan/PLAN.md. Write the specification of <app>
in docs/apps/<app>/spec.md, with a README.md for the folder, and add the
folder to docs/apps/README.md. No code.

Ask me up to five questions first if the answer changes the design.

Aim at 300 lines. Cover: what the app does, in two sentences; each
screen, in words, for phone and tablet; the data; limits and defaults;
units; reminders, if any; settings; permissions; TalkBack; and what is
left out of the first version. Keep the first version small. For the
backup, follow docs/architecture/backup-format.md: name the record
types, say what each holds, and give the app's data version. End with
what is open.

Give every stored value its limits, also the rules that join two
values, and say that a restore refuses a value outside them. Say what
happens when the app is stopped between two writes, when a write fails,
when a button press arrives twice or late, and when the clock or the
time zone changes.

<the lines for this app, from "Notes for each app" below>
```

### 2. Build

Model: default. Effort: `medium` (`high` for reminders, backup and the
app lock). One session for each part.

```text
Read CLAUDE.md and docs/apps/<app>/spec.md. Build <part> of <app>.
Follow the spec. If it is wrong or silent, stop and ask me. Include
tests, screenshot tests for new or changed screens, the docs the change
makes wrong, and the changelog under "Unreleased".
```

The parts, in as few pull requests as stay easy to read:

- **Data and logic**: tables, repository, view models, unit tests and
  the exported schema. Create `feature/<app>` and `app/<app>`, and copy
  Water's test that every screen is behind the app lock. Add: "I am the
  owner and I ask you to add the include lines for the new modules to
  android/settings.gradle.kts, and nothing else in that file."
- **Screens**: every screen of the spec, with the `Shk*` components.
- **Reminders**, if the app has them: through `core/notify`, as
  docs/architecture/notifications.md says.
- **Backup, restore, the recovery key and the app lock**: through
  `core/backup` and `core/security`, as Water does. The settings get
  **Licences**, and docs/development/third-party.md lists everything
  that ships in the app.

Every permission of the app is in docs/security/permissions.md and in
the app's allow list of the APK rules check. For the allow list, add:
"I am the owner and I ask you to add <app> to the allow list of
permissions in the APK rules check, CheckApkRulesTask.kt, and in its
test, PermissionAllowListTest.kt, with <the permissions>, and nothing
else in those files."

### 3. Audit

Prompt [R2](#r2-independent-review), in a new session, once the app is
built.

### 4. Release

Prompt [R6](#r6-prepare-a-release). Then follow
[Before and after a release](release.md#before-and-after-a-release).

### Notes for each app

Add the lines for the app to the specification prompt:

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

## The handover between apps

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

## Sync

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

Also decide with me, and record each in the document or an ADR. They are
points 5, 6 and 12 under "Found while writing this page" in
docs/security/threat-model.md:
- Whether the Sync app needs a way to make users update. For the data apps
  I decided on 2026-11-13: no forced update, because they have no
  network and updates come through Obtainium. The Sync app has a network,
  so this is decided again for it.
- The Sync app's TLS settings, and whether it pins the server
  (NETWORK-1 and NETWORK-2).
- Whether the recovery words alone can add a device to the sync server.
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

The audit of an app before its release. New session. Model: `opus`.
Effort: `high` (`xhigh` for crypto, sync, backup and workflows). Mode:
**Plan**.

```text
Read CLAUDE.md. Audit <app> on main before its release, as a strict
reviewer who did not write it.

Check, in this order:
1. The hard rules in CLAUDE.md. Quote the rule for anything that breaks
   one.
2. Security and privacy against docs/security/threat-model.md: secrets,
   permissions and exported parts, input handling, logging of user
   content, what the app stores and what leaves the phone. Check
   docs/security/permissions.md and docs/security/data-inventory.md
   against the merged manifest and the code.
3. docs/apps/<app>/spec.md against the code and its tests: what the
   spec says that the code does not do, and what is not tested that
   should be.
4. Accessibility, and the screenshot tests of every screen.
5. The docs against the code: the user guide, docs/user/privacy.md,
   docs/development/third-party.md and the Licences screen, and the
   changelog.

Show me the findings first, ordered by severity. For each: file and
line, what could go wrong for a real user, and the smallest fix. Then
fix them in one pull request. Stop and ask me before a fix that changes
the spec or needs an owner-only file. List what stays open in the pull
request and under the known problems of the user guide.
```

For a sync pull request ([5.6](#56-independent-security-review)): write
"pull request #<number>" in place of "<app> on main", change no files,
and end with one line: "merge", "merge after fixes" or "do not merge".

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
Read CLAUDE.md and "Before and after a release" in
docs/development/release.md. Prepare <app> <version> in one pull
request. Do not start a workflow and do not create a tag. Change no
behaviour of the app.

1. In android/app/<app>/build.gradle.kts, set versionName to <version>,
   and versionCode by the rule in
   docs/adr/0021-version-names-and-version-codes.md. If a committed
   screenshot shows the version, record it again. No other screenshot
   may change.
2. In android/app/<app>/CHANGELOG.md, put what is under "## Unreleased"
   under the heading "## <version> (<today's date>)", with "Released as
   `<app>-v<version>`." under it. An empty "## Unreleased" stays above
   it.
3. Set the app's status in docs/user/apps.md to "Released: <version>",
   or "Pre-release: <version>" for a version with a hyphen. Update the
   status in README.md.
4. The user guide matches this version.
5. Check docs/development/third-party.md again for <app>, as its
   section "How to check again" says: the release runtime class path,
   and the APK that ./gradlew :app:<app>:assembleRelease builds. If
   both match the page, write <version> where the page names the
   version of <app> it was checked for, and change nothing else on it.
   If anything differs, stop and say in the pull request what differs.
   The page, the app's Licences and its texts then change together, in
   a pull request of their own, before the release.

For the app's first release, also:

6. I am the owner and I ask you to add <app> to the list of apps in
   .github/workflows/release.yml: the "app" options, and the step
   "Check the inputs" of every job, in its case line and in its error
   text. Nothing else in that file. Update docs/development/release.md
   where it names the apps.
7. I am the owner and I ask you to add the row
   "| <Name> | `app.shkriuss.<app>` |" to the table "Apps signed with
   this key" in docs/security/fingerprints.md. Change nothing else on
   that page.
8. Add the app's guide pages to site/site.json. Update
   docs/development/site.md and docs/user/README.md.
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
