# 0032 The settings of the app lock in Android's preferences file

- Status: Proposed
- Date: 2026-11-13
- Source: Phase 1, step 7, session B
  ([PROMPTS.md](../development/PROMPTS.md)). The owner decided it in
  that session, before any code, and asked that this record makes no
  promise about DataStore.

## Context

- The app lock has three settings of its own: when the app locks after
  it left the screen, whether every window blocks screenshots, and
  whether notifications show their text while the app lock is on
  ([security-screens.md](../architecture/security-screens.md#settings)).
- Whether the app lock is on is not a setting. Only the `file-key`
  keyset file says that ("The app lock" in
  [crypto-design.md](../security/crypto-design.md), rule 5).
- [0004](0004-room-on-system-sqlite-no-sqlcipher.md), point 4, says
  that settings use DataStore.
- DataStore is not in the version catalog. Adding it is a new
  dependency: a decision record, a catalog entry, and changes to
  `android/gradle/verification-metadata.xml` and its keyring, which are
  owner-only (hard rules 5 and 6 in [CLAUDE.md](../../CLAUDE.md)).
- CLAUDE.md asks to prefer the platform and the libraries already in the
  catalog.
- `core/notify` already keeps its own small state in Android's
  `SharedPreferences` ([0030](0030-how-core-notify-keeps-alarms.md),
  point 3).
- No app builds its own settings yet. Water is the first, in Phase 2.

## Decision

1. The three settings of the app lock live in Android's own
   `SharedPreferences`: one small file, `app.shkriuss.core.security`, in
   the app's private storage. No library is added.
2. The file holds no user content and no key, only the three values.
   Like every file of the app's private storage, it is in no backup and
   in no Android backup.
3. Only `core/security` reads and writes it, through the class
   `AppLockSettings`.
4. Point 4 of 0004 is decided again when the first app builds its own
   settings. This record makes no promise about what that decision is.

## Options rejected

- **Add DataStore now.** A new dependency and owner-only changes for
  three values that one module reads. The owner chose to decide the
  settings of the apps when the first app has some.
- **Store the settings as records.** They are about this phone, not
  about the user's data, and must not travel by sync or backup. A
  setting on one phone, such as "block screenshots", says nothing about
  another phone.

## Consequences

- An app that uses `core/security` gets the file when the user first
  changes a setting of the app lock.
- [0004](0004-room-on-system-sqlite-no-sqlcipher.md), point 4, has this
  exception until the first app's own settings decide again.
- A restore does not bring the settings of the app lock back. The app
  lock itself is not in a backup either
  ([backup.md](../user/backup.md)).
