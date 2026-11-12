# 0006 Tink and the key hierarchy

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 3), 3, 6, 10
  and 17, and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4).
  Completed on 2026-11-12 in Phase 1, step 4
  ([PROMPTS.md](../development/PROMPTS.md)) with the owner's decisions in
  the planning session of that step and on
  [pull request 22](https://github.com/shkriuss/shkriuss.app/pull/22).
  The detail is in [crypto-design.md](../security/crypto-design.md).

## Context

- Files, attachments, backups and sync data are encrypted by the app
  (decision 3).
- The suite uses no Google Play services (section 1).
- The threat model protects records and files, the recovery key and the
  device keys. It defends against a lost or stolen device, other apps on
  the device, network attackers, and a compromised or curious sync server
  (section 10).
- Out of scope: a compromised OS, an unlocked phone in an attacker's hands,
  a malicious keyboard or accessibility service, coercion, and traffic
  analysis of sync timing and sizes (section 10).
- Sync and reminders must go on while an app is locked and while the
  phone is locked. The owner asked for this on 2026-11-12.
- No phone setting may destroy files. The owner asked for this on
  2026-11-12.
- Android's reference warns that keys made with
  `setUnlockedDeviceRequired(true)` are deleted on Android 12 to 14 when
  the screen lock is removed, and cannot be made there without a screen
  lock. Android 15 fixed this.
- A key that needs a system prompt for every use must be given to the
  prompt as a cipher object. Tink's Keystore helper keeps its cipher to
  itself.

## Decision

1. Tink for Java is the only cryptography library. The artifact is
   `com.google.crypto.tink:tink-android`, version 1.24.0. It brings Gson,
   JSR-305, Error Prone annotations and `annotation-jvm` with it. They
   are accepted as they come.
2. All cryptography lives in `core/crypto`. It is documented in
   [crypto-design.md](../security/crypto-design.md), and the code follows
   that page exactly.
3. Device keys: each installed app has up to four AES-256-GCM keys in the
   Android Keystore, backed by StrongBox where available, else by the
   TEE. They wrap keysets only.
   - **Background key.** Usable whenever the app runs. It wraps the
     record keyset.
   - **Unlocked key.** Usable only while the device is unlocked. It wraps
     the backup keyset and, while the app lock is off, the file-key
     keyset. It exists on Android 15 and later. On Android 13 and 14 the
     Background key takes its place.
   - **Lock key.** Needs the system prompt for every use. It exists while
     the app lock is on and wraps the file-key keyset.
   - **Recovery guard.** Needs the system prompt for every use, with the
     app lock on or off. It wraps the kept recovery key.
4. The optional app lock ties the file keys to user authentication: one
   prompt, one Keystore operation, one unlock. The prompt accepts a
   fingerprint or the device credential. It is Android's own
   `BiometricPrompt`, not the AndroidX Biometric library. The record
   keyset and the backup keyset are not behind the prompt, so sync and
   reminders go on while the app is locked.
5. The app lock can be turned on only after the app has keys derived
   from a recovery key. Adding files needs no recovery key.
6. Primitives, all from Tink:
   - XChaCha20-Poly1305 for records that leave the database for sync. Each
     record is sealed on its own, so the server stores one opaque blob per
     record. The same primitive seals file keys.
   - AES-GCM-HKDF streaming (`AES256_GCM_HKDF_1MB`) for files, attachments
     and the backup file.
   - HKDF-SHA256 for key derivation, through Tink's `KeysetDeriver`, with
     one label per app and purpose.
7. Rows at rest in the local database are not encrypted by the app. See
   [0004](0004-room-on-system-sqlite-no-sqlcipher.md).
8. Account: a random 256-bit recovery key. The record keyset, the backup
   keyset and the file-key keyset derive from it, per app. See
   [0007](0007-recovery-key-instead-of-passwords.md).
9. Files: each file content has its own random key and is encrypted once.
   The same ciphertext is on the device, on the server and on every other
   device. The file key is stored sealed by the file-key keyset, and
   travels in that sealed form in the file's record and in a backup.
10. Every encrypted blob starts with `SHK`, a version byte and a kind
    byte. These bytes and the ID of the record or file are bound as
    associated data. Nonces come only from Tink and the Keystore.
11. `core/crypto` calls Android directly, and not through Tink, in five
    places: the AES-256-GCM cipher of a key that needs the prompt, in the
    same byte layout as Tink's Keystore helper; reading a key's security
    level; SHA-256 for the checksum of the recovery words; listing the
    app's hardware keys; and asking whether one hardware key exists.
12. No Play services provider: `core/crypto` refuses to work if a
    provider named `GmsCore_OpenSSL` is installed, and the APK rules
    check refuses any class under `com.google.android.gms`.
13. A phone with a software-only Keystore is allowed, with a clear
    notice.
14. Sync identity: a non-exportable signing key per device, checked by the
    server.

Point 3 first read: "kept in the Android Keystore, backed by StrongBox
where available, and usable only while the device is unlocked." The owner
changed it twice on 2026-11-12: the record keyset is also usable while
the device is locked, and on Android 13 and 14 the Background key stands
in for the Unlocked key.

Point 11 first read "in three places". The owner added the last two on
2026-11-12, in step 1.4, session B. Tink's helper cannot list keys. And
its `hasKey` also answers "no" when the Keystore only failed for a
moment, read in the source of Android 13 and 14. A living key would then
count as lost. The list has the same weakness, so it is never taken as
proof that a key is gone. See
[crypto-design.md](../security/crypto-design.md#where-android-does-the-work-not-tink).

## Options rejected

- **libsodium.** A C library.
- **Argon2.** C code in practice. It is also not needed, because there is
  no password to stretch.
- **Bouncy Castle.** Large and not needed. Tink covers everything the
  project uses.
- **EncryptedSharedPreferences.** It is deprecated.
- **Hand-written file encryption.** The project never invents
  constructions. Tink's streaming encryption is used.
- **The plain `tink` artifact.** It depends on an HTTP client and on
  `conscrypt-openjdk-uber`, which holds native libraries.
- **Tink's `AndroidKeysetManager`.** It stores keysets in shared
  preferences, and it cannot use a key that needs the prompt for every
  use.
- **Tink's `serializeEncryptedKeyset` for wrapped keysets.** It adds a
  copy of the key types and IDs in the clear, and it hides the IV that
  the prompt needs before decrypting. The same encryption is done with
  Tink's AEAD over Tink's binary keyset.
- **One device key for everything.** Either sync would stop while an app
  is locked, or file keys would not be behind the prompt.
- **A time window after any unlock for the app lock.** It needs no direct
  Keystore call. But unlocking the phone itself also opens the window, so
  the tie to the app's own prompt is loose. The owner chose one prompt
  per unlock.
- **Two encryptions for files**, one for the device and one for sync.
  Every upload and download would be encrypted again, and an interrupted
  upload of a large file would start again. The owner chose one
  encryption with a key per file.
- **Every key usable only while the device is unlocked.** Records that
  arrive would wait until the next unlock, so a reminder made on another
  device would not ring on a phone that stayed locked.
- **`setUnlockedDeviceRequired(true)` on Android 13 and 14.** Removing
  the screen lock would delete the key, and with it the file keys of a
  user with no recovery key.
- **A warning instead of a rule for the app lock.** The owner decided
  that a warning is not enough: no phone setting may destroy files.
- **The AndroidX Biometric library for the prompt.** With minimum
  Android 13, Android's own prompt takes a cipher with fingerprint or
  device credential. The library adds support for older versions, which
  is not needed, and needs a `FragmentActivity`, which the apps do not
  have.

## Consequences

- No `javax.crypto` or Tink calls outside `core/crypto`
  ([CLAUDE.md](../../CLAUDE.md)).
- No new constructions. Only the ones documented in
  [crypto-design.md](../security/crypto-design.md) (CLAUDE.md).
- Database rows, and the keys that open records, are available whenever
  the app runs. On Android 15 and later, backup and, with the app lock
  off, files need an unlocked phone. The kept recovery key always needs
  the prompt, and with the app lock on, files need it too.
- On Android 13 and 14 the hardware does not refuse the backup keyset
  and, with the app lock off, the file keys while the phone is locked.
  This matters only against someone who breaks Android itself, which is
  out of scope.
- Removing the screen lock deletes the Lock key and the Recovery guard.
  With the app lock off, nothing else happens. With it on, the app's
  files stay closed until the recovery words are entered.
- A user with the app lock on who removes the screen lock and has lost
  the recovery words cannot open that app's files on that phone. The
  owner accepted this on pull request 22. The app-lock screen and the
  user guide must say so plainly.
- A file key that is sealed by a key that exists only on one phone never
  leaves that phone. Backup and sync of files start only after the file
  keys are sealed by a recovery-key-derived key.
- A keyset file under a hardware key can be the only way to a user's
  files. crypto-design.md has the rules for making, replacing and losing
  a hardware key. A key is never made again because an operation failed.
- For a key that needs the prompt, associated data is given to the
  cipher only after the prompt succeeds. Tink's helper does it earlier,
  which is one more reason it cannot be used for these keys.
- Sealing file keys again in the database needs a `RecordWriter`
  function of its own
  ([0027](0027-record-fields-and-stamping.md), point 8).
- Session B added the dependency, its version catalog entry and its
  verification metadata, the rule in the APK rules check, and the unit
  tests listed in crypto-design.md. A unit test, `CryptoBoundaryTest`,
  enforces the first consequence above.
- The behaviour of the four keys is proven by emulator tests on Android
  13, 14, 15 and the newest. They are the step after session B (step
  1.4, session C), because they need the emulator job in the CI
  workflow. StrongBox is checked on the owner's three devices.
  - Session C built the job and the tests
    ([0028](0028-instrumented-tests-own-runner-and-shell-steps.md)). They
    pass on Android 13, 14, 15 and 17, and Android behaved as
    crypto-design.md says
    ([emulator-tests.md](../development/emulator-tests.md#what-the-tests-showed)).
- Showing the system prompt needs the permission `USE_BIOMETRIC`. The
  step that first shows a prompt writes its decision record.
- The backup format (0008) and the sync protocol (0009) build on the
  blobs of crypto-design.md and add no cryptography of their own.
- Open: the points listed under "Open questions" in
  [crypto-design.md](../security/crypto-design.md#open-questions). Those
  that touch this record are the permission for the system prompt, the
  use of AndroidX Biometric elsewhere (step 1.7), and the sync signing
  key (Phase 5).
