# Cryptography design

Every key the apps use, where it lives, what it protects, and the exact
bytes of everything the apps encrypt. All cryptography in the suite
follows this page.

- Status: design, written on 2026-11-12 in Phase 1, step 4
  ([PROMPTS.md](../development/PROMPTS.md)). No code exists yet.
- The code will be `android/core/crypto`. It must follow this page
  exactly. If this page is wrong or unclear, the fix is a change to this
  page first, agreed with the owner.
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

The page ends with every [assumption](#assumptions) and every
[open question](#open-questions).

## At a glance

| Part | Choice |
|---|---|
| Library | Tink for Java, artifact `tink-android` 1.24.0. Nothing else. |
| Records for sync | XChaCha20-Poly1305, one sealed blob per record |
| Files and backups | AES-256-GCM-HKDF streaming, 1 MiB segments |
| Key derivation | HKDF-SHA256, through Tink's `KeysetDeriver` |
| Account | One random 256-bit recovery key, shown as 24 words and a QR code |
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

The threat model page does not exist yet. This table follows section 10
of the [plan](../plan/PLAN.md).

| Against | What protects the data |
|---|---|
| A lost or stolen phone | Android's file-based encryption. Keys are wrapped by hardware keys that never leave the phone. With the app lock on, file keys also need the system prompt. |
| Other apps on the phone | The app sandbox. Each app has its own hardware keys. Apps of the suite give keys to each other only through a signature-protected screen, after a system prompt. |
| A network attacker, a curious or hostile sync server | They see only sealed records and encrypted files. A changed, cut or swapped blob does not open. |
| A malicious library inside one app | It can reach that app's data and derived keys. It cannot reach the recovery key without a system prompt, and never the keys of another app. |
| A weak or reused password | There is no password ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md)). |

Not protected, by decision or by nature:

- A compromised operating system, an unlocked phone in an attacker's
  hands, a malicious keyboard or accessibility service, coercion, and
  traffic analysis (plan section 10).
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
   2026-10-16. Session B adds it to the version catalog and to the
   dependency verification file.
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
`GmsCore_OpenSSL`, which belongs to Google Play services. Tink never
installs a provider. The second one exists in an app only if the app
itself calls Play services' `ProviderInstaller`. The apps have no Play
services code, so it cannot exist. Two checks make sure it stays so:

1. `core/crypto` refuses to work if a provider named `GmsCore_OpenSSL`
   is installed. A unit test installs a fake one and expects the refusal.
