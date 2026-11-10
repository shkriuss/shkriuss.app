# 0006 Tink and the key hierarchy

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 3), 3, 6, 10
  and 17

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
   - XChaCha20-Poly1305 for records.
   - AES-GCM-HKDF streaming for files.
   - HKDF for key derivation.
6. Account: a random 256-bit recovery key. All backup and sync keys derive
   from it. See [0007](0007-recovery-key-instead-of-passwords.md).
7. Sync identity: a non-exportable signing key per device, checked by the
   server.

## Options rejected

- **libsodium.** Reason not recorded.
- **Argon2.** Reason not recorded. Note: section 6 says the account uses no
  passwords.
- **Bouncy Castle.** Reason not recorded.
- **EncryptedSharedPreferences.** It is deprecated.

## Consequences

- No `javax.crypto` or Tink calls outside `core/crypto`
  ([CLAUDE.md](../../CLAUDE.md)).
- No new constructions. Only the ones documented in
  `docs/security/crypto-design.md` (CLAUDE.md).
- Anything that needs the device key works only while the device is
  unlocked.
- Open: which records are encrypted with XChaCha20-Poly1305. Decision 3
  says database rows rely on Android's file-based encryption, so
  `crypto-design.md` needs to say which records this means.
- Open: the full key hierarchy, the parameters, the byte layouts, key
  rotation, and what happens when StrongBox is missing. They come in
  `docs/security/crypto-design.md` in Phase 1, step 4, which completes this
  record ([PROMPTS.md](../development/PROMPTS.md)).
- Open: which Tink artifact to use, and a check that no Play services
  provider is ever used (section 17).
