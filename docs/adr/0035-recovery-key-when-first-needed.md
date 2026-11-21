# 0035 The recovery key comes when it is first needed

- Status: Accepted
- Date: 2026-11-13
- Source: Phase 2, step 2.1, the specification of Water
  ([spec.md](../apps/water/spec.md#the-recovery-key-when-first-needed)).
  The owner decided on 2026-11-13 that Water opens straight on Today and
  creates the recovery key only when it is first needed, and that this
  is the pattern for every later app. The owner asked what the user sees
  at that moment and what Settings shows before it. Claude proposed the
  details in
  [pull request 36](https://github.com/shkriuss/shkriuss.app/pull/36),
  and the owner accepted them in the review of that pull request, on
  2026-11-13.

## Context

- Every app works fully with no account and no network
  ([plan](../plan/PLAN.md), section 1).
- The recovery key is the account
  ([0007](0007-recovery-key-instead-of-passwords.md)). A backup, the app
  lock, and later sync need the keys derived from it. Records and files
  do not: until the app has a recovery key, files use a random key on
  this phone
  ([crypto-design.md](../security/crypto-design.md#the-file-key-keyset-without-a-recovery-key)).
- Creating the key takes a few minutes: the user writes 24 words on
  paper and confirms four of them
  ([crypto-design.md](../security/crypto-design.md#creating-it)).
- `core/security` has the screens to create, enter and show the key,
  the security screen, and the app lock screen
  ([security-screens.md](../architecture/security-screens.md)).
- The app lock screen already says why it cannot be turned on with no
  recovery key, with a button to the security screen.

## Decision

For every app of the suite:

1. **First start.** The app opens on its main screen, with defaults. No
   welcome screen and no setup. Nothing outside the app's settings
   mentions the recovery key.
2. **What the settings show before it.**
   - The backup section starts with a note, not a button: "Backups are
     locked with a recovery key. You set it up when you make your first
     backup." After a setup that stopped: "Finish setting up your
     recovery key to make backups."
   - The security section shows "Recovery key" with "Not set up",
     "Setup not finished" or "Set up", and "App lock" with "Off" or
     "On".
   - "Make a backup" and "Restore a backup" stay enabled.
   - "Recovery key" always opens the security screen, where the key can
     be created at any time.
3. **The moment it is needed.** When the user starts something that
   needs the key and the app has none, one dialog shows before anything
   else. In three forms:
   - **Make a backup, or the app lock**: "Set up your recovery key
     first", a short reason, and **Create a recovery key**, **I already
     have one** (enter the words) and **Not now**.
   - **Restore a backup**: "Enter your recovery key first", with **Enter
     the words** and **Cancel** only. A new key cannot open an old
     backup.
   - **A setup that stopped**: "Finish your recovery key", with **Open
     the security screen** and **Not now**.
4. **Go on after.** When the flow ends with the keys stored, the app goes
   on with what the user started, without another tap. When the user
   leaves the flow, nothing else happens.
5. **One dialog for all apps.** `core/security` builds the dialog, its
   words and the "go on after" once. An app passes which form it needs
   and what to do after.
6. Later moments, such as setting up sync (Phase 5), use the same
   dialog with their own short reason.

## Options rejected

- **A short welcome screen at the first start**, with the goal, the
  unit, and "Create a recovery key" or "Not now". Reason not recorded.
- **The recovery key before anything else.** Reason not recorded.

## Consequences

- A user who never makes a backup and never turns on the app lock never
  sees the 24 words. If that phone is lost, the data is lost. The user
  guide of each app says so, and says to make a backup.
- Step 2.5 builds the dialog in `core/security`, with its page in
  Catalog and its screenshot tests, and Water's settings use it.
- The handover between apps (step 3.0) may add a fourth choice to the
  dialog: take the keys from a keeper app on the phone. That step
  decides it.
- Water is the first app that follows this record
  ([spec.md](../apps/water/spec.md#the-recovery-key-when-first-needed)).