2. A build check fails if any app contains a class under
   `com.google.android.gms`. Where this check lives is an
   [open question](#open-questions).

### Where Android does the work, not Tink

A hardware key cannot leave the Keystore, so the Keystore itself must do
every operation with it. Tink has a helper for that,
`AndroidKeystore`. `core/crypto` uses the helper where it can, and calls
Android directly in three places:

| Task | How |
|---|---|
| Make a hardware key | Tink: `AndroidKeystore.generateNewKeyWithSpec` |
| Use a hardware key that needs no prompt | Tink: `AndroidKeystore.getAead(alias)` |
| Delete a hardware key, or ask whether it exists | Tink: `AndroidKeystore.deleteKey`, `hasKey` |
| Use a hardware key that needs the system prompt | Direct: `javax.crypto.Cipher`, `AES/GCM/NoPadding`, on the key from the `AndroidKeyStore` key store. The prompt must be given the cipher object, and Tink's helper keeps its cipher to itself. |
| Read whether a key is in StrongBox | Direct: `SecretKeyFactory` and `KeyInfo` |
| The checksum of the recovery words | Direct: `java.security.MessageDigest`, SHA-256. Tink has no public plain hash. It is a checksum, not a secret. |

The direct cipher call makes exactly the bytes that Tink's helper makes:
a 12-byte IV chosen by the Keystore, the ciphertext, and a 16-byte tag.
A test vector below proves the layout.

`core/crypto` hands the screen code a ready
`BiometricPrompt.CryptoObject`. The screen code never sees a cipher.

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
   key of that kind is made. Every wrapped keyset names the kind and the
   number of the key that wrapped it.
3. The two prompt keys do not also ask for an unlocked phone. A prompt
   for every use is the stronger rule, and fewer settings mean fewer
   differences between Android versions.

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
its next start and moves the two keysets under it.

### Keysets

| Name | Tink key type and parameters | Made | Wrapped by |
|---|---|---|---|
| `recovery` | `HkdfPrfKey`: HKDF-SHA256, 32-byte key, no salt. One key per recovery key. The key's value is the recovery key. | When a recovery key is created or entered in this app | Recovery guard |
| `record` | `XChaCha20Poly1305Key`, variant `TINK` | Derived from the recovery key | Background key |
| `backup` | `AesGcmHkdfStreamingKey`, the predefined `AES256_GCM_HKDF_1MB` | Derived from the recovery key | Unlocked key |
| `file-key` | `XChaCha20Poly1305Key`, variant `TINK` | No recovery key: one random key. With one: derived from it. | Lock key if the app lock is on, else Unlocked key |
| File key | `AesGcmHkdfStreamingKey`, `AES256_GCM_HKDF_1MB` | Random, one per file content | The `file-key` keyset |

`AES256_GCM_HKDF_1MB` means: a 32-byte key, a 32-byte AES-256-GCM key
derived for each stream, HKDF-SHA256, and ciphertext segments of
1,048,576 bytes.

After a keyset is read, the code checks that it holds only the key type
and parameters of this table. Anything else is refused.

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
4. A new recovery key whose key ID is 0, or equal to the ID of a recovery
   key the app already has, is thrown away and made again. The chance is
   about 1 in 4 billion.

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

1. The old keyset is stored as `file-key-old`. The derived keyset becomes
   `file-key`.
2. The app opens each wrapped file key with the old keyset and seals it
   again with the new one. It writes the row through `RecordWriter`.
   This can stop and go on later.
3. When no row is left, `file-key-old` is deleted.
4. To open a wrapped file key, the app tries `file-key` first, then
   `file-key-old`.
5. While `file-key-old` exists, the app makes no backup, sends no file
   record to sync, and cannot turn the app lock on. A file key sealed by
   a key that exists only on this phone must never leave it.

### Where keys are stored

| What | Where | Form |
|---|---|---|
| Hardware keys | Android Keystore | Cannot be read out |
| `record`, `backup`, `file-key`, `file-key-old`, `recovery` | One file each in `shk-keys/` inside the app's no-backup files folder | Keyset wrapped by a hardware key (kind 5) |
| File keys | The file's database row | Wrapped file key (kind 4) |
| Files | The app's private storage | File stream (kind 2) |
| The recovery key in the clear | Nowhere. On paper, with the user. | 24 words |

1. Every app turns Android's own backup and device transfer off, as
   Catalog does (`android:allowBackup="false"` and data extraction rules
   that exclude everything).
2. A keyset file is replaced by writing a new file and renaming it over
   the old one.

### Keys in memory

1. The recovery key is in memory only while it is created, entered,
   shown, or used to derive keys. Then every reference is dropped.
2. The `record` keyset is loaded when needed and may stay for the life of
   the process.
3. The `backup` keyset is loaded for one backup or restore and then
   dropped.
4. The `file-key` keyset is loaded when a file is opened or added. With
   the app lock on it is loaded by the prompt and dropped when the app
   locks.
5. Every keyset except `record` is dropped when the screen turns off.
6. Kotlin cannot wipe memory for certain. Dropping references is the best
   the app can do. Keys are held as Tink objects, never as text.

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
   `00112233-4455-4677-8899-aabbccddeeff` is `00 11 22 ... EE FF`.
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
- A file can be up to 2^32 segments long, about 4,000 terabytes.

### Kind 3: backup stream

| Offset | Size | Content |
|---|---|---|
| 0 | 5 | Header: `53 48 4B 01 03` |
| 5 | ... | A Tink stream, as in kind 2 |

- Keyset: `backup`. Associated data: header + the whole backup header.
- The backup header, the place of this stream in the file, and what is
  inside the stream belong to step 1.5 and
  [ADR 0008](../adr/0008-backup-file-format.md). This page asks four
  things of that format:
  1. The backup header is not secret and is given to `core/crypto` as
     the context, byte for byte.
  2. It contains the key ID, so the app can say "wrong recovery key"
     before it decrypts.
  3. A backup never contains the recovery key, any keyset, or anything
     wrapped by a hardware key.
  4. A backup contains file keys only as wrapped file keys, exactly as
     they are in the rows.

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
  `TinkProtoKeysetFormat.serializeKeyset`. Today that is 129 bytes, so
  the blob is 179 bytes.
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
2. Turning it on asks for some of the recovery words again. That proves
   the paper copy exists before the app depends on it. How an app that is
   not a keeper checks the words is an
   [open question](#open-questions).
3. Why rule 1: the Lock key is removed when the screen lock is removed.
   The `file-key` keyset is then gone from the phone. Because it derives
   from the recovery key, the words bring it back. A random keyset could
   never come back.

### Turning it on, unlocking, turning it off

Turn on:

1. Make a new Lock key.
2. Show the system prompt for an encrypt operation with that key.
3. Wrap the `file-key` keyset with it and replace the keyset file.

Unlock:

1. Read the IV from the `file-key` keyset file. Start a decrypt operation
   with the Lock key.
2. Show the system prompt for that one operation.
3. Decrypt. The keyset stays in memory until the app locks.

One prompt, one operation, one unlock. No other key is behind this
prompt.

Turn off, while unlocked:

1. Wrap the `file-key` keyset with the Unlocked key (Background key on
   Android 13 and 14). Replace the keyset file.
2. Delete the Lock key.

### What works while an app is locked

| Task | App locked, phone unlocked | Phone locked |
|---|---|---|
| Seal changed records and hand them to the Sync app | Works | Works |
| Take in sealed records and write them to the database | Works | Works |
| Hand out and take in file ciphertext | Works. No key is needed. | Works |
| Records of files, in both directions | Work. The file key travels wrapped. | Work |
| Alarms and notifications | Work. They need rows only. | Work |
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
   them and store them.
5. If the phone has a screen lock, the app keeps the recovery key: it
   makes a Recovery guard, shows the system prompt, and stores the
   `recovery` keyset. The app is now a keeper. If the user cancels the
   prompt, the key is not kept and everything else still works.
6. The recovery key is dropped from memory.

If the user leaves before step 4, nothing was stored and the key is
gone. Starting again makes a new one.

### The words

1. The 24 words are the BIP-39 encoding of the 32 bytes, with the BIP-39
   English word list of 2048 words. SHA-256 of the list file `english.txt`:
   `2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda`.
   A test checks the list in the app against this value.
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

1. The QR code holds this text: `SHKRIUSS-RK1`, one space, then the 24
   words in upper case with one space between them.
2. `1` is the version of this text format.
3. The text uses only characters of the QR alphanumeric mode. It is at
   most 228 characters. Error correction level M. The smallest QR
   version that fits, at most version 9 (53 by 53 modules).
4. A reader checks the start of the text, then treats the rest as typed
   words.
5. What draws the code and what scans it are
   [open questions](#open-questions). Until then, the words are typed.

### Entering it

1. The user types 24 words. The field offers words from the list. The
   first four letters of a word are enough to know it.
2. The app trims spaces, makes the text lower case, and splits it at
   spaces.
3. It checks: 24 words, each in the list, and the checksum byte.
4. Messages: "Word 7 is not in the word list." or "These words do not
   belong together. Check each word." Nothing more.
5. The app computes the key ID. If the app already has derived keys, the
   key ID must match theirs. A different recovery key is taken only
   through "new recovery key" (see [Key rotation](#key-rotation)).
6. Then as "Creating it" from step 4. An app where the words were entered
   is a keeper, if the phone has a screen lock.

### Screens that show or take the words

1. The window blocks screenshots, screen recording and the recent-apps
   preview (`FLAG_SECURE`, and `setRecentsScreenshotEnabled(false)`).
2. The app never puts the words or the QR text on the clipboard. The
   words cannot be selected.
3. The entry field turns off autofill, spell check and keyboard learning.
4. TalkBack reads the words aloud if it is on. The screen says so before
   it shows them.
5. The recovery key is never in a log, a crash, a notification, a backup
   file, Android's own backup, or a sealed record.

### Showing it again

1. Only a keeper app can. The user asks for it in the app's settings.
2. The app starts a decrypt operation with the Recovery guard and shows
   the system prompt. One prompt, one showing.
3. It shows the words and the QR code. When the screen closes, the key is
   dropped from memory.

### Keeper apps and other apps

A keeper is an app where the recovery key was created or the words were
entered, on a phone with a screen lock. Several apps can be keepers.

| Question | Answer |
|---|---|
| What does an app that is not a keeper show? | If a keeper is on the phone: "The recovery key is kept in Water", with a button that opens Water. If none is: "The recovery key is not kept on this phone", with the choice to enter the words. |
| The keeper is uninstalled, or its data is cleared | Its copy is gone. The other apps keep working with their own keys. No app can show the key or set up a new app until the words are entered in some app. Nothing else is lost. |
| How does another app become a keeper? | The user enters the 24 words in that app. It checks the key ID against its own keys, then stores the key under its own Recovery guard after the prompt. |
| How are apps set up before the handover below exists? | By entering the words in each app. Each such app is a keeper. Nothing changes for them when the handover arrives. |

### Setting up a second app on the same phone

Decided by the owner on 2026-11-12: the second app gets its own derived
keys and never the recovery key.

1. The new app opens a screen of a keeper app. That screen can be opened
   only by apps signed with the suite's key.
2. The keeper names the asking app and asks the user to allow it.
3. The keeper shows the system prompt. Its Recovery guard needs it, so
   the hardware enforces this step.
4. The keeper derives the three keysets for the asking app's name. It
   takes the name from the application ID that Android reports for the
   caller, never from what the caller says.
5. It returns the three keysets. The new app wraps and stores them. It is
   not a keeper.
6. The keeper drops the recovery key from memory.

So an app set up this way never holds the root, even for a moment. The
interface, its permission and when it is built are
[open questions](#open-questions).

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
   open. Set a screen lock to turn the app lock on again.
5. **App data cleared.** Android deletes the app's hardware keys together
   with its data. Set the app up again: from a keeper app, or with the
   words. Then sync, or restore a backup. Without a recovery key and
   without a backup, the data is gone. That is what clearing data means.
6. **New phone.** No key moves to a new phone. Install the apps. Enter
   the words, or scan the QR code shown by a keeper on the old phone.
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

One case is left. It is the first [open question](#open-questions): the
app lock is on, the screen lock is removed, and the words are lost.

## StrongBox and other hardware

1. If the phone reports `FEATURE_STRONGBOX_KEYSTORE`, a hardware key is
   made with `setIsStrongBoxBacked(true)`.
2. If Android answers `StrongBoxUnavailableException`, the key is made
   again without that setting. It then lives in the trusted execution
   environment (TEE). It still cannot be read out.
3. After making a key, the app reads its security level from `KeyInfo`:
   StrongBox, TEE or software.
4. The app's security screen shows the level of each key.
5. A key is never moved to a weaker level by itself. A key that stops
   working is treated as lost. See "When things change".
6. A phone with a software-only Keystore gets a clear notice. Whether the
   apps should refuse to keep keys there is an
   [open question](#open-questions).
7. StrongBox is slow and handles few operations at a time. That is why
   hardware keys wrap only keysets, and why `core/crypto` uses them one
   at a time.
8. The owner's three test devices all have StrongBox.

## Key rotation

There is no rotation by calendar. Keys change on these events.

| Key | Changes when | How |
|---|---|---|
| Hardware key | The app lock is turned on (a new Lock key each time). A key of a kind is made again after it was lost. The phone moves to Android 15. | Make the key with the next number. Wrap the keysets with it. Replace the keyset files. Then delete the old key. A stop in the middle leaves the old key and old files in use. |
| File key | The file's content changes | A new key and a new stream. The old stream and key are dropped with the old content. |
| Random `file-key` key | The app gets a recovery key | See "The file-key keyset without a recovery key" |
| Recovery key | The user asks for a new one, for example after a device was lost | See below |
| Algorithm or layout | A decision record says so | A new version byte for that kind. Readers for every older version stay. |
| Tink | A new release | Tink keeps its formats stable. The test vectors on this page catch a change. |

A new recovery key, on one device:

1. A keeper app creates it exactly as the first one: shown, written
   down, confirmed.
2. It becomes the primary in `recovery`. The old one stays in the keyset.
   This takes two prompts: one to read the keyset, one to store it.
3. Each derived keyset gets a second key. New records, backups and
   wrapped file keys use the new one. Old blobs still open, because the
   old keys stay and every blob names its key ID.
4. File keys are sealed again under the new `file-key` key, row by row.
   The files themselves are not touched.
5. A backup made before the change opens only with the old recovery key.
   The user makes a new backup.

What a new recovery key cannot do: it cannot take back what the old key
could already open. How the change reaches other devices, other apps and
the server, and when old keys are dropped, is for the sync design
([ADR 0009](../adr/0009-sync-protocol-and-server.md), Phase 5).

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

QR text       SHKRIUSS-RK1 ABANDON AMOUNT LIAR AMOUNT EXPIRE ADJUST
              CAGE CANDY ARCH GATHER DRUM BULLET ABSURD MATH ERA LIVE
              BID RHYTHM ALIEN CROUCH RANGE ATTEND JOURNEY UNAWARE
              (one line, single spaces, 162 characters)

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

The real backup header comes in step 1.5. This vector uses the ASCII
text "example backup header" in its place.

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
`01020304`, sealed by the `file-key` key for water.

```text
file key as Tink's binary keyset, 129 bytes
0884868808127a0a6f0a3d747970652e676f6f676c65617069732e636f6d2f67
6f6f676c652e63727970746f2e74696e6b2e41657347636d486b646653747265
616d696e674b6579122c120808808040102018031a20a0a1a2a3a4a5a6a7a8a9
aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf18011001188486880820
03

nonce            808182838485868788898a8b8c8d8e8f9091929394959697
associated data  53484b01040f1e2d3c4b5a49788695a4b3c2d1e0ff

blob, 179 bytes
53484b010401b19d376f808182838485868788898a8b8c8d8e8f909192939495
9697cbcbd5a5a1b269ffb22f24a369f2ab622a5bcab7e477b267230a8c4cc59a
bfcf15ee227a4e728f3dc3151d0bb5be98da0e9bfd6cc1a29a0ad86c7c849531
c96049b712bf08201c14f6d679ab13b2225e11ba4b9b148ec63811cb3c3d1c08
6f2374ef967de12e30acdbc4b72e4cc6d95d6c2daad20f695983eb8f19cd9de6
a58c5c6ea8b617d203cb024a02902c6a4054c5
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

For session B. Unit tests run on the JVM with Robolectric, where no
Keystore exists. So `core/crypto` takes its hardware keys through an
interface passed in by constructor, and the tests pass a software one
with the same byte layout.

1. Every vector on this page, and the published ones.
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
   imports Tink, `javax.crypto` or `java.security.KeyStore`.
9. Emulator tests in GitHub Actions on Android 13, 14, 15 and the newest:
   each hardware key kind is made and used. After the screen lock is
   changed, removed and set again, and after a fingerprint is enrolled,
   each key is there or gone as the table in "When things change" says.
   Emulators have no StrongBox. The owner checks StrongBox on the three
   devices.

## Assumptions

Things this page takes as true, or chose without a decision by the
owner. Each one is a place to object.

1. Deriving keys with Tink's `KeysetDeriver` and our labels counts as a
   construction that Tink provides. The labels are names, not
   cryptography.
2. Four bytes of HKDF output, under their own label, are safe to publish
   as a key ID.
3. Sealing a keyset means Tink's AEAD over Tink's binary keyset, not
   `serializeEncryptedKeyset`. The reason is under kind 5.
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
9. The app name in the labels is the same for a preview build and its
   app. A preview build that is given the words derives the same keys.
10. The words are BIP-39 English, 24 words, encoding only.
11. The QR text is `SHKRIUSS-RK1` plus the words in upper case, at error
    correction level M.
12. Setup asks for four of the 24 words. Turning the app lock on asks for
    some of the words again.
13. A recovery key whose key ID is 0, or is already known to the app, is
    made again.
14. Android behaves as its reference says, also on GrapheneOS, in a
    secondary profile and in Private Space: keys that need a prompt are
    removed with the screen lock and not by a fingerprint change;
    `setUnlockedDeviceRequired` is safe from Android 15; a key with no
    such setting is not removed by any lock or fingerprint setting. Read
    in the reference of `KeyGenParameterSpec.Builder`. The binding of a
    prompt key to the device credential, and the deletion of an app's
    keys when its data is cleared, were also read in Android 16's source.
    The emulator tests and the three devices must confirm all of it.
15. A key that accepts fingerprint and device credential can be made with
    no fingerprint enrolled. Read in Android 16's source.
16. `setInvalidatedByBiometricEnrollment(false)` is set although the
    device credential already makes it unnecessary. It makes the intent
    plain.
17. The prompt keys do not also set `setUnlockedDeviceRequired`.
18. After an update to Android 15 the app moves `backup` and `file-key`
    under a new Unlocked key by itself.
19. `GmsCore_OpenSSL` exists only if an app installs it. Read in Tink's
    source at tag `v1.24.0`.
20. Tink keeps its key and ciphertext formats stable across releases, as
    it promises.
21. Kotlin cannot wipe memory for certain. Dropping references and
    dropping keysets when the screen turns off is enough for this threat
    model.
22. Android's own backup stays off in every app, as in Catalog.
23. A sealed record is small enough to hold in memory.
24. `core/crypto` may depend on AndroidX Biometric, which
    [ADR 0003](../adr/0003-kotlin-compose-material-3-navigation-3.md)
    allows for the app lock, so that it can hand out a ready
    `CryptoObject`.
25. The Sync app holds no key from this page
    ([ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)). Its
    own signing key is part of the sync design.
26. A wrapped file key sealed by a random `file-key` key never leaves the
    phone: no backup and no file record goes out while `file-key-old`
    exists.

## Open questions

For the owner. Each has a proposal where there is one.

1. **App lock on, screen lock removed, words lost.** The files of that
   app on that phone can then never be opened. Other devices and the
   server copy are not affected. The design lowers the chance: the app
   lock needs a recovery key, and turning it on asks for the words. It
   cannot remove the case, because a key that needs the prompt dies with
   the screen lock. Is that accepted? The other choice is to keep file
   keys out from behind the prompt, which makes the app lock a screen
   only.
2. **Checking the paper copy in an app that is not a keeper.** It cannot
   compare single words. Proposal: it asks for all 24 words and compares
   the key ID. Or the keeper does the check through the handover screen.
3. **The handover between apps.** Its interface, its signature
   permission and its decision record are not written. It is first
   needed when the second data app arrives, in Phase 3. ADR 0005 puts the
   interface in Phase 5. Proposal: a step of its own before Phase 3.
4. **Protecting the handover on its way.** Proposal: the keysets go from
   app to app through Android's own call, with no further encryption.
   Only Android itself can see them, and a compromised Android is out of
   scope. The other choice is Tink's hybrid encryption to a one-time key
   of the asking app, which adds a primitive.
5. **Entering the words in a second app.** Today that makes it a keeper.
   Should it first ask "keep the recovery key in this app too"?
6. **The licence of the BIP-39 word list.** It must be confirmed before
   session B commits the list.
7. **Drawing the QR code.** It needs an encoder: our own code, or a new
   dependency with a decision record.
8. **Scanning the QR code.** It needs the camera permission and a
   decoder, so a decision record and an entry in
   [permissions.md](permissions.md). Until then the words are typed.
9. **Pasting the words.** Proposal: not offered, so the words are less
   likely to sit in a clipboard or a notes app.
10. **How many words to confirm.** Proposal: four at setup, four when the
    app lock is turned on.
11. **A software-only Keystore.** Proposal: allow it with a clear notice.
    Emulators need it.
12. **Preview builds share derived keys with their app.** A preview build
    that is given the words can read real backups. Proposal: accept, and
    say so in [test-a-pull-request.md](../development/test-a-pull-request.md).
13. **Tink's four companion libraries.** Accept Gson, JSR-305, Error
    Prone annotations and `annotation-jvm` as they come? They are
    verified like every other dependency.
14. **The build check for Play services classes.** The natural place is
    the APK rules check, which is an owner-only file. The owner must ask
    for that change in session B.
15. **A new recovery key across devices.** How other devices, other apps
    and the server learn of it, when old keys are dropped, and how old
    sealed records are sealed again. Phase 5.
16. **The sync signing key.** Proposal for Phase 5: ECDSA P-256 in the
    Keystore, because StrongBox must support it, with the settings of a
    Background key so that sync works while the phone is locked.
17. **The largest sealed record.** The server's limits decide. Phase 5.
18. **File ciphertext that arrives while the app is locked** is stored
    unchecked until the file is opened. A hostile server could fill
    storage with bytes that never open. Should the file's record carry a
    hash of the ciphertext? Phase 5.
19. **StrongBox cannot be tested in an emulator.** Proposal: a line in
    the release checklist of the first app that stores keys, checked on
    the three devices.
20. **The threat model page does not exist.** Prompt R2 in PROMPTS.md
    reads `docs/security/threat-model.md`. No step writes it yet.
