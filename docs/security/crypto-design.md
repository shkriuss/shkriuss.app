# Cryptography design

Every key the apps use, where it lives, what it protects, and the exact
bytes of everything the apps encrypt. All cryptography in the suite
follows this page.

- Status: built. The design was written on 2026-11-12 in Phase 1, step
  4, session A ([PROMPTS.md](../development/PROMPTS.md)). The owner
  decided most of its open questions on
  [pull request 22](https://github.com/shkriuss/shkriuss.app/pull/22).
  Session B built the code and its unit tests from this page on the same
  day. The owner decided three more points then, and the page was made
  exact where it was silent
  ([Decided in session B](#decided-in-session-b)).
- Session C tested the hardware keys on emulators with the real Android
  Keystore, on the same day
  ([emulator-tests.md](../development/emulator-tests.md#what-the-tests-showed)).
  What an emulator cannot show is a list of steps for the owner's three
  devices
  ([emulator-tests.md](../development/emulator-tests.md#steps-for-the-three-devices)).
- Step 1.7, session A, on 2026-11-13: starting over after a setup that
  stopped, repairing a damaged keyset file, and giving up file keys that
  no words can bring back, with fixes to the code of session B
  ([Decided in step 1.7, session A](#decided-in-step-17-session-a)).
  The code came first, in its own pull request. The recovery key screens
  followed in a second one, in `android/core/security`
  ([security-screens.md](../architecture/security-screens.md)).
- Step 1.7, session B, on 2026-11-13: the app lock screens, in
  `android/core/security`
  ([security-screens.md](../architecture/security-screens.md#the-app-lock)).
  The owner decided how the words are checked in an app that does not
  keep the recovery key, what notifications show, and when the app
  locks. "Keys in memory", point 5, was corrected to what Android
  really does with an app that waits in the background
  ([Decided in step 1.7, session B](#decided-in-step-17-session-b)).
- Not built yet: the handover between apps (step 3.0), sealing file
  keys again in the database (the first app that stores files), and a
  new recovery key (Phase 5).
- The code is `android/core/crypto`. It must follow this page exactly.
  If this page is wrong or unclear, the fix is a change to this page
  first, agreed with the owner.
- Decisions: [ADR 0006](../adr/0006-tink-and-key-hierarchy.md) (Tink and
  the key hierarchy) and
  [ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md) (the
  recovery key). Related:
  [0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md),
  [0005](../adr/0005-no-network-permission-in-data-apps.md),
  [0008](../adr/0008-backup-file-format.md) and
  [0009](../adr/0009-sync-protocol-and-server.md).
- A change to any byte layout, label or parameter on this page is a
  format change: a new version number, readers for every older version,
  and a decision record ("Changing formats" in
  [CLAUDE.md](../../CLAUDE.md)).

The page ends with every [assumption](#assumptions), the owner's
[decisions on pull request 22](#decided-on-pull-request-22),
[in session B](#decided-in-session-b),
[in step 1.7, session A](#decided-in-step-17-session-a) and
[in step 1.7, session B](#decided-in-step-17-session-b), and every
[open question](#open-questions) that is left.

## At a glance

| Part | Choice |
|---|---|
| Library | Tink for Java, artifact `tink-android` 1.24.0. Nothing else. |
| Records for sync | XChaCha20-Poly1305, one sealed blob per record |
| Files and backups | AES-256-GCM-HKDF streaming, 1 MiB segments |
| Key derivation | HKDF-SHA256, through Tink's `KeysetDeriver` |
| Account | One random 256-bit recovery key, shown as 24 words |
| Files | One random key per file. The file is encrypted once. |
| Hardware keys | Four AES-256-GCM keys per app in the Android Keystore, StrongBox where the phone has it |
| App lock | Optional. One system prompt unlocks the file keys. Sync and reminders go on while locked. |
| Database rows | Not encrypted by the app. Android's file-based encryption protects them ([ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)). |
| Every blob | Starts with `SHK`, a version byte and a kind byte |

## Rules

1. Only constructions that Tink provides. Nothing on this page is a new
   cipher, mode or protocol. Our own additions are names: the labels for
   key derivation, a five-byte header, and what is bound as associated
   data.
2. All cryptography is in `core/crypto`. No other module calls Tink,
   `javax.crypto` or the Android Keystore.
3. Our code never chooses a nonce, an IV or a salt. Tink and the Keystore
   make them, at random, for every encryption.
4. No key, no recovery word and no plaintext ever appears in a log, an
   error message, a `toString` or a crash.
5. Every blob carries a version. A reader that meets a version or a kind
   it does not know stops with a clear error. It never guesses.
6. Nothing is used before it is checked. Tink releases a record only
   after its tag is verified, and a stream segment only after that
   segment's tag is verified.
7. A key is used for one purpose only.

## Words used on this page

- **Recovery key.** 32 random bytes. The root of a user's account.
- **Key ID.** Four public bytes that name a recovery key.
- **Keyset.** Tink's container for one or more keys of one kind. One of
  them is the primary, which is used to encrypt.
- **Hardware key.** A key inside the Android Keystore. It cannot be read
  out, not even by the app.
- **Blob.** One encrypted thing: a sealed record, an encrypted file, a
  wrapped key.
- **Associated data.** Bytes that are not secret but are checked together
  with a blob. A blob opens only with the same associated data it was
  made with.
- **App name.** The part of the application ID after `app.shkriuss.`, for
  example `water`. Lower-case letters `a` to `z` only. A preview build
  (`app.shkriuss.water.preview`) has the same app name as its app.
- **Keeper app.** An app that keeps the recovery key on the phone.

## What the design protects

The whole threat model is [threat-model.md](threat-model.md). This table
is the part of it that the keys on this page answer.

| Against | What protects the data |
|---|---|
| A lost or stolen phone | Android's file-based encryption. Keys are wrapped by hardware keys that never leave the phone, where the phone has key hardware ([StrongBox and other hardware](#strongbox-and-other-hardware)). With the app lock on, file keys also need the system prompt. The prompt also takes the phone's PIN, pattern or password, so all of it is as strong as the screen lock. |
| Other apps on the phone | The app sandbox. Each app has its own hardware keys and its own derived keys. Android's own backup is off. Today a key reaches another app of the suite only when the user types the words there. The handover between apps is planned: a signature-protected screen, after a system prompt (step 3.0, not built). |
| A network attacker, a curious or hostile sync server | They see only sealed records and encrypted files, with the key ID in the clear. A changed, cut or swapped blob does not open. What else they learn is in [threat-model.md](threat-model.md#what-the-sync-server-and-the-network-can-still-learn). |
| A malicious library inside one app | It can reach that app's data and derived keys. It can read the recovery key while it is in that app's memory: while it is created, entered or shown. With it, it could make the keys of every app. It cannot read the kept copy without a system prompt. It cannot connect to the network itself: a data app has no network permission. |
| Someone who gets a backup file | The stream under the `backup` key. The file shows its app, the key ID, the format version and its size ([backup-format.md](../architecture/backup-format.md#what-a-changed-or-cut-file-does)). |
| Someone who finds the paper with the words | Nothing on the phone. With a backup file or the sync data, the words open everything of every app. There is no password on top ([threat-model.md](threat-model.md#what-the-24-words-open)). |
| A weak or reused password | There is no password ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md)). The phone's screen lock still matters: file-based encryption and the system prompt rest on it. |

Not protected, by decision or by nature:

- A compromised operating system, an unlocked phone in an attacker's
  hands, a malicious keyboard or accessibility service, coercion, and
  traffic analysis (plan section 10,
  [threat-model.md](threat-model.md#out-of-scope)).
- Sizes, counts and timing. An encrypted file is as long as the file plus
  a small overhead. A sealed record is as long as the record plus 50
  bytes.
- Replay and withholding. A server can hand out an old sealed record
  again, or hold one back. Both are valid blobs. The sync design must
  handle this ([ADR 0009](../adr/0009-sync-protocol-and-server.md),
  Phase 5).
- Database rows at rest, beyond Android's file-based encryption
  ([ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)).

## The library

1. The only cryptography library is Tink for Java: the Maven artifact
   `com.google.crypto.tink:tink-android`, version 1.24.0, released on
   2026-10-16. Session B added it to the version catalog and to the
   dependency verification file
   ([build.md](../development/build.md#where-trust-comes-from)).
2. Why `tink-android` and not `tink`: the plain `tink` artifact depends
   on an HTTP client and on `conscrypt-openjdk-uber`, which holds native
   libraries (hard rules 2 and 4). `tink-android` has neither. It holds
   no native library and no network code. Checked in the jar of 1.24.0.
3. `tink-android` 1.24.0 brings four small libraries with it:
   `com.google.code.gson:gson` 2.13.2,
   `com.google.code.findbugs:jsr305` 3.0.2,
   `com.google.errorprone:error_prone_annotations` 2.41.0 and
   `androidx.annotation:annotation-jvm` 1.8.2. Its protobuf code is
   packed inside the artifact under Tink's own package name. Gson is used
   only by Tink's JSON keyset and JWT code, which the apps never call.
   The owner accepted the four as they come.
4. Tink features that are used: the AEAD, Streaming AEAD, PRF and key
   derivation primitives, the binary keyset format
   (`TinkProtoKeysetFormat`) and the Keystore helper
   (`integration.android.AndroidKeystore`).
5. Tink features that are not used: JSON keysets, JWT, hybrid encryption,
   signatures, MAC, deterministic AEAD, `AndroidKeysetManager`, shared
   preferences, any key management service client, and FIPS mode.

### No Play services provider

Tink asks Java for its ciphers. On Android it looks up two providers by
name: first `AndroidOpenSSL`, which is part of Android, then
`GmsCore_OpenSSL`, which belongs to Google Play services. For random
bytes it looks for the same two and then for one named `Conscrypt`. Tink
never installs a provider. `GmsCore_OpenSSL` exists in an app only if the
app itself calls Play services' `ProviderInstaller`, and `Conscrypt`
only if the app ships that library. The apps do neither, so both cannot
exist. Two checks make sure it stays so:

1. `core/crypto` refuses to work if a provider named `GmsCore_OpenSSL`
   is installed. It looks for that provider at every way into the module,
   every time, because a provider can be installed at any moment. Only
   this name is refused. A unit test installs a fake one and expects the
   refusal.
2. The APK rules check
   ([build.md](../development/build.md#the-play-services-class-rule))
   fails if an APK holds a class under `com.google.android.gms`. The
   check is an owner-only file. The owner asked for this rule in
   session B. It reads the class names in the APK's dex files. That works
   because the build never renames classes, and because an R8 rule keeps
   every class of that package as it is, so that R8 cannot fold one into
   another class (the owner's decision on pull request 25).

### Where Android does the work, not Tink

A hardware key cannot leave the Keystore, so the Keystore itself must do
every operation with it. Tink has a helper for that,
`AndroidKeystore`. `core/crypto` uses the helper where it can, and calls
Android directly in five places:

| Task | How |
|---|---|
| Make a hardware key | Tink: `AndroidKeystore.generateNewKeyWithSpec` |
| Use a hardware key that needs no prompt | Tink: `AndroidKeystore.getAead(alias)` |
| Delete a hardware key | Tink: `AndroidKeystore.deleteKey` |
| Ask whether one hardware key exists | Direct: `KeyStore.getKey` on the `AndroidKeyStore` key store, for that exact alias. It answers "no" only for "not found", and throws for every other failure. |
| List the app's hardware keys | Direct: `KeyStore.aliases` on the same key store. Tink has no call for it. |
| Use a hardware key that needs the system prompt | Direct: `javax.crypto.Cipher`, `AES/GCM/NoPadding`, on the key from the `AndroidKeyStore` key store. The prompt must be given the cipher object, and Tink's helper keeps its cipher to itself. |
| Read whether a key is in StrongBox | Direct: `SecretKeyFactory` and `KeyInfo` |
| The checksum of the recovery words | Direct: `java.security.MessageDigest`, SHA-256. Tink has no public plain hash. It is a checksum, not a secret. |

The direct cipher call makes exactly the bytes that Tink's helper makes:
a 12-byte IV chosen by the Keystore, the ciphertext, and a 16-byte tag.
A test vector below proves the layout.

The order of the calls is not the order in Tink's helper. Android's
Keystore cipher sends associated data to the Keystore at once, and the
Keystore refuses it before the user has answered the prompt. So for a
key that needs the prompt:

1. `init` the cipher. To decrypt, with the IV from the blob and a
   128-bit tag. To encrypt, with no IV.
2. Put the cipher into a `CryptoObject` and show the prompt.
3. Only after the prompt succeeds: `updateAAD`, then `doFinal`. After
   encrypting, read the IV from the cipher.
4. One cipher serves one prompt. If the prompt is cancelled or fails,
   the cipher is thrown away. The next try starts at step 1.

A unit test with a software key cannot find a mistake here. Session C
tested it on emulators, through the real prompt
([assumption 24](#assumptions)).

#### Asking which keys exist

The owner decided this in session B. Tink's `hasKey` is not used. In the
source of Android 13 and 14 it also answers "no" when the Keystore only
failed for a moment. A living key would then count as gone, and its
keyset file could be written over.

1. "Does this key exist" is asked with `KeyStore.getKey` for the exact
   alias. Only "not found" means no. If `getKey` throws, the answer is
   "the Keystore cannot say", and the key counts as not usable now.
2. The list from `KeyStore.aliases` has the same weakness as `hasKey`:
   in Android 14's source it comes back empty when the Keystore fails.
   So an empty or short list is never proof that a key is gone.
3. The list is used for two things only: to pick the next number of a
   new key (rule 4 below), and to find keys that no keyset file names
   (rule 8 below).
4. Before a key is made under an alias, that exact alias is asked for
   with `getKey`. If a key is there, the next number is taken. If
   `getKey` throws, the code stops: no key is made and nothing is
   written.
5. Rule 8 deletes only keys that the list shows. So a list that failed
   deletes nothing.
6. Session C tested on emulators what the real Keystore answers for a
   key that exists and for one that does not
   ([assumptions 28 and 29](#assumptions)). A test cannot make the real
   Keystore fail, so what it answers then is still only read from
   Android's source. The rules for that case are tested with the
   stand-in (`HardwareKeyRulesTest`).

Whether the phone has a screen lock is asked from Android's
`KeyguardManager.isDeviceSecure`. That is not cryptography, so it is not
in the table.

### The system prompt

The system prompt is Android's own `BiometricPrompt`
(`android.hardware.biometrics`), not the AndroidX Biometric library. The
owner decided this on pull request 22.

1. Android's own prompt does everything the design needs on Android 13
   and later: a `CryptoObject` that holds a cipher, and a prompt that
   takes a fingerprint or the device credential for it. Read in the
   source of Android 13 and Android 16.
2. The AndroidX library exists to support older Android versions and to
   carry a prompt through a screen rotation. The first is not needed.
   The second is simple here: when the screen goes away the app cancels
   the prompt and its operation, and starts a new one.
3. The AndroidX library needs a `FragmentActivity`. The apps are Compose
   apps and have no fragments.
4. `core/crypto` hands the screen code a ready
   `BiometricPrompt.CryptoObject`. The screen code never sees a cipher.
   `core/crypto` gets no new dependency for this.
5. Showing the prompt needs the permission
   `android.permission.USE_BIOMETRIC`. Android grants it to every app
   that declares it. It is still a permission:
   [ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md) records
   it, and [permissions.md](permissions.md) lists it. `core/security`,
   which shows the prompt, declares it. The APK rules check allows it per
   app, from Water on (steps 2.4 and 2.5).
6. Only `core/security` shows the prompt. When the screen goes away, it
   cancels the prompt and the step; the user taps again for a new one.

## Keys

### The picture

```text
Hardware keys (Android Keystore, one set per installed app)

  Background key ---- wraps --- record keyset
  Unlocked key ------ wraps --- backup keyset
                                file-key keyset    (app lock off)
  Lock key ---------- wraps --- file-key keyset    (app lock on)
  Recovery guard ---- wraps --- recovery keyset

Recovery key (32 random bytes, the same on every device)

  recovery key
    |-- key ID             4 public bytes
    |-- record keyset      seals records for sync
    |-- backup keyset      encrypts a backup file
    +-- file-key keyset    wraps file keys
                             +-- file key  (random, one per file)
                                   +-- the file
```

Two roots meet here. The hardware keys protect what is stored on one
phone. The recovery key makes the keys that must be the same on every
device. An app with no recovery key has only the left side, plus a
file-key keyset that it made at random.

### Hardware keys

Each installed app has its own. All are AES-256-GCM keys made inside the
Android Keystore. They wrap keysets, which are small. They never encrypt
records or files, because StrongBox is slow.

| | Background key | Unlocked key | Lock key | Recovery guard |
|---|---|---|---|---|
| Kind number | 1 | 2 | 3 | 4 |
| Exists | From the first need | Android 15 and later only, from the first need | While the app lock is on | While this app keeps the recovery key |
| Usable | Whenever the app runs | While the phone is unlocked | After the system prompt, once per prompt | After the system prompt, once per prompt |
| System prompt | No | No | Every use | Every use, app lock on or off |
| Needs a screen lock | No | No | Yes | Yes |
| Removed by removing the screen lock | No | No | Yes | Yes |
| Removed by a fingerprint change | No | No | No | No |
| Wraps | `record`. On Android 13 and 14 also what the Unlocked key would wrap. | `backup`. `file-key` while the app lock is off. | `file-key` | `recovery` |

"Whenever the app runs" means after the first unlock since the phone
started. Before that, Android keeps the app's storage locked and the app
does not run.

The settings, as given to `KeyGenParameterSpec.Builder`:

| Setting | Background | Unlocked | Lock | Recovery guard |
|---|---|---|---|---|
| Algorithm and size | AES, 256 bits | same | same | same |
| Purposes | Encrypt and decrypt | same | same | same |
| Block mode, padding | GCM, none | same | same | same |
| `setIsStrongBoxBacked(true)` | Where the phone has StrongBox | same | same | same |
| `setUnlockedDeviceRequired(true)` | No | Yes | No | No |
| `setUserAuthenticationRequired(true)` | No | No | Yes | Yes |
| `setUserAuthenticationParameters` | Not set | Not set | Timeout 0, types `AUTH_BIOMETRIC_STRONG` and `AUTH_DEVICE_CREDENTIAL` | same as Lock |
| `setInvalidatedByBiometricEnrollment(false)` | Not set | Not set | Yes | Yes |

Notes:

1. Timeout 0 means the key works for one operation per prompt. The user
   answers the prompt with a fingerprint or with the phone's PIN, pattern
   or password.
2. The alias of a hardware key is `shk.<kind>.<number>`, for example
   `shk.lock.3`. `<kind>` is `background`, `unlocked`, `lock` or
   `recovery`. `<number>` starts at 1 and goes up by one each time a new
   key of that kind is made. Rule 4 below says exactly which number a
   new key gets. Every wrapped keyset names the kind and the number of
   the key that wrapped it.
3. The two prompt keys do not also ask for an unlocked phone. A prompt
   for every use is the stronger rule, and fewer settings mean fewer
   differences between Android versions.

#### Rules for making, replacing and losing a hardware key

A keyset file under a hardware key can be the only way to a user's
files. These rules keep a mistake or a stop in the middle from
destroying it.

1. A hardware key is gone only if its alias does not exist, or Android
   answers `KeyPermanentlyInvalidatedException`. Every other failure
   means "not usable now": the phone is locked, the prompt was not
   answered, or the Keystore is busy. Then nothing is deleted and nothing
   is made again.
   - "Does not exist" is the answer of `KeyStore.getKey` for that exact
     alias, never a list that does not show it
     ([Asking which keys exist](#asking-which-keys-exist)).
   - `KeyPermanentlyInvalidatedException` counts when it comes from the
     cipher. A key that fails to load is "not usable now".
   - A tag that the Keystore refuses is neither: the blob is "damaged or
     changed".
2. A keyset file that cannot be opened is never deleted or written over,
   unless rule 1 says its hardware key is gone. Step 1.7, session A gave
   this rule three exceptions. Each one writes over or removes a file
   whose hardware key lives. Each one is safe for the reason given:
   - **Repair.** A damaged `record`, `backup` or `file-key` is written
     over with the keyset the recovery words derive. Only if another
     stored keyset that opens is exactly the one those words derive.
     Safe: the words are proven, and the damaged bytes are first copied
     to the set-aside folder and kept
     ([A damaged keyset file](#a-damaged-keyset-file)).
   - **Giving up.** A damaged keyset that no words can bring back is
     copied to the set-aside folder and then removed, when the user asks.
     Safe: nothing could open it, and the copy is kept
     ([A damaged keyset file](#a-damaged-keyset-file)).
   - **Start over.** Start over writes over `backup` and grows
     `file-key-old`, although their hardware keys live and both files
     open. Safe: that `backup` was never used, and `file-key-old` only
     gains keys
     ([Starting over after a setup that stopped](#starting-over-after-a-setup-that-stopped)).
3. A keyset is made only when its file does not exist. Four cases are not
   "made" in this sense:
   - a keyset whose hardware key is gone is stored again from the
     recovery words (rule 2);
   - the random `file-key` is replaced by the derived one
     ([The file-key keyset without a recovery key](#the-file-key-keyset-without-a-recovery-key));
   - a damaged keyset is stored again by a repair (rule 2);
   - start over stores the keysets of the new recovery key (rule 2).
4. A new hardware key gets the number that is one above the highest
   number of its kind, counted over the aliases that exist and the
   numbers that keyset files name. A key is never made under an alias
   that exists. Tink's helper would replace the old key without a word.
   So the exact alias is asked for first, and the next number is taken
   if a key is there. If the Keystore cannot say, nothing is made. A
   number can come back after its key was deleted and no file names it.
5. Making, replacing and deleting hardware keys and keyset files happens
   one step at a time, under one lock in the app. A prompt that waits for
   the user does not hold that lock, so sync goes on behind it.
6. A keyset file is replaced like this: write a new file, flush it to
   storage, rename it over the old one, flush the folder. Where the new
   hardware key needs no prompt, the app first opens the new blob again
   to check it.
7. An old hardware key is deleted only after every keyset it wrapped is
   safely stored under another key.
8. At start, the app deletes hardware keys of its own that no keyset
   file names. It does this only if it could read the header of every
   keyset file. It deletes only keys that the Keystore's list shows. A
   file in `shk-keys/` that the code does not know counts as "could not
   read every header".
   - The set-aside folder is not read here. A set-aside file names no
     hardware key, so the key that wrapped it is deleted like any key
     that no keyset file names. The Keystore refused that blob, so the
     key could never open it again.

#### Why four keys

- **Background key.** Sync must go on while the app is locked and while
  the phone is locked, so that a reminder made on a tablet rings on a
  phone in a pocket. The record keyset opens only records. Their content
  is in the database anyway, which the app does not encrypt. So this key
  gives the record keyset the same protection the rows already have.
  This amends point 3 of ADR 0006 for this key. The owner decided it on
  2026-11-12.
- **Unlocked key.** Everything else that needs no prompt is usable only
  while the phone is unlocked, as ADR 0006 says.
- **Lock key.** With the app lock on, file keys need the prompt.
- **Recovery guard.** The kept recovery key needs the prompt for every
  single use, with the app lock on or off. Day-to-day work never touches
  it.

#### Android 13 and 14

Android's reference for `setUnlockedDeviceRequired` warns about Android
12 to 14: such keys cannot be made or used on a phone with no screen
lock, and they are all deleted when the screen lock is removed. Android
15 fixed this. Google's advice is to use the setting only on Android 15
and later.

So on Android 13 and 14 there is no Unlocked key. The Background key
wraps `backup` and, with the app lock off, `file-key`.

What that gives up: on those two versions the hardware does not refuse
these two keysets while the phone is locked. This matters only against
someone who breaks Android itself on a phone that was unlocked at least
once since it started. A compromised operating system is out of scope.
Before the first unlock, and against a thief who cannot break Android,
nothing changes. With the app lock on, file keys are behind the prompt
on every version.

When a phone is updated to Android 15, the app makes an Unlocked key at
its next start. It moves under it each keyset that the Background key
holds in its place: `backup`, `file-key-old` if it exists, and `file-key`
if the app lock is off. If the phone is locked at that start, the
Unlocked key cannot be used yet, and the move waits for a later start.

### Keysets

| Name | Tink key type and parameters | Made | Wrapped by |
|---|---|---|---|
| `recovery` | `HkdfPrfKey`: HKDF-SHA256, 32-byte key, no salt. One key per recovery key. The key's value is the recovery key. | When a recovery key is created or entered in this app | Recovery guard |
| `record` | `XChaCha20Poly1305Key`, variant `TINK` | Derived from the recovery key | Background key |
| `backup` | `AesGcmHkdfStreamingKey`, the predefined `AES256_GCM_HKDF_1MB` | Derived from the recovery key | Unlocked key |
| `file-key` | `XChaCha20Poly1305Key`, variant `TINK` | No recovery key: one random key. With one: derived from it. | Lock key if the app lock is on, else Unlocked key |
| `file-key-old` | `XChaCha20Poly1305Key`, variant `TINK`. One or more keys: the random key, and after a start over also the keys of each setup that stopped. | Kept from `file-key` when the app gets its derived keys, or by start over | Unlocked key |
| File key | `AesGcmHkdfStreamingKey`, `AES256_GCM_HKDF_1MB` | Random, one per file content | The `file-key` keyset |

`AES256_GCM_HKDF_1MB` means: a 32-byte key, a 32-byte AES-256-GCM key
derived for each stream, HKDF-SHA256, and ciphertext segments of
1,048,576 bytes.

After a keyset is read, the code checks that it holds only the key type
and parameters of this table, and that every key has its own ID.
Anything else is refused.

Which hardware key may wrap which keyset. A reader refuses every other
pair:

| Keyset | Background key | Unlocked key | Lock key | Recovery guard |
|---|---|---|---|---|
| `record` | Yes | No | No | No |
| `backup` | Yes: on Android 13 and 14, and on Android 15 until the keyset is moved | Yes | No | No |
| `file-key` | As `backup`, while the app lock is off | Yes, while the app lock is off | Yes, while the app lock is on | No |
| `file-key-old` | As `backup` | Yes | No | No |
| `recovery` | No | No | No | Yes |

### The recovery key and its key ID

1. A recovery key is 32 bytes from Tink's random source. Tink makes it as
   a new `HkdfPrfKey`.
2. Its key ID is four bytes:

   ```text
   key ID = HKDF-SHA256(ikm = recovery key, salt = empty,
                        info = "shkriuss.app/v1/key-id", length = 4)
   ```

   Computed with Tink's PRF primitive on that `HkdfPrfKey`. Read as a
   big-endian 32-bit number, it is the Tink key ID of this recovery key
   in the `recovery` keyset and of every key derived from it.
3. The key ID is public. It lets an app say "this backup was made with
   another recovery key" before it tries to decrypt, and it gives the
   same key the same ID on every device with no coordination. HKDF
   outputs under different labels are independent, so the ID tells
   nothing about any key.
4. A new recovery key whose key ID is 0, or equal to the ID of any key in
   a keyset the app stores, is thrown away and made again. The chance is
   about 1 in 4 billion.
5. A wrapped file key names the key that sealed it only by its ID. So no
   ID may stand for two different keys in `file-key` and `file-key-old`.
   Entered words whose ID already stands for another key there are
   refused: nothing is stored, and the answer says that the key ID is in
   use. The chance is the same.

### Deriving keys

All derived keys come from Tink's key derivation primitive,
`KeysetDeriver`, with a `PrfBasedKeyDerivationKey` built on the
`HkdfPrfKey`. In plain terms each key is:

```text
key = HKDF-SHA256(ikm = recovery key, salt = empty,
                  info = label, length = 32)
```

HKDF is RFC 5869. An empty salt means 32 zero bytes, as the RFC says. The
label is ASCII text with no end byte.

| Keyset | Label | Derived key type |
|---|---|---|
| `record` | `shkriuss.app/v1/<app>/record` | XChaCha20-Poly1305, variant `TINK`, ID = key ID |
| `backup` | `shkriuss.app/v1/<app>/backup` | `AES256_GCM_HKDF_1MB` |
| `file-key` | `shkriuss.app/v1/<app>/file-key` | XChaCha20-Poly1305, variant `TINK`, ID = key ID |

1. `<app>` is the app name, for example
   `shkriuss.app/v1/water/record`.
2. Every app gets its own three keys. An app cannot compute the keys of
   another app from its own.
3. `v1` is the version of this derivation scheme. It changes only if the
   scheme changes.
4. A label is never reused for another key type or another purpose. New
   purposes get new labels. Labels that start with `shkriuss.app/v1/sync/`
   are reserved for the sync design.
5. `KeysetDeriver` gives each derived key the ID and the primary flag of
   the recovery key it came from. With two recovery keys, each derived
   keyset has two keys, and the one from the current recovery key is the
   primary.
6. How the call is built: for each key of the `recovery` keyset, one
   `PrfBasedKeyDerivationKey` with that `HkdfPrfKey`, the derived key
   type of the table, and the same key ID. They go into one keyset with
   the same primary. The label is the argument that
   `KeysetDeriver.deriveKeyset` calls `salt`. It is HKDF's `info`, not
   HKDF's salt.
7. No keys are derived for the app names `sync` and `catalog`. Those apps
   hold no data keys. A keeper refuses to derive for them.

### File keys

1. Every file has its own record in the database. The file ID is that
   record's `id`.
2. Each file content gets a new random file key: a Tink keyset with one
   `AES256_GCM_HKDF_1MB` key. New content, for example an edited file,
   gets a new key and a new stream.
3. The file is encrypted once, into a file stream. The same bytes are
   stored on the phone, sent to the server and stored on every other
   device. Nobody re-encrypts a file.
4. The file key is stored in the file's database row, as a wrapped file
   key: sealed by the `file-key` keyset.
5. The same wrapped bytes travel inside the file's sealed record and
   inside a backup. Sync and backup never unwrap a file key.
6. So the Sync app can move a file's ciphertext, and the data app can
   seal and open the file's record, without any key that is behind the
   prompt.

What protects a file key on the phone:

| App lock | The file key is sealed by | which is wrapped by | which needs |
|---|---|---|---|
| Off | `file-key` keyset | Unlocked key (Background key on Android 13 and 14) | An unlocked phone (on Android 13 and 14: a phone unlocked once since it started) |
| On | `file-key` keyset | Lock key | The system prompt |

#### The file-key keyset without a recovery key

Adding files needs no recovery key. Until the app has one, `file-key`
holds one random key that exists only on this phone.

When the app gets its recovery-key-derived keys:

1. The old keyset is stored as `file-key-old`. Only then does the derived
   keyset become `file-key`. If `file-key-old` already exists, it is
   never written again here. So doing this twice, after a stop in the
   middle, cannot replace the old keyset with the new one. Only start
   over writes it again, and only to add keys
   ([Starting over after a setup that stopped](#starting-over-after-a-setup-that-stopped)).
2. The app opens each wrapped file key with the old keyset and seals it
   again with the new one. It writes the row through `RecordWriter`.
   This can stop and go on later.
3. When no row is left, `file-key-old` is deleted. Only once `record`
   exists: before that, the setup is not finished. A damaged
   `file-key-old` is copied to the set-aside folder first.
4. To open a wrapped file key, the app tries `file-key` first, then
   `file-key-old`. A damaged `file-key-old` counts as absent here, so the
   files that `file-key` sealed still open. The user can give up the
   others ([A damaged keyset file](#a-damaged-keyset-file)).
5. The app makes a backup, sends file records to sync and can turn the
   app lock on only when both are true: `record` exists, and
   `file-key-old` does not. A file key sealed by a key that exists only
   on this phone must never leave it. `core/crypto` itself refuses to
   encrypt a backup and to turn the app lock on before that. It cannot
   tell which sealed record is a file's record, so the code that hands
   records to sync asks `core/crypto` for this state and holds file
   records back.
6. Sealing a file key again is not an edit by the user. It needs its own
   `RecordWriter` function, as restoring a backup and importing from sync
   get theirs ([ADR 0027](../adr/0027-record-fields-and-stamping.md),
   point 8). That function also covers deleted rows, because a deletion
   can be undone and the file must then open. It changes only the wrapped
   file key and the change number, and leaves `updatedAt` as it is. Each
   app says which of its tables hold wrapped file keys. All of this is
   built with the first app that stores files, not in session B. The
   owner agreed to this on pull request 22.

### Where keys are stored

| What | Where | Form |
|---|---|---|
| Hardware keys | Android Keystore | Cannot be read out |
| `record`, `backup`, `file-key`, `file-key-old`, `recovery` | One file each in `shk-keys/` inside the app's no-backup files folder | Keyset wrapped by a hardware key (kind 5) |
| File keys | The file's database row | Wrapped file key (kind 4) |
| Files | The app's private storage | File stream (kind 2) |
| The recovery key in the clear | Nowhere. On paper, with the user. | 24 words |
| A damaged keyset file, kept | One file each in `shk-keys-set-aside/`, next to `shk-keys/`, named `<name>-<n>` | The damaged bytes, as they were |

1. Every app turns Android's own backup and device transfer off, as
   Catalog does (`android:allowBackup="false"` and data extraction rules
   that exclude everything).
2. A keyset file is replaced as rule 6 under "Hardware keys" says.
   - A file has the name of its keyset, with no ending: `record`,
     `backup`, `file-key`, `file-key-old`, `recovery`.
   - While a file is replaced, the new one is written as `<name>.tmp`. A
     `.tmp` file that a stop left behind is deleted at start.
   - Before a damaged keyset file is written over or given up, it is
     copied to `shk-keys-set-aside/<name>-<n>`. The copy is written as a
     new file, flushed, renamed to the next free number without
     replacing anything, and the folder is flushed. A copy with the same
     bytes is not made twice. Nothing deletes a set-aside file.
   - The set-aside folder is not inside `shk-keys/`: there, a file the
     code does not know would stop rule 8 for good.
3. The app's storage is credential-encrypted. No part of an app runs
   before the first unlock after a restart.

### Keys in memory

1. The recovery key is in memory only while it is created, entered,
   shown, used to derive keys, or checked before the app lock is turned
   on. Then every reference is dropped.
2. The `record` keyset is loaded when needed and may stay for the life of
   the process.
3. The `backup` keyset is loaded for one backup or restore and then
   dropped.
4. The `file-key` keyset is loaded when a file is opened or added. With
   the app lock on it is loaded by the prompt and dropped when the app
   locks.
5. Every keyset except `record` is dropped when the phone's screen
   turns off while the app is on the screen. The app sees this as its
   screen stops, while the phone is no longer interactive. With the app
   lock off, the app also drops them whenever it leaves the screen. They
   load again without a prompt. A backup, a restore or a file that is
   being read or written at that moment may finish. Nothing new starts.
   - An app that waits in the background with the app lock on and a
     timer keeps `file-key` in memory until it comes back or locks.
     Android 14 and later hold the screen-off broadcast back while such
     an app waits, and work after a screen stopped is not sure to run.
     `ACTION_SCREEN_OFF` cannot be declared in a manifest. So such an app
     may not learn in time that the screen was off.
   - A screen-off broadcast that arrives after the screen is on again is
     ignored. A lock then would show the app's content first and lock
     after.
   - With "When it leaves the screen", the keys are dropped as the app
     leaves, so nothing waits. The user guide says so
     ([app-lock.md](../user/app-lock.md#when-the-app-locks)).
6. Kotlin cannot wipe memory for certain. Dropping references is the best
   the app can do. Keys are held as Tink objects, never as text.
7. Every keyset in memory is dropped when any keyset file is written or
   removed. The next use reads the files again. A keyset kept from before
   a change that failed half way would seal with the wrong key. Only the
   app lock keeps `file-key` again right after its own write.

## Nonces and key IDs

Our code never makes a nonce.

| Where | Nonce | Made by |
|---|---|---|
| Sealed record, wrapped file key | 24 random bytes, new for every encryption, stored in the blob | Tink |
| File and backup stream | 32-byte random salt and 7-byte random prefix per stream, stored in the stream's header. The nonce of a segment is prefix + segment number + last-segment flag. | Tink |
| Keyset wrapped by a hardware key | 12 random bytes, new for every encryption, stored in the blob | The Android Keystore |

- A 24-byte random nonce is safe for any number of records under one key.
  That is why records use XChaCha20-Poly1305.
- A stream never reuses a nonce: every stream has its own derived key,
  and inside a stream the segment number counts up.
- The Keystore refuses a caller's own IV by default. The setting that
  allows it is never used.

Key IDs:

- A sealed record and a wrapped file key start with Tink's five-byte
  prefix: the byte `01`, then the four-byte ID of the key that sealed
  them. This is Tink's `TINK` variant. Tink picks the key by this ID.
- For keys derived from a recovery key, that ID is the recovery key's key
  ID. So the blob names the recovery key it needs.
- The random `file-key` key of an app with no recovery key gets a random
  ID from Tink. File keys also get random IDs. Those IDs are never used
  to find a key.
- Streams have no key ID. That is Tink's format. If a keyset holds
  several keys, Tink tries each. A backup file therefore carries the key
  ID in its own header (see [kind 3](#kind-3-backup-stream)).
- A keyset wrapped by a hardware key names the kind and number of the
  hardware key.

## Blob layouts

Numbers that take more than one byte are big-endian. Offsets start at 0.

### The header

Every blob starts with five bytes:

| Offset | Size | Value |
|---|---|---|
| 0 | 3 | `53 48 4B`, the ASCII letters `SHK` |
| 3 | 1 | Version of this kind's layout. Today always `01`. |
| 4 | 1 | Kind |

| Kind | Blob |
|---|---|
| `01` | Sealed record |
| `02` | File stream |
| `03` | Backup stream |
| `04` | Wrapped file key |
| `05` | Keyset wrapped by a hardware key |

### Associated data

For every blob:

```text
associated data = the blob's own bytes before the ciphertext part
                  + context
```

| Kind | Bytes before the ciphertext part | Context |
|---|---|---|
| 1 | Header (5) | Record ID, 16 bytes |
| 2 | Header (5) | File ID, 16 bytes |
| 3 | Header (5) | The whole backup header, as bytes |
| 4 | Header (5) | File ID, 16 bytes |
| 5 | Header, hardware key kind and number (10) | Keyset name, ASCII |

1. An ID is the 16 bytes of the UUID, in the order of its 32 hex digits.
   `00112233-4455-4677-8899-aabbccddeeff` is `00 11 22 ... EE FF`. Only
   the 36-character form is taken, with hex digits in either case.
2. The context is either 16 bytes or the last and only part of variable
   length. So two different inputs never give the same associated data.
3. The kind byte is inside the associated data. A blob of one kind never
   opens as another kind, even under the same key.
4. The app name is not in the associated data. It is in the key: every
   derived key is derived for one app.
5. What this stops: a blob moved to another record or file, a blob read
   as another kind, a changed version or kind byte, and a keyset file
   renamed to another keyset.

### Kind 1: sealed record

| Offset | Size | Content |
|---|---|---|
| 0 | 5 | Header: `53 48 4B 01 01` |
| 5 | 1 | `01`, Tink's prefix version |
| 6 | 4 | Key ID |
| 10 | 24 | Nonce |
| 34 | n | Ciphertext, as long as the plaintext |
| 34 + n | 16 | Poly1305 tag |

- Bytes 5 to the end are exactly what Tink's `Aead.encrypt` returns for
  an `XChaCha20Poly1305Key` of variant `TINK`.
- Keyset: `record`. Associated data: header + record ID.
- Length: plaintext + 50.
- The plaintext is the record as the sync design will define it
  ([ADR 0009](../adr/0009-sync-protocol-and-server.md)).
- The reader takes the record ID from what came with the blob. If the
  sender lied about the ID, the blob does not open.
- The whole record is in memory while it is sealed or opened. Records are
  small. Files are not records.

### Kind 2: file stream

| Offset | Size | Content |
|---|---|---|
| 0 | 5 | Header: `53 48 4B 01 02` |
| 5 | 1 | `28`, Tink's stream header length, 40 |
| 6 | 32 | Salt |
| 38 | 7 | Nonce prefix |
| 45 | ... | Segments |

- Bytes 5 to the end are exactly what Tink's
  `StreamingAead.newEncryptingStream` writes for `AES256_GCM_HKDF_1MB`.
  Tink sees the stream starting at byte 5.
- Key: the file's file key. Associated data: header + file ID.
- Inside Tink's format:
  - Stream key = HKDF-SHA256(ikm = file key, salt = the salt, info = the
    associated data, length = 32).
  - Each segment is AES-256-GCM: ciphertext, then a 16-byte tag.
  - Nonce of segment i = nonce prefix (7) + i as 4 bytes + one byte that
    is `01` for the last segment and `00` for all others.
  - The first segment holds up to 1,048,520 bytes of plaintext. Every
    later one holds up to 1,048,560.
  - The last segment may be shorter. An empty file is one segment with no
    plaintext.
- Length for a plaintext of P bytes: 5 + 40 + P, plus 16 for each
  segment. There is one segment if P is at most 1,048,520. Each further
  1,048,560 bytes, or part of them, add one more.
- What Tink's format gives: a cut stream fails, because no segment says
  "last". Segments that are swapped, repeated or dropped fail, because
  the segment number is in the nonce. A reader may jump to any segment
  and check it alone, so a large file can be read from the middle.
- A reader gets the segments it has read so far before it reaches a cut.
  So a file counts as whole only when its stream has ended without an
  error.
- Tink reads up to 2^31 segments, about 2,000 terabytes.

### Kind 3: backup stream

| Offset | Size | Content |
|---|---|---|
| 0 | 5 | Header: `53 48 4B 01 03` |
| 5 | ... | A Tink stream, as in kind 2 |

- Keyset: `backup`. Associated data: header + the whole backup header.
- The backup header, the place of this stream in the file, and what is
  inside the stream belong to step 1.5 and
  [ADR 0008](../adr/0008-backup-file-format.md). They are in
  [backup-format.md](../architecture/backup-format.md). This page asks
  five things of that format:
  1. The backup header is not secret and is given to `core/crypto` as
     the context, byte for byte.
  2. It contains the key ID, so the app can say "wrong recovery key"
     before it decrypts.
  3. A backup never contains the recovery key, any keyset, or anything
     wrapped by a hardware key.
  4. A backup contains file keys only as wrapped file keys, exactly as
     they are in the rows.
  5. A restore changes nothing in the app until the whole stream has
     ended without an error. A cut backup fails only where it is cut.

### Kind 4: wrapped file key

| Offset | Size | Content |
|---|---|---|
| 0 | 5 | Header: `53 48 4B 01 04` |
| 5 | 1 | `01`, Tink's prefix version |
| 6 | 4 | ID of the `file-key` key that sealed it |
| 10 | 24 | Nonce |
| 34 | n | Ciphertext |
| 34 + n | 16 | Poly1305 tag |

- Keyset: `file-key`. Associated data: header + file ID.
- The plaintext is the file key as Tink's binary keyset:
  `TinkProtoKeysetFormat.serializeKeyset`. Today that is 123 to 131
  bytes, most often 131, so the blob is 173 to 181 bytes. The length
  depends on the random ID that Tink gives the file key. Code never
  checks or assumes this length.
- Sealing a keyset with an AEAD is how Tink itself stores a keyset under
  another key. Doing it for one key per file is our use of two Tink
  primitives together, not a primitive of its own.
- The keyset says its own parameters. So a later change of segment size
  needs no new version here.

### Kind 5: keyset wrapped by a hardware key

| Offset | Size | Content |
|---|---|---|
| 0 | 5 | Header: `53 48 4B 01 05` |
| 5 | 1 | Hardware key kind: `01` Background, `02` Unlocked, `03` Lock, `04` Recovery guard |
| 6 | 4 | Hardware key number |
| 10 | 12 | IV |
| 22 | n | Ciphertext |
| 22 + n | 16 | GCM tag |

- Bytes 10 to the end are exactly what Tink's `AndroidKeystore` AEAD
  returns, and what the direct cipher call returns for the prompt keys.
- Key: the hardware key `shk.<kind>.<number>`. Associated data: the first
  10 bytes + the keyset name (`record`, `backup`, `file-key`,
  `file-key-old` or `recovery`).
- The plaintext is the keyset as Tink's binary keyset.
- The reader checks that the hardware key kind is one that may wrap this
  keyset. For example `recovery` under any kind but 4 is refused.

Why not Tink's `serializeEncryptedKeyset` for kinds 4 and 5: it does the
same encryption, but adds a second copy of the key types and IDs in the
clear, and it hides the IV inside a protobuf message. The prompt needs
the IV before it decrypts.

### Reading a blob

A reader answers with one of these, and nothing more detailed:

| Answer | When |
|---|---|
| Not one of ours | The first three bytes are not `SHK` |
| Made by a newer version of the app | The version byte is higher than the reader knows |
| Wrong kind | The kind byte is not the one expected here |
| Needs another recovery key | Kinds 1 and 4: the key ID is not in the keyset. The answer names the key ID. |
| Needs keys this app does not have now | The hardware key is gone, or the app is locked |
| Damaged or changed | Tink or the Keystore refuses the blob. Also for a stream that fails at any segment. |

No answer contains plaintext or key bytes.

How a reader gets to its answer:

1. It checks the magic first, then the kind, then the version. The
   version is the version of that kind's layout, so it is read only when
   the kind is the expected one. A version byte `00` is "damaged or
   changed".
2. Fewer than three bytes, or other bytes than `SHK`, is "not one of
   ours". `SHK` on a blob that is shorter than the smallest blob of its
   kind is "damaged or changed".
3. Whatever a reader refuses for its content is "damaged or changed": a
   keyset with another key type or other parameters, a hardware key kind
   that may not wrap this keyset, a hardware key kind outside 1 to 4,
   and a hardware key number 0.
4. "Needs keys this app does not have now" is also the answer when the
   keyset file does not exist, when its hardware key is not usable now,
   when a kind 5 blob names a hardware key that does not exist, and when
   a blob is to be made but its keys are not there.
5. For a wrapped file key, `file-key` is tried first and then
   `file-key-old`. If neither opens it, the answer is "damaged or
   changed" when one of them holds the key ID the blob names, and "needs
   another recovery key" when none does.
6. A record ID or a file ID that is not a UUID is a mistake of the code
   that calls, not an answer about a blob.
7. A read of the storage that fails while a stream is decrypted stays a
   failed read. It is not turned into "damaged or changed".

## The app lock

The app lock is optional and is set per app. Its screens are step 1.7.
This section fixes what it means for keys.

### What the prompt guards

| Behind the system prompt | Not behind the system prompt |
|---|---|
| The `file-key` keyset, while the app lock is on. With it: every file key, so every file and attachment. | The `record` keyset |
| The `recovery` keyset, always | The `backup` keyset |
| | The database rows. The app lock only hides them behind a screen ([ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)). |

Every app has a `file-key` keyset once it has a recovery key, also an app
with no files. So the prompt always unlocks a real hardware key.

### Rules

1. The app lock can be turned on only if all of these are true:
   - the phone has a screen lock,
   - the app has its recovery-key-derived keys,
   - `file-key-old` does not exist.
2. Turning it on checks the recovery words first. That proves the paper
   copy exists before the app depends on it.
   - A keeper app asks for four of the words, at positions it picks at
     random, and compares them with the kept recovery key.
   - An app that does not keep the recovery key asks for all 24 words, on
     the screen of "Entering it". Words that give this app's own `record`
     key are the proof: they must be the current recovery key of the
     stored `record`. It asks for no four words on top. The key is not
     kept by this check. Keeping stays the user's own choice on the
     security screen. The owner decided this in step 1.7, session B.
   - `core/crypto` enforces the check: turning on needs a `WordsProof`,
     which only `checkFourWords` and `checkAllWords` make. Both store
     nothing and drop no key from memory. A proof names the key ID of the
     `record` key it was checked against, and turning on refuses a proof
     whose key ID is not the one of the `record` key stored now.
   - In a keeper app, the kept recovery key that was read for the four
     words leaves memory when the screen stops, as on the screen that
     shows the words. A turn of the phone does not count. The prompt asks
     again on the way back.
   - Whether a keeper can do the check for another app is decided in the
     handover step (3.0).
3. Why rule 1: the Lock key is removed when the screen lock is removed.
   The `file-key` keyset is then gone from the phone. Because it derives
   from the recovery key, the words bring it back. A random keyset could
   never come back.
4. The screen that turns the app lock on says plainly: if the screen lock
   is removed and the recovery words are lost, the files of this app on
   this phone can never be opened again. The user guide says the same.
   The owner accepted this case on pull request 22.
5. The app lock is on exactly when the `file-key` keyset file names a
   Lock key. Nothing else stores that state. So a stop in the middle of
   turning it on or off leaves it clearly on or clearly off.
6. If the file names a Lock key that no longer exists, or Android says
   the key is permanently invalidated, the app lock is off and the app
   says that it was reset. See "When things change".
7. So the code knows three states: on (the file names a Lock key that
   exists), reset (it names one that is gone), and off.

### Turning it on, unlocking, turning it off

Turn on:

1. Check the recovery words (rule 2). In a keeper app this reads the
   kept recovery key, so it is one prompt of the Recovery guard, and
   then four words. In an app that does not keep the key, it is all 24
   words and no prompt.
2. Make a new key of the kind that wraps `file-key` now (the Unlocked
   key, or the Background key on Android 13 and 14). Move the other
   keysets of the old one to it. `file-key` stays under the old key for
   now.
3. Make a new Lock key.
4. Show the system prompt for an encrypt operation with that key.
5. Wrap the `file-key` keyset with it and replace the keyset file. The
   app lock is now on.
6. Delete the old key of step 2. Without steps 2 and 6, an old copy of
   the keyset file that is still somewhere on the phone's storage could
   be opened without the prompt.

So turning the lock on shows two prompts in a keeper app, and one in an
app that does not keep the key.

The order is the owner's decision in session B. The page first made the
Lock key and wrapped `file-key`, and only then replaced the old key. A
stop right after that left the old key in place for good, because nothing
recorded that the last step was still due. In this order a stop at any
point is harmless:

- Before step 5 the app lock is off and every keyset opens. A key that
  was made and that no file names yet is deleted at the next start
  (rule 8).
- After step 5 no file names the old key. If step 6 did not happen, the
  next start deletes it (rule 8).
- If the prompt is cancelled, the app lock stays off and the new Lock
  key is deleted. The other keysets already sit under the new key of
  step 2. The next try has nothing to move.
- No two operations with hardware keys are open at the same time.

Unlock:

1. Read the IV from the `file-key` keyset file. Start a decrypt operation
   with the Lock key.
2. Show the system prompt for that one operation.
3. Decrypt, in the order of calls given under "Where Android does the
   work". The keyset stays in memory until the app locks.

One prompt, one operation, one unlock. No other key is behind this
prompt.

Turn off, while unlocked:

1. Wrap the `file-key` keyset with the Unlocked key (Background key on
   Android 13 and 14). Open the new blob again to check it. Replace the
   keyset file.
2. Delete the Lock key.

If the app finds the Lock key gone while the `file-key` keyset is still
in memory, it does the same at once. Then no words are needed. This
helps only if the app was unlocked when the screen lock was removed.

### What works while an app is locked

| Task | App locked, phone unlocked | Phone locked |
|---|---|---|
| Seal changed records and hand them to the Sync app | Works | Works |
| Take in sealed records and write them to the database | Works | Works |
| Hand out and take in file ciphertext | Works. No key is needed. | Works |
| Records of files, in both directions | Work. The file key travels wrapped. | Work |
| Alarms and notifications | Work. They need rows only. While the app lock is on they show no text, unless the user asks ([notifications.md](../architecture/notifications.md#while-the-app-lock-is-on)). | Work |
| Open or add a file | Needs the prompt | No |
| Backup and restore | Started in the app, so the app is unlocked | No |
| Show the recovery key, set up another app | Needs its own prompt | No |
| Re-wrap file keys after a new recovery key | Needs the app unlocked | No |

- File ciphertext that arrives while the app is locked is stored as it
  is. It is checked when the file is first opened, segment by segment.
- "Phone locked" assumes the phone was unlocked once since it started.
  Before that, no app of the suite runs.
- Whether the Sync app itself can reach the server while the phone is
  locked is for the sync design.

## The recovery key

### What it is for

The recovery key is the account. Whoever has it can read every backup
and all synced data. If it is lost together with every device, nobody can
help ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md)).

The copy an app keeps on the phone is a convenience, not a backup. It is
gone when the screen lock is removed, when the app's data is cleared and
when the phone is lost. The paper copy is the backup.

### Creating it

1. The app makes the recovery key and computes its key ID.
2. It shows the 24 words. It tells the user to write them on paper, in
   order, and to keep the paper somewhere safe.
3. The user confirms: the app asks for four of the words, at positions it
   picks at random. A wrong answer goes back to step 2.
4. Only now does the app derive `record`, `backup` and `file-key`, wrap
   them and store them, in this order: `file-key-old` if a random
   `file-key` exists, then `file-key`, `backup`, and `record` last. The
   app has its derived keys when `record` exists. If the app stops before
   that, the user enters the words again and the steps run again. Each
   step can be done twice without harm.
   - Before anything is stored, the app looks at every derived keyset
     that is stored already and opens. `backup` and `record` must be the
     ones this recovery key derives. `file-key` must be the one it
     derives, or the old keyset: the one `file-key-old` holds, or, if
     there is no `file-key-old` yet, any other keyset, which then becomes
     `file-key-old`.
   - If that check fails, nothing is stored and the answer is "a
     different recovery key". So after a stop, only the same words can
     finish a setup that already stored a derived keyset. Other words
     would leave keysets of two recovery keys, or lose the keys of files
     that were added in between. The owner decided this in session B.
     A user who cannot give the same words can start over
     ([Starting over after a setup that stopped](#starting-over-after-a-setup-that-stopped)).
   - A stored keyset that cannot be opened now stops the setup, and
     nothing is written: "not usable now" if its hardware key cannot be
     used. A damaged file stops it too, with "damaged or changed", unless
     the words are proven and it is repaired
     ([A damaged keyset file](#a-damaged-keyset-file)). A damaged
     `file-key-old` does not stop it, and is left as it is.
   - A stored keyset is left as it is when it is the right one. It is
     stored again only when its file is missing, its hardware key is
     gone, or it is damaged and repaired. `file-key` under a Lock key
     cannot be opened without the prompt. It is left as it is, unless a
     prompt found it damaged.
5. If the phone has a screen lock, the app keeps the recovery key: it
   makes a Recovery guard, shows the system prompt, and stores the
   `recovery` keyset. The app is now a keeper. If the user cancels the
   prompt, the key is not kept and everything else still works. The app
   keeps only the current recovery key of its stored `record`. Any other
   key is refused, so the words it shows again are always the ones its
   keys come from.
6. Before step 5, if another keeper app is already on the phone, the app
   asks whether to keep the key here too. With no other keeper it keeps
   the key without asking. An app can learn of other keepers only through
   the handover between apps. Until that exists, it keeps the key without
   asking.
7. The recovery key is dropped from memory.

If the user leaves before step 4, nothing was stored and the key is
gone. Starting again makes a new one.

### The words

1. The 24 words are the BIP-39 encoding of the 32 bytes, with the BIP-39
   English word list of 2048 words. SHA-256 of the list file `english.txt`:
   `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`.
   A test checks the list in the app against this value.
   - Source: the file `src/mnemonic/wordlist/english.txt` of Trezor's
     [python-mnemonic](https://github.com/trezor/python-mnemonic), the
     reference implementation of BIP-39. Its hash is the value above,
     checked on 2026-11-12.
   - Licence: MIT, "Copyright (c) 2013-2016 Pavol Rusnak". The MIT licence
     asks that this notice and the licence text go with every copy.
   - Session B committed the list as
     `android/core/crypto/src/main/resources/app/shkriuss/core/crypto/words/english.txt`,
     with the MIT licence text next to it as `LICENSE.txt`. Both are
     packed into the app together. It also created the page
     [third-party.md](../development/third-party.md), with the word list,
     and with Tink and the four libraries it brings: each with its
     source, its licence and its notice. Listing everything else that
     ships in an app, and showing the notices inside the apps, comes in
     Phase 2, before Water's first release.
2. Encoding: take the 32 bytes. Add one byte: the first byte of their
   SHA-256. Cut the 264 bits into 24 groups of 11 bits. Each group is the
   number of a word, 0 to 2047.
3. Only the encoding of BIP-39 is used. The BIP-39 seed (PBKDF2 with a
   passphrase) is not. The 32 bytes are the recovery key.
4. The words are English in every app language. No other language has a
   list here.
5. The words look like a cryptocurrency wallet phrase. They are not one.
   The user guide must say so.

### The QR code

Not built. The owner decided in step 1.7, session A: words only for now.
Nothing draws or scans a QR code.

Why:

1. A QR code on a screen gives the whole account to one photo. Words
   must be written down one by one.
2. Scanning would add the camera permission to every data app, and a
   decoder: each a decision record, and a library in every app.
3. The words already work. A QR code saves typing mainly when a new
   phone is set up from an old one, and that comes with sync.

Decided again in Phase 5, when a new phone is set up through sync. The
proposal stays written down for then: the text `SHKRIUSS-RK1`, one
space, then the 24 words in upper case with one space between them.
That text fits the QR alphanumeric mode and is at most 228 characters.

### Entering it

1. The user types 24 words. The field offers words from the list. The
   first four letters of a word are enough to know it. When the typed
   letters start no word of the list, the field says so at once, under
   it (the owner's review of pull request 28).
2. The app trims spaces, makes the text lower case, and splits it at
   spaces. Any run of white space counts as one space. Lower case is made
   the same way in every app language. Only whole words count: the first
   four letters are for the entry field, not for this check.
3. It checks: 24 words, each in the list, and the checksum byte.
4. Messages: "Word 7 is not in the word list." or "These words do not
   belong together. Check each word." Nothing more. A word that is not in
   the list is reported first, the first such word by its position. A
   wrong number of words gets the second message.
5. If the app already has derived keys, it derives the `record` key from
   the entered words and compares it with the one it has. They must be
   equal. The key ID alone is a name, not a proof: other words with the
   same four bytes can be found. A different recovery key is taken only
   through "new recovery key" (see [Key rotation](#key-rotation)).
   - The code gives one of four results: the current recovery key, an
     older recovery key of the keyset, a different one, or a key whose
     key ID is in use
     ([The recovery key and its key ID](#the-recovery-key-and-its-key-id),
     point 5). For the last three nothing is stored. The screen says:
     "these are the words of an older recovery key of this app", "this
     app has its keys from another recovery key", with its key ID, or
     that the words cannot be used here. In a setup that stopped, other
     words offer to start over instead
     ([Starting over after a setup that stopped](#starting-over-after-a-setup-that-stopped)).
   - Entered words whose key ID is 0 are accepted. Only a new recovery
     key with that ID is made again.
6. Then as "Creating it" from step 4. The app stores each derived keyset
   whose file is missing, whose hardware key is gone, or that is damaged
   and repaired. It leaves the others as they are. An app where the
   words were entered is a keeper, if the phone has a screen lock.

### Screens that show or take the words

1. The window blocks screenshots, screen recording and the recent-apps
   preview (`FLAG_SECURE`, and `setRecentsScreenshotEnabled(false)`).
2. The app never puts the words on the clipboard. The words cannot be
   selected.
3. The entry field turns off autofill, spell check and keyboard learning.
   It offers no paste, so the words are less likely to sit in a clipboard
   or a notes app.
4. TalkBack reads the words aloud if it is on. The screen says so before
   it shows them.
5. The recovery key is never in a log, a crash, a notification, a backup
   file, Android's own backup, or a sealed record.

How `core/security` does this is in
[security-screens.md](../architecture/security-screens.md):

- Each screen is an activity of its own. Its window gets `FLAG_SECURE`
  in `onCreate`, before anything is drawn. Autofill and content capture
  are off for the whole window.
- The keyboard is asked for a password field that shows its letters,
  with `IME_FLAG_NO_PERSONALIZED_LEARNING` and
  `TYPE_TEXT_FLAG_NO_SUGGESTIONS`.
- The field's text menu shows nothing. A change of more than one letter
  at once is refused, so a paste never lands, also not through TalkBack.
- Suggestions are drawn in the screen, never in a popup window.
- The recovery key lives in the screen's ViewModel, never in a saved
  state. It ends with the screen. The shown words leave memory when the
  screen stops.

### Showing it again

1. Only a keeper app can. The user asks for it in the app's settings.
2. The app starts a decrypt operation with the Recovery guard and shows
   the system prompt. One prompt, one showing.
3. It shows the words. When the screen closes, or stops because the
   phone's screen turns off or another app comes to the front, the key
   is dropped from memory. A new prompt shows the words again.

### Keeper apps and other apps

A keeper is an app where the recovery key was created or the words were
entered, on a phone with a screen lock. Several apps can be keepers.

| Question | Answer |
|---|---|
| What does an app that is not a keeper show? | If a keeper is on the phone: "The recovery key is kept in Water", with a button that opens Water. If none is: "The recovery key is not kept on this phone", with the choice to enter the words. |
| The keeper is uninstalled, or its data is cleared | Its copy is gone. The other apps keep working with their own keys. No app can show the key or set up a new app until the words are entered in some app. Nothing else is lost. |
| How does another app become a keeper? | The user enters the 24 words in that app. It derives the `record` key from them and compares it with its own, then stores the recovery key under its own Recovery guard after the prompt. |
| The words are entered in an app while another keeper is on the phone | The app asks whether to keep the key here too. With no other keeper it keeps it without asking. |
| How are apps set up before the handover below exists? | By entering the words in each app. Each such app is a keeper, and keeps the key without asking. Nothing changes for them when the handover arrives. |

### Setting up a second app on the same phone

Decided by the owner on 2026-11-12: the second app gets its own derived
keys and never the recovery key. This handover is not built in session B.
It is a step of its own before Phase 3, with its own decision record
(step 3.0 in [PROMPTS.md](../development/PROMPTS.md)). That step confirms
the points below.

1. The new app opens a screen of a keeper app. That screen can be opened
   only by apps signed with the suite's key. The keeper also checks the
   caller's signing certificate itself.
2. The keeper names the asking app and asks the user to allow it.
3. The keeper shows the system prompt. Its Recovery guard needs it, so
   the hardware enforces this step.
4. The keeper derives the three keysets for the asking app's name. It
   takes the name from the application ID that Android reports for the
   caller, never from what the caller says.
5. It returns the three keysets. The new app wraps and stores them. It is
   not a keeper.
6. The keeper drops the recovery key from memory.

So an app set up this way never holds the root, even for a moment.

The keysets go from app to app through Android's own call, with no
further encryption. Only Android itself can see them, and a compromised
Android is out of scope.

A preview build is signed with a throwaway key. So it can never take part
in a handover with a real app.

### A phone with no screen lock

1. A Recovery guard and a Lock key cannot be made. Android makes keys
   that need a prompt only on a phone with a screen lock.
2. The recovery key is created and confirmed as usual, and the derived
   keys are stored. The key itself is not kept. The app says so.
3. Showing it again, setting up a second app from this one, and the app
   lock are not available.
4. Backup, sync and files work.
5. When the user later sets a screen lock, any app can become a keeper by
   taking the words once.
6. The app's security screen says that the phone has no screen lock and
   what that means.

### Starting over after a setup that stopped

Decided by the owner on 2026-11-13, in step 1.7, session A (open
question 11).

A setup stopped half way when some derived keysets are stored, but not
`record`. The same words finish it ("Creating it", step 4). A user who
cannot give them can start over:

1. Start over is offered only while the setup is unfinished: there is no
   `record`, no kept recovery key, and a `backup` or a `file-key-old`
   file. The user asks for it, and makes a new recovery key or enters
   other words.
2. The stored `file-key` is kept. It joins `file-key-old`, which then
   holds every key it held before and every key of `file-key`. The
   primary of `file-key-old` stays its primary. `file-key-old` is
   written only when it gains a key.
3. Then `file-key`, `backup` and `record` are stored from the new
   recovery key, in the order of "Creating it". The `backup` of the
   stopped setup is written over.
4. The move of
   [The file-key keyset without a recovery key](#the-file-key-keyset-without-a-recovery-key)
   then seals every file key again under the new `file-key`.
5. Each step can be done twice without harm. After a stop part way, start
   over runs again, with the same words or with other words. Until it
   finishes, entering the new words alone answers "a different recovery
   key", because the old `backup` is still there.
6. Start over stops, and writes nothing, if a keyset cannot be judged
   now, if `file-key` or `file-key-old` is damaged (the user gives those
   files up first), or if a key ID would stand for two keys.

Start over writes over keyset files whose hardware key lives. That is an
exception to rule 2 under "Rules for making, replacing and losing a
hardware key". It is safe:

- The `backup` keyset of a stopped setup was never used. A backup can be
  made only once `record` exists, and nothing is sealed for sync without
  `record`. So no backup file and no sealed record needs it.
- `file-key-old` only gains keys. Every file key that it or `file-key`
  opened before still opens.
- `record` is written last. So a finished setup never holds keysets of
  two recovery keys.
- No recovery key is kept yet: keeping comes after `record`. So no kept
  key can show the old words.
- The keys of the stopped setup never left the phone.

### A damaged keyset file

Decided by the owner on 2026-11-13, in step 1.7, session A (open
question 12).

A keyset file is damaged when the Keystore refuses its tag, or when what
it opens is not a keyset of the right kind. There are two ways out.

**Repair with proven words**, for `record`, `backup`, `file-key` and
`recovery`:

1. The user enters the 24 words.
2. The words are proven when another stored keyset opens now and is
   exactly the keyset they derive: the same keys, no more and no fewer.
   Then each damaged keyset among `record`, `backup` and `file-key` is
   repaired. If nothing proves the words, nothing is written.
3. The damaged file is first copied to the set-aside folder and kept.
   Then the keyset is written over it in the usual way (rule 6). It is
   never moved: a stop in between would leave `record` missing, and a
   finished app would then look unfinished.
4. A file under a key that needs the prompt shows its damage only when a
   prompt opens it. The app remembers that in memory, for as long as it
   runs. Then:
   - `file-key` under a Lock key is stored again under a key that needs
     no prompt: the Unlocked key, or the Background key on Android 13
     and 14. The Lock key is deleted, and the app lock is off. The app
     lock screens (step 1.7, session B) tell the user.
   - A kept recovery key is replaced when the user keeps the words again.
     The damaged file is copied aside first. Just before, the file is
     read again. If it changed since the step began, nothing happens.
5. The security screen says when a keyset file can be repaired.

**Give up the files**, for the keysets that no words can bring back: a
damaged `file-key-old`, and a damaged `file-key` while the app has no
`record`. That is an app with no recovery key yet, whose `file-key` is
random, or an unfinished setup.

1. It is offered only when such a keyset is damaged. Never while it
   opens, so never for a move that is only unfinished.
2. Before the user confirms, the screen says plainly that those files
   can then not be opened, on any device.
3. The keyset file is copied to the set-aside folder, then removed.
4. Backup, sync of file records and the app lock then work again. An app
   with no recovery key makes a new random `file-key` for its next file.
5. A damaged `file-key` of a finished setup is never given up. The words
   repair it, and without it the app could never make a `file-key`
   again.

Until then, a damaged `file-key-old` counts as absent when a file is
opened, so the files that `file-key` sealed still open. How an app shows
the files that were given up is an [open question](#open-questions).

Writing over or removing a damaged file is an exception to rule 2. It is
safe: the damaged bytes are kept in the set-aside folder, and the keyset
that replaces them is the one the proven words derive.

## When things change

What happens to every key, and what the user does.

| Event | Background key | Unlocked key | Lock key | Recovery guard |
|---|---|---|---|---|
| Screen lock changed, for example a new PIN | Stays | Stays | Stays | Stays |
| Screen lock removed, or reset by a device administrator | Stays | Stays | Deleted | Deleted |
| Fingerprint added or removed | Stays | Stays | Stays | Stays |
| Phone restarted | Stays | Stays | Stays | Stays |
| Phone updated from Android 14 to 15 | Stays | Made now | Stays | Stays |
| App data cleared, or app uninstalled | Deleted | Deleted | Deleted | Deleted |
| New phone, or factory reset | None | None | None | None |

What the user does:

1. **Screen lock changed.** Nothing.
2. **Fingerprint added or removed.** Nothing. Android's reference says a
   key that needs a prompt for every use is not invalidated by a
   fingerprint change when the device credential is among its
   authenticators.
3. **Screen lock removed, app lock was off.** Files, sync and backup go
   on. No app keeps the recovery key any more. To keep it again: set a
   screen lock and enter the words in one app.
4. **Screen lock removed, app lock was on.** The app lock is off. The
   app's files are closed, because the `file-key` keyset was under the
   Lock key. Records, sync and reminders go on. To open the files: enter
   the 24 words in the app. It derives its keys again and the files
   open. An app that was set up by a keeper can also get its keys from a
   keeper again, once a keeper has the words again. Set a screen lock to
   turn the app lock on again.
5. **App data cleared.** Android deletes the app's hardware keys together
   with its data. Set the app up again: from a keeper app, or with the
   words. Then sync, or restore a backup. Without a recovery key and
   without a backup, the data is gone. That is what clearing data means.
6. **New phone.** No key moves to a new phone. Install the apps. Enter
   the words, from the paper or from a keeper app on the old phone.
   Then sync, or restore a backup.

### No phone setting destroys files

The owner's rule, 2026-11-12. How the design keeps it:

1. With the app lock off, the `file-key` keyset is under a hardware key
   that no screen lock change and no fingerprint change removes. This
   holds with or without a recovery key, on Android 13 and later.
2. With the app lock on, the keyset is under the Lock key, which a
   removed screen lock deletes. The app lock is allowed only when the
   keyset derives from the recovery key, so the words bring it back.
3. The file itself and its wrapped file key are ordinary app data. No
   setting touches them.

One case is left: the app lock is on, the screen lock is removed, and
the words are lost. Then the files of that app on that phone can never be
opened. Other devices and the server copy are not affected. The design
lowers the chance: the app lock needs a recovery key, and turning it on
asks for four of the words. It cannot remove the case, because a key that
needs the prompt dies with the screen lock. The owner accepted this on
pull request 22. The app-lock screen and the user guide say it plainly.

## StrongBox and other hardware

1. If the phone reports `FEATURE_STRONGBOX_KEYSTORE`, a hardware key is
   made with `setIsStrongBoxBacked(true)`.
2. If making the key with StrongBox fails, with
   `StrongBoxUnavailableException` or any other error, the key is made
   once more without that setting. It then lives in the trusted execution
   environment (TEE). It still cannot be read out. If that fails too, the
   app shows the error and makes nothing.
3. After making a key, the app reads its security level from `KeyInfo`.
   Android has five answers: StrongBox, TEE, "secure, kind unknown",
   software, and unknown. The app counts the last two as software.
4. The app's security screen shows the level of each key.
5. A key is never moved to a weaker level by itself. When a key counts as
   gone is rule 1 under "Rules for making, replacing and losing a
   hardware key". What the user then does is in "When things change".
6. A phone with a software-only Keystore is allowed. The security screen
   says clearly that its keys are not protected by hardware. Emulators
   are such phones.
7. StrongBox is slow and handles few operations at a time. That is why
   hardware keys wrap only keysets, and why `core/crypto` uses them one
   at a time.
8. The owner's three test devices all have StrongBox. An emulator has
   none. So the release checklist of every app that holds keys checks,
   on each of the three devices, that the security screen shows
   StrongBox for every key. Step 1.7, session A added it as part 3 of
   [release-checklist.md](../development/release-checklist.md).

## Key rotation

There is no rotation by calendar. Keys change on these events.

| Key | Changes when | How |
|---|---|---|
| Lock key | The app lock is turned on. A new key each time. | See "Turning it on". It is deleted when the lock is turned off. |
| Background or Unlocked key | The app lock is turned on, so that the old no-prompt copy of `file-key` can never be opened | Make the key with the next number. Wrap its other keysets with it. Replace their files. Delete the old key last, after `file-key` is under the Lock key. A stop in the middle leaves the old key in use, or named by no file and deleted at the next start. See "Turning it on". |
| Unlocked key | The phone moves to Android 15 | A first Unlocked key is made. `backup`, and `file-key` if the app lock is off, move to it. The Background key stays and keeps `record`. |
| Any hardware key | It was lost | A new key with the next number. There is nothing to wrap again: the keysets it held are gone and are derived again from the words, or handed over again. See "When things change". |
| File key | The file's content changes | A new key and a new stream. The old stream and key are dropped with the old content. |
| Random `file-key` key | The app gets a recovery key | See "The file-key keyset without a recovery key" |
| Recovery key | The user asks for a new one, for example after a device was lost | See below |
| Algorithm or layout | A decision record says so | A new version byte for that kind. Readers for every older version stay. |
| Tink | A new release | Tink keeps its formats stable. The test vectors on this page catch a change. |

### A new recovery key

Session B builds no "new recovery key" flow. It builds what the flow
will need: keysets that hold several keys, and blobs that name their key
ID. The flow itself is part of the sync design
([ADR 0009](../adr/0009-sync-protocol-and-server.md), Phase 5), because
other devices, other apps and the server must follow.

What is fixed now:

1. A new recovery key is created exactly as the first one: shown,
   written down, confirmed.
2. It becomes the primary in `recovery`. The old one stays in the keyset.
3. Each derived keyset gets a second key. New records, backups and
   wrapped file keys use the new one. Old blobs still open, because the
   old keys stay and every blob names its key ID.
4. File keys are sealed again under the new `file-key` key, row by row,
   with the `RecordWriter` function described under "File keys". The
   files themselves are not touched.
5. A new recovery key cannot take back what the old key could already
   open.

Rules the flow must keep, so that no file is lost on the way:

1. Until every wrapped file key names the new key, the app makes no
   backup. Such a backup would hold file keys that the new words cannot
   open.
2. Until then, the user keeps the old words too, and the app says so. If
   the Lock key is lost in between, both the old and the new words are
   needed, so "Entering it" must be able to take an older recovery key as
   a key that is not the primary.
3. A backup made before the change opens only with the old recovery key.
4. Prompts: one to read `recovery`, one to store it, and with the app
   lock on one more to store `file-key`.

## Test vectors

All values are hexadecimal unless marked. They were computed twice: by a
small independent program that uses only HKDF, AES-GCM and
ChaCha20-Poly1305 from another library, and by Tink 1.24.0, with both
`tink` and `tink-android`. The two agree on every value. Tink opened
every blob below, and refused each with one changed byte.

Tink cannot be told which nonce to use. So the blobs below are tests for
opening. Sealing is tested by a round trip.

### Published vectors that the tests include

1. HKDF-SHA256: [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869),
   appendix A, test cases 1 to 3.
2. XChaCha20-Poly1305:
   [draft-irtf-cfrg-xchacha-03](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha-03),
   appendix A.3.1.
3. BIP-39, 256 bits, from the
   [BIP-39 specification](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
   test vectors:

   | 32 bytes | Words |
   |---|---|
   | `00` 32 times | `abandon` 23 times, then `art` |
   | `7f` 32 times | `legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title` |
   | `80` 32 times | `letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless` |
   | `ff` 32 times | `zoo` 23 times, then `vote` |

### Recovery key, words, key ID

```text
recovery key  000102030405060708090a0b0c0d0e0f
              101112131415161718191a1b1c1d1e1f

words         abandon amount liar amount expire adjust cage candy
              arch gather drum bullet absurd math era live
              bid rhythm alien crouch range attend journey unaware

key ID        b19d376f
```

### Derived keys, app name `water`

```text
label  shkriuss.app/v1/water/record
key    2ea787db61b3469728cb62c4d9ce8189
       1169363dc3a25bfd24db275641f13980

label  shkriuss.app/v1/water/backup
key    856f496f008216060733447a8093752b
       3bc04195cb164396e13b034e92c7c463

label  shkriuss.app/v1/water/file-key
key    7a32e58cfa189148f623776170c5e9ba
       b5da910ee080bc94930ba8e8a37362d1
```

The `record` keyset that `KeysetDeriver` returns, as Tink's binary
keyset, 119 bytes:

```text
08efeef48c0b126f0a630a3b747970652e676f6f676c65617069732e636f6d2f
676f6f676c652e63727970746f2e74696e6b2e584368614368613230506f6c79
313330354b657912221a202ea787db61b3469728cb62c4d9ce81891169363dc3
a25bfd24db275641f139801801100118efeef48c0b2001
```

The `recovery` keyset, 113 bytes:

```text
08efeef48c0b12690a5d0a31747970652e676f6f676c65617069732e636f6d2f
676f6f676c652e63727970746f2e74696e6b2e486b64665072664b6579122612
0208031a20000102030405060708090a0b0c0d0e0f101112131415161718191a
1b1c1d1e1f1801100118efeef48c0b2003
```

### Kind 1: sealed record

```text
record ID        00112233-4455-4677-8899-aabbccddeeff
plaintext        7365616c6564207265636f72642074657374
                 (the ASCII text "sealed record test")
nonce            404142434445464748494a4b4c4d4e4f5051525354555657
associated data  53484b010100112233445546778899aabbccddeeff

blob, 68 bytes
53484b010101b19d376f404142434445464748494a4b4c4d4e4f505152535455
56579de67bfa1e55912b5ad2d254cb6bda565a1a54d613396f3c713edc2a0fe2
ac872b70
```

It must not open with the record ID changed in its last byte.

### Kind 2: file stream

```text
file key         a0a1a2a3a4a5a6a7a8a9aaabacadaeaf
                 b0b1b2b3b4b5b6b7b8b9babbbcbdbebf
file ID          0f1e2d3c-4b5a-4978-8695-a4b3c2d1e0ff
salt             606162636465666768696a6b6c6d6e6f
                 707172737475767778797a7b7c7d7e7f
nonce prefix     10111213141516
associated data  53484b01020f1e2d3c4b5a49788695a4b3c2d1e0ff
stream key       89e679d7dddafc7dadf998c023639cfc
                 39417066b3fa378bd44ba32d10af66cc
```

Empty plaintext, blob of 61 bytes:

```text
53484b010228606162636465666768696a6b6c6d6e6f70717273747576777879
7a7b7c7d7e7f10111213141516d342b9778f744a3bcac7ee6f3c6f72ca
```

Plaintext `66696c652073747265616d2074657374`, the ASCII text
"file stream test", blob of 77 bytes:

```text
53484b010228606162636465666768696a6b6c6d6e6f70717273747576777879
7a7b7c7d7e7f101112131415169a858c7fe385e11df99795433c2849a9996fb1
94fa42f38705612211e018459a
```

Longer plaintexts. Byte number i of the plaintext, counted from 0, is
i mod 251. The test builds the blob from the values above, with the salt
and nonce prefix given, compares its SHA-256, and lets Tink open it.

| Plaintext bytes | Segments | Blob bytes | SHA-256 of the blob |
|---|---|---|---|
| 1,048,520 | 1 | 1,048,581 | `6cfb3b27f59afea137cdc6381b7b0b66728933abc71323f67fdce4133f6e9f77` |
| 1,048,521 | 2 | 1,048,598 | `1c5ff74f80ca384cde7d51f1aca07ccb0ecf0672518d6304243b7544f03e6fa6` |
| 2,500,000 | 3 | 2,500,093 | `d1d38e3431844f0154f450fe9956c8c26d08fc9d7a7b016c43228ad9ee7df5bb` |

SHA-256 of the three plaintexts, in the same order:

```text
c1d229c473a1b2dc6f785f4e20919bd921a161c53a45d1af65b9cd0c5fb245a6
ede29c24f5b1c799ee3fb2bd2522bca23e2c21b928eb7ff19d4a3c97129599e7
bd597bc684f3effbd30ef55f519679760ca77831d212eddc15fb862e7ffb8c8f
```

Each of the three must fail when its last 17 bytes are cut off.

### Kind 3: backup stream

The real backup header is in
[backup-format.md](../architecture/backup-format.md#the-backup-header),
which has an example file of its own. This vector uses the ASCII text
"example backup header" in its place.

```text
key              the backup key for water, above
salt             303132333435363738393a3b3c3d3e3f
                 404142434445464748494a4b4c4d4e4f
nonce prefix     70717273747576
plaintext        6261636b75702073747265616d2074657374
                 (the ASCII text "backup stream test")
associated data  53484b01036578616d706c65206261636b757020686561646572

blob, 79 bytes
53484b010328303132333435363738393a3b3c3d3e3f40414243444546474849
4a4b4c4d4e4f707172737475762f4c25bad40f340da5313be45aabfc5ca63a14
c51f4668b6db5e9affd782c515e5ee
```

### Kind 4: wrapped file key

The file key and file ID of kind 2, in a keyset whose own key ID is
`f1020304`, sealed by the `file-key` key for water. An ID this high is
the usual case and gives a keyset of 131 bytes.

```text
file key as Tink's binary keyset, 131 bytes
08848688880f127b0a6f0a3d747970652e676f6f676c65617069732e636f6d2f
676f6f676c652e63727970746f2e74696e6b2e41657347636d486b6466537472
65616d696e674b6579122c120808808040102018031a20a0a1a2a3a4a5a6a7a8
a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf180110011884868888
0f2003

nonce            808182838485868788898a8b8c8d8e8f9091929394959697
associated data  53484b01040f1e2d3c4b5a49788695a4b3c2d1e0ff

blob, 181 bytes
53484b010401b19d376f808182838485868788898a8b8c8d8e8f909192939495
9697cbcbd5a521af018ed74a13ea64fbbe296353cabfef7eb6763a10d101c998
fd871dee2a714739c22cc81c1910f4e485dd0bde9248d796be04fd4f7386a016
cf774dbb16b8010c32089de847b1133a229e418a73800db4463912ca3b3c1f09
602277ee917ce22f2fadd8c5b02f4fc7d65c6f2cadd30c68fe9afa9e00519fe8
25245026b44ae130026fe0affce40112527007f95c
```

### Kind 5: keyset wrapped by a hardware key

A hardware key cannot have a known value. This vector uses an ordinary
AES-256-GCM key in its place. It proves the layout: Tink's AES-GCM key
with no prefix opens bytes 10 to the end.

```text
key standing in  c0c1c2c3c4c5c6c7c8c9cacbcccdcecf
                 d0d1d2d3d4d5d6d7d8d9dadbdcdddedf
hardware key     kind 1 (Background), number 1
keyset           the record keyset for water, above
IV               202122232425262728292a2b
associated data  53484b010501000000017265636f7264

blob, 157 bytes
53484b01050100000001202122232425262728292a2b49dafd91121a02df2886
16f8de4f9979d93f76878ea3a72717a5a0624c108e790fbc0caf9ba2b93e77a8
fc1c20c4584b5ea7f0ce51eb96e825c29ab93e3d2a16247d912331ec1ab09468
3f263e4f8d759739b98b501e3f969f646a5d75b426ddefcf8c17facaf120d099
de01854b108f58a9ff8768fca193f7fce8d937f5dc0b2efa4402b2edb7
```

## What the tests must cover

Items 1 to 8 are for session B, which built them
([build.md](../development/build.md#unit-tests)). Item 9 is session C,
which built it in its own pull request, with the emulator job in the CI
workflow (step 1.4, session C in
[PROMPTS.md](../development/PROMPTS.md)). The tests and what they showed
are in
[emulator-tests.md](../development/emulator-tests.md#the-tests-of-the-hardware-keys).

Unit tests run on the JVM with Robolectric, where no Keystore exists. So
`core/crypto` takes its hardware keys through an interface passed in by
constructor, and the tests pass a software one with the same byte layout.

1. Every vector on this page, and the published ones. The RFC's HKDF
   cases use a key shorter than 32 bytes, which Tink's `HkdfPrfKey` does
   not take. They are tested with Tink's `subtle.Hkdf`, the same code
   that the streams use.
2. Round trips for every kind, with empty, small and large input. A
   stream larger than memory, without loading it.
3. For every kind: one changed byte anywhere, a cut blob, a wrong key, a
   wrong ID in the associated data, a wrong kind, a higher version, a
   wrong magic.
4. Every answer of "Reading a blob", and that no answer, log line or
   `toString` holds key bytes, words or plaintext.
5. The words: every published vector, a wrong checksum, a word not in
   the list, upper case and extra spaces, the hash of the word list.
6. A keyset with two recovery keys: both open old blobs, the primary
   seals.
7. The move from a random `file-key` key to a derived one, stopped in the
   middle and continued.
8. The provider check, and a check that no module but `core/crypto`
   imports Tink, `javax.crypto`, `java.security.KeyStore` or
   `android.security.keystore`.
9. Session C: emulator tests in GitHub Actions on Android 13, 14, 15 and
   the newest. Each hardware key kind is made and used. After the screen
   lock is changed, removed and set again, each key is there or gone as
   the table in "When things change" says. What an emulator cannot do,
   such as StrongBox and a real fingerprint, becomes a list of steps for
   the owner's three devices. Built: the tests are in
   `android/core/crypto/src/androidTest/`, and the steps are in
   [emulator-tests.md](../development/emulator-tests.md#steps-for-the-three-devices).
10. Step 1.7, session A: start over. Stopped before each change, then
    started over with the same words and with other words; files added
    in between; Android 13 and 14, and the move to Android 15 between
    two tries. `file-key-old` only grows. A key ID that would stand for
    two keys is refused. In `StartOverTest`.
11. Step 1.7, session A: a damaged keyset file. Repaired with proven
    words; refused without proof, with other words, and with a proof
    that holds more keys; a stop after the copy; a set-aside copy is
    never written over; damage that a prompt found; giving up, and what
    is never given up. In `RepairTest` and `KeysetFilesTest`.
12. Step 1.7, session A: every keyset in memory is dropped after a write,
    so that a change that failed half way leaves nothing stale behind.
    In `StartOverTest`.
13. Step 1.7, session B: the checks of the words before the app lock.
    Four words of the kept key, and all 24 words, give a proof that names
    the key ID of `record`; a wrong word, another recovery key, three or
    five positions and an app with no recovery key do not; the checks
    store nothing and keep the app unlocked; a `record` that cannot be
    judged stops them; turning on refuses a proof for another `record`
    key and changes nothing. In `WordsProofTest`. When the app locks, and the screens, are tested in
    `core/security`
    ([security-screens.md](../architecture/security-screens.md#tests)).

## Assumptions

Things this page takes as true, or chose without a decision by the
owner. Each one is a place to object.

1. Deriving keys with Tink's `KeysetDeriver` and our labels counts as a
   construction that Tink provides. The labels are names, not
   cryptography.
2. Four bytes of HKDF output, under their own label, are safe to publish
   as a key ID.
3. Sealing a keyset means Tink's AEAD over Tink's binary keyset, not
   `serializeEncryptedKeyset`. The reason is under kind 5. Sealing one
   key per file this way is our use of two Tink primitives together.
4. The direct Keystore cipher call for the prompt keys is the same
   construction as Tink's `AndroidKeystore` AEAD: AES-256-GCM, a random
   12-byte IV from the Keystore, a 16-byte tag, the same layout.
5. The HKDF salt is empty. That is sound because the recovery key is
   uniformly random.
6. All streams use `AES256_GCM_HKDF_1MB`. One megabyte of memory per open
   stream is fine on every supported phone.
7. Every file has its own record, and the file ID is that record's `id`.
8. The header is `SHK`, a version and a kind, with the kind numbers on
   this page. The keyset names and the alias pattern `shk.<kind>.<number>`
   are as written here.
9. The words are BIP-39 English, 24 words, encoding only.
10. A recovery key whose key ID is 0, or is already known to the app, is
    made again.
11. Android behaves as its reference says, also on GrapheneOS, in a
    secondary profile and in Private Space: keys that need a prompt are
    removed with the screen lock and not by a fingerprint change;
    `setUnlockedDeviceRequired` is safe from Android 15; a key with no
    such setting is not removed by any lock or fingerprint setting. Read
    in the reference of `KeyGenParameterSpec.Builder`. The binding of a
    prompt key to the device credential, and the deletion of an app's
    keys when its data is cleared, were also read in Android 16's source.
    - Session C, on AOSP emulators with Android 13, 14, 15 and 17: confirmed for
      the screen lock. A key that needs the prompt stays when the PIN is
      changed, and still works after it. It is deleted at once when the
      screen lock is removed, and does not come back when a lock is set
      again. A key that needs no prompt stays through all of it. From
      Android 15 the Unlocked key is made and used with no screen lock,
      stays when the lock is removed, and is refused while the emulator
      is locked.
    - Still to confirm on the three devices: a fingerprint added or
      removed, GrapheneOS, a second profile, Private Space, and app data
      cleared
      ([the steps](../development/emulator-tests.md#steps-for-the-three-devices)).
12. A key that accepts fingerprint and device credential can be made with
    no fingerprint enrolled. Read in Android 16's source. Session C
    confirmed it on emulators with Android 13, 14, 15 and 17: they have no
    fingerprint, and the Lock key and the Recovery guard were made. With
    no screen lock, making them fails, as the page says.
13. `setInvalidatedByBiometricEnrollment(false)` is set although the
    device credential already makes it unnecessary. It makes the intent
    plain.
14. The prompt keys do not also set `setUnlockedDeviceRequired`.
15. After an update to Android 15 the app moves `backup` and, with the app
    lock off, `file-key` under a new Unlocked key by itself.
16. `GmsCore_OpenSSL` exists only if an app installs it. Read in Tink's
    source at tag `v1.24.0`.
17. Tink keeps its key and ciphertext formats stable across releases, as
    it promises.
18. Kotlin cannot wipe memory for certain. Dropping references and
    dropping keysets when the screen turns off is enough for this threat
    model.
19. Android's own backup stays off in every app, as in Catalog.
20. A sealed record is small enough to hold in memory.
21. The Sync app holds no key from this page
    ([ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)). Its
    own signing key is part of the sync design.
22. A wrapped file key sealed by a random `file-key` key never leaves the
    phone: no backup and no file record goes out while `file-key-old`
    exists.
23. Android's own `BiometricPrompt` takes a cipher together with
    fingerprint or device credential on Android 13 and later, also when
    no fingerprint is enrolled. Read in the source of Android 13 and
    Android 16. Session C confirmed it on emulators with Android
    13, 14, 15 and 17: the prompt took the cipher of a Lock key and of a Recovery
    guard and was answered with the PIN, to encrypt and to decrypt. A
    fingerprint as the answer, and a key in StrongBox, are still to
    confirm on the three devices.
24. For a key that needs the prompt, the cipher can be started before the
    prompt, and associated data must wait until after it. An encrypt
    operation gives its IV when it is done. Read in Android's source by
    the independent review. Session C confirmed it on emulators with
    Android 13, 14, 15 and 17:
    - In the page's order every step works, and the IV read after
      encrypting is 12 bytes.
    - Without the prompt, the last step fails and nothing is stored. One
      prompt serves one operation: a second cipher is not opened by it.
    - With associated data given before the prompt, Android does not
      complain at that call. The operation is lost all the same: it
      fails at its last step, also after a prompt that succeeded.
25. No part of an app runs before the first unlock after a restart, and
    the keyset files are in credential-encrypted storage.
26. `RecordWriter` can get a function that seals file keys again without
    moving `updatedAt`, as ADR 0027 point 8 allows for restore and
    import.
27. Flushing a file and its folder to storage, then renaming, is enough
    to survive a power loss on the supported phones.
28. `KeyStore.getKey` on the Android Keystore answers "no key" only for
    "not found", and throws for every other failure. Read in the source
    of Android 13 and 14. Session C confirmed the first half on
    emulators with Android 13, 14, 15 and 17: "no key" for an alias that was
    never made, that was deleted, and that Android deleted with the
    screen lock. The second half cannot be tested: a test cannot make
    the real Keystore fail.
29. `KeyStore.aliases` comes back empty or short when the Keystore
    fails. Read in Android 14's source. The code never depends on the
    list being complete. Session C confirmed on emulators that the list
    shows each key from when it is made until it is gone. A list from a
    failing Keystore cannot be tested.
30. `KeyPermanentlyInvalidatedException` reaches the app from the cipher.
    When a key is loaded, Android reports the same state as a key that
    cannot be recovered, which the code counts as "not usable now". Read
    in Android's source. Session C could not confirm it: no test met
    this state. On emulators with Android 13, 14, 15 and 17, a key that Android
    deleted with the screen lock is simply "not found", which the code
    counts as gone. Starting a cipher for it also answers "gone".
31. A folder can be flushed to storage through a `FileChannel` opened on
    it. That is how the code flushes `shk-keys/`. Session C confirmed on
    emulators with Android 13, 14, 15 and 17 that the call works on Android's
    file system: every keyset file in the tests is replaced this way.
    That the file survives a loss of power (assumption 27) cannot be
    tested.
32. Tink's code path for Android is the same construction as the one a
    JVM test runs. A JVM test never runs the Android path, because Tink
    tells Android from a desktop by Java's vendor name. Session C ran
    every vector of this page and the published ones on emulators with
    Android 13, 14, 15 and 17. All pass. Android's own provider is there, and no
    Play services provider.
33. After a prompt that succeeded, the Keystore answers a blob whose tag
    is wrong with `AEADBadTagException`, and an operation the user did
    not allow with another exception. The app marks a file as damaged
    only on the first. Not checked in Android's source or on a device in
    step 1.7. A wrong mark is harmless: a repair needs the proven words,
    and stores the keyset those words derive.

## Decided on pull request 22

The owner's decisions of 2026-11-12 on the questions this page first
left open. Each is built into the page above.

| Question | Decision |
|---|---|
| App lock on, screen lock removed, words lost | Accepted. The app-lock screen and the user guide say it plainly. |
| When the handover between apps is built | A step of its own before Phase 3, with its decision record. |
| Protecting the handover on its way | No extra encryption. The keeper also checks the caller's signing certificate itself. The handover step confirms both. |
| Entering the words in a second app | It asks "keep it here too" only when another keeper is already on the phone. Otherwise it keeps the key without asking. |
| The word list | `english.txt` from Trezor's python-mnemonic, MIT licence, the same SHA-256. Source and licence are recorded with the project's third-party material. |
| The QR code | Words only for now. The QR code is decided when the recovery key screens are built. |
| Pasting the words | Not offered. |
| How many words to confirm | Four at setup, four when the app lock is turned on. |
| A software-only Keystore | Allowed, with a clear notice. |
| Preview builds share derived keys with their app | Accepted. The guide tells testers never to type real recovery words into a preview build ([test-a-pull-request.md](../development/test-a-pull-request.md#safety)). |
| Tink's four companion libraries | Accepted as they come. |
| The build check for Play services classes | In the APK rules check. The owner asks for it in session B. |
| StrongBox cannot be tested in an emulator | A line in the release checklist of the first app that stores keys, checked on the three devices. |
| The emulator tests | Not part of session B. They are the next step, in their own pull request. |
| The system prompt | Android's own `BiometricPrompt`. No AndroidX Biometric in `core/crypto`. |
| Where third-party material is listed | Session B creates `docs/development/third-party.md` with the word list, and with Tink and its four libraries, and puts the MIT text next to the list. Everything else that ships in an app, and the notices inside the apps, come in Phase 2 before Water's first release. |
| Sealing file keys again in the database | Its own `RecordWriter` function, built with the first app that stores files. |

## Decided in session B

The owner's decisions of 2026-11-12 in step 1.4, session B, when the code
was built. Each is built into the page above.

| Question | Decision |
|---|---|
| How the code asks whether a hardware key exists, and how it lists keys | Two more direct calls: `KeyStore.getKey` for "exists" and `KeyStore.aliases` for the list. Tink's `hasKey` is not used. A list is never proof that a key is gone, a key is made only after its exact alias was asked for, and rule 8 deletes only keys the list shows. Session C tests it. |
| A setup that stopped half way, then a different recovery key | The owner had no preference. The safe reading was taken: nothing is stored unless every derived keyset that is stored already fits the given recovery key. How a user who cannot give the same words starts over is an open question, and nothing is built for it yet. |
| The order of steps when the app lock is turned on | Move first: the new key and the other keysets first, then the Lock key and the prompt, then `file-key`, and the old key is deleted last. |

Where the page was silent, session B wrote down how the code reads it.
The owner approved these readings with the plan of session B:

1. A reader checks the magic, then the kind, then the version. The
   answers for short input, for a version `00` and for refused content
   are fixed ([Reading a blob](#reading-a-blob)).
2. "Needs keys this app does not have now" also covers a missing keyset
   file and a hardware key that is not usable now.
3. Which failure of a hardware key is "gone", which is "not usable now"
   and which is "damaged or changed" (rule 1).
4. The names of the keyset files and of the file that is written while
   one is replaced ([Where keys are stored](#where-keys-are-stored)).
5. Rule 4 decides the number of a new hardware key. A number can come
   back.
6. What "a keyset is made" means in rule 3. Rule 2 has no exception.
   Step 1.7, session A gave rule 2 three exceptions
   ([Decided in step 1.7, session A](#decided-in-step-17-session-a)).
7. `file-key-old` moves to the Unlocked key too, and the move waits
   while the phone is locked.
8. The three states of the app lock.
9. How typed words are read, and the three results for entered words
   ([Entering it](#entering-it)).
10. Record and file IDs come only in the 36-character form.
11. `core/crypto` itself refuses a backup and the app lock while
    `file-key-old` exists.
12. The screen lock is asked from `KeyguardManager`. The provider check
    runs at every way into the module.

## Decided in step 1.7, session A

The owner's decisions of 2026-11-13, in step 1.7, session A. The code
for open questions 11 and 12 came first, in its own pull request; the
recovery key screens, with open questions 3, 4 and 5, came in the next.
Each is built into the page above.

| Question | Decision |
|---|---|
| How a user starts over after a setup that stopped half way (open question 11) | An explicit start over, offered only while the setup is unfinished. The old file keys join `file-key-old`, and the `backup` of the stopped setup is written over. It is an exception to rule 2, and the page says why it is safe ([Starting over after a setup that stopped](#starting-over-after-a-setup-that-stopped)). |
| A keyset file that is damaged while its hardware key lives (open question 12) | Repair with proven words: an exact match of another stored keyset. The damaged file is copied aside and kept, never deleted, and the keyset is stored again ([A damaged keyset file](#a-damaged-keyset-file)). |
| A damaged keyset that no words can bring back | "Give up these files", offered only when `file-key-old`, or the `file-key` of an app without `record`, is damaged. A plain warning comes first: those files can then not be opened on any device. |
| `file-key` damaged under the app lock | Repaired in this step, under a key that needs no prompt. The app lock is then off. The message to the user comes with the app lock screens in session B. |
| The QR code (open question 3) | Words only for now. Nothing draws or scans a QR code. Decided again in Phase 5 ([The QR code](#the-qr-code)). |
| The permission `USE_BIOMETRIC` (open question 4) | [ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md): `core/security` declares it, Catalog removes it, and the APK rules check allows it per app from Water on (steps 2.4 and 2.5). No owner-only file changed in step 1.7. |
| AndroidX Biometric (open question 5) | Used nowhere. The app lock uses Android's own prompt too. ADR 0003, point 4, says so. |

The independent review of this step found five things in the code of
session B. Each is fixed and tested:

1. A keyset kept in memory was dropped only when a setup succeeded. After
   a change that failed half way, file code went on with the old keyset.
   Now every write of a keyset file drops them all.
2. The move from the random `file-key` could be finished, and
   `file-key-old` deleted, before the app had `record`. Now it cannot.
3. Whether a row is sealed by the current key is told by the key ID
   alone. A new recovery key could share its ID with the random
   `file-key`. Now a new key avoids every stored ID, entered words with
   an ID in use are refused, and a keyset with an ID twice does not
   open.
4. A damaged `file-key-old` stopped every file and every setup. Now it
   counts as absent.
5. Keeping a recovery key trusted its caller. Now the app keeps only the
   current recovery key of its stored `record`.

## Decided in step 1.7, session B

The owner's decisions of 2026-11-13, in step 1.7, session B, with the
app lock screens. Each is built into the page above, or into
[security-screens.md](../architecture/security-screens.md#the-app-lock)
and [notifications.md](../architecture/notifications.md#while-the-app-lock-is-on).

| Question | Decision |
|---|---|
| Checking the words in an app that does not keep the recovery key (open question 1) | All 24 words, on the screen of "Entering it". Words that give this app's own `record` key are the proof. No four words on top, and the key is not kept. A keeper asks for four words, as before. Whether a keeper can check for another app stays open for step 3.0. |
| Proving the check in code | `AppLock.beginTurnOn` takes a `WordsProof`. Only `KeySetup.checkFourWords` and `KeySetup.checkAllWords` make one. It names the key ID of the `record` key it was checked against, and `beginTurnOn` refuses a proof for another key (the owner's review of pull request 29). |
| A keeper app that cannot read its kept recovery key | It asks for all 24 words instead: the same check as an app that does not keep the key. Confirmed in the owner's review of pull request 29. |
| The kept recovery key during the four words | It leaves memory when the screen stops, as on the screen that shows the words. A turn of the phone does not count. The prompt asks again on the way back (the owner's review of pull request 29). |
| When the app locks | When it leaves the screen (the default), or after 1, 5 or 15 minutes or 1 hour away. Time away is counted with a clock the user cannot change. The app always locks when the screen turns off with the app on it, and after Android stopped it. |
| What a waiting app learns of a screen that turned off | Nothing sure. The screen-off broadcast is held back on Android 14 and later, and a late one is ignored. "Keys in memory", point 5, says what happens; the user guide says it plainly. |
| What a notification shows while the app lock is on | Only its channel's name and a fixed text, unless the user turns on "Show the text in notifications". Turning the app lock on posts the shown notifications again in that form. If the state cannot be read, the text is hidden. |
| The app lock screen | It asks for the system prompt each time it opens while the app lock is on, before it shows anything. Closing the prompt closes the screen. |

## Open questions

What is left, with the step that decides it.

1. **Checking the paper copy in an app that is not a keeper**, before
   the app lock is turned on. Decided in step 1.7, session B, for an app
   that does not keep the key: it asks for all 24 words, and words that
   give its own `record` key are the proof (rule 2 of "The app lock").
   Still open for the handover step (3.0): whether a keeper can do the
   check for another app.
2. **The handover interface**: its screen, its signature permission and
   its decision record. Also what happens when the asking app already
   has keys, or has its app lock on. The handover step (3.0).
3. **The QR code.** Decided in step 1.7, session A: words only for now,
   decided again in Phase 5 ([The QR code](#the-qr-code)).
4. **The permission `USE_BIOMETRIC`.** Decided in step 1.7, session A
   ([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)).
5. **AndroidX Biometric.** Decided in step 1.7, session A: used nowhere
   ([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)).
6. **A new recovery key.** The whole flow: how other devices, other apps
   and the server learn of it, when old keys are dropped, how old sealed
   records are sealed again, and how sealing file keys again fits "last
   writer wins". It must keep the rules under "A new recovery key".
   Phase 5.
7. **The sync signing key.** Proposal: ECDSA P-256 in the Keystore,
   because StrongBox must support it, with the settings of a Background
   key so that sync works while the phone is locked. Phase 5.
8. **The largest sealed record.** The server's limits decide. Phase 5.
9. **File ciphertext that arrives while the app is locked** is stored
   unchecked until the file is opened. A hostile server could fill
   storage with bytes that never open. Should the file's record carry a
   hash of the ciphertext? Phase 5.
10. **The threat model page.** Written in step 1.8:
    [threat-model.md](threat-model.md).
11. **Starting over after a setup that stopped half way.** Decided in
    step 1.7, session A
    ([Starting over after a setup that stopped](#starting-over-after-a-setup-that-stopped)).
12. **A keyset file that is damaged while its hardware key lives.**
    Decided in step 1.7, session A
    ([A damaged keyset file](#a-damaged-keyset-file)).
13. **Files whose keys were given up.** Their records stay, and their
    files can never be opened again. How does an app show them: hide
    them, mark them, or offer to delete them? Decided with the first app
    that stores files.
14. **Repair once a keyset holds keys of two recovery keys.** Repair
    needs an exact match of another stored keyset. After a new recovery
    key, each keyset holds keys of two recovery keys, and the new words
    alone derive only one of them. So repair does not work then.
    Phase 5, with the new recovery key.
