# 0006 Tink and the key hierarchy

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 3), 3, 6, 10
  and 17, and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

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

## Decision

1. Tink for Java is the only cryptography library.
2. All cryptography lives in `core/crypto`. It is documented in
   `docs/security/crypto-design.md`.
3. Device key: kept in the Android Keystore, backed by StrongBox where
   available, and usable only while the device is unlocked.
4. The optional app lock ties the device key to user authentication.
5. Primitives, all from Tink:
   - XChaCha20-Poly1305 for records that leave the database for sync. Each
     record is sealed on its own, so the server stores one opaque blob per
     record.
   - AES-GCM-HKDF streaming for files, attachments and the backup file.
   - HKDF for key derivation.
6. Rows at rest in the local database are not encrypted by the app. See
   [0004](0004-room-on-system-sqlite-no-sqlcipher.md).
7. Account: a random 256-bit recovery key. All backup and sync keys derive
   from it. See [0007](0007-recovery-key-instead-of-passwords.md).
8. Sync identity: a non-exportable signing key per device, checked by the
   server.

## Options rejected

- **libsodium.** A C library.
- **Argon2.** C code in practice. It is also not needed, because there is
  no password to stretch.
- **Bouncy Castle.** Large and not needed. Tink covers everything the
  project uses.
- **EncryptedSharedPreferences.** It is deprecated.
- **Hand-written file encryption.** The project never invents
  constructions. Tink's streaming encryption is used.

## Consequences

- No `javax.crypto` or Tink calls outside `core/crypto`
  ([CLAUDE.md](../../CLAUDE.md)).
- No new constructions. Only the ones documented in
  `docs/security/crypto-design.md` (CLAUDE.md).
- Anything that needs the device key works only while the device is
  unlocked.
- Open: the full key hierarchy, the parameters, the byte layouts, key
  rotation, and what happens when StrongBox is missing. They come in
  `docs/security/crypto-design.md` in Phase 1, step 4, which completes this
  record ([PROMPTS.md](../development/PROMPTS.md)).
- Open: which Tink artifact to use, and a check that no Play services
  provider is ever used (section 17).
