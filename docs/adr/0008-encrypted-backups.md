# 0008. Encrypted backup files

Status: Accepted (2026-10-17). Changed by [ADR 0013](0013-photos-on-the-device.md)
and [ADR 0015](0015-photos-app.md): backups hold `localStorage` only, so photos
aren't in them, and the Photos app has no Back up or Restore. Changed by
audit 5: a locked file whose salt, nonce or data isn't the right size is
turned down as damaged (E-6, A-4); a restore replaces each key in its place
and says so if the old data couldn't all be put back (E-7); a plain copy
keeps every saved text exactly (E-8).

## Context

Data lives only on the device ([ADR 0006](0006-local-first-data.md)), so a
backup file is how people keep a copy or move to a new device. Until now that
file was plain JSON that anyone could read, and there was no way to load it
back. The same encryption will later be the base for an optional,
end-to-end encrypted account with sync between devices, so the format needs
to be solid and kept compatible. (In the end the account,
[ADR 0010](0010-account-and-sync.md), uses its own random key instead of this
format.)

## Decision

- **Every app's "Your data" section** (`<DataControls />`) has **Back up**,
  **Restore** and **Delete all data**. Apps get them without extra code.
- **Back up** makes a file locked with a passphrase by default. A plain copy
  is still available, with a warning that anyone with the file can read it.
- **Locking happens on the device** with the browser's Web Crypto, in
  `@shkriuss/storage/backup`. The passphrase and data never leave the device.
  - Key: **PBKDF2-SHA-256, 600,000 rounds** (OWASP's current advice), from a
    passphrase of at least 12 characters (Unicode NFC, so it matches across
    keyboards), with a random 16-byte salt. Argon2 would resist guessing
    better, but needs extra code (WebAssembly) that browsers don't include.
  - Encryption: **AES-256-GCM** with a random 12-byte nonce. The file's header
    (format, version, app, date, key settings) is authenticated as
    "additional data", so changing anything makes unlocking fail.
  - Files that ask for fewer than 100,000 or more than 10,000,000 rounds are
    refused (too weak, or too slow to open).
- **File format** (JSON, `.json`): `format: "shkriuss-backup"`, `version: 1`,
  `app`, `createdAt`, `kdf {name, hash, iterations, salt}`, `cipher {name, iv}`,
  `data` (the app's export, encrypted, base64). New versions must still read
  version 1 files.
- **Restore** accepts locked and plain backups, but only from the same app.
  Before anything is replaced, each part is checked by the app's own store:
  a backup from a newer version of the app, or one it can't read, is refused
  and nothing changes. Then it replaces the app's data on the device (after a
  clear warning), each key in its place; if the browser runs out of room
  part-way it puts the old data back, in an order that fits, and says so if
  another tab took the room meanwhile (then the backup, still at hand, is
  restored again, audit 5 E-7); and reloads the app.

## Consequences

- Backups are safe to keep in cloud drives or email. Their safety depends on
  the passphrase: a short or common one can be guessed by someone who has the
  file. The form asks for 12+ characters and suggests a few random words.
- A forgotten passphrase can't be recovered by anyone. The backup dialog says
  so.
- The app name and backup date are readable without the passphrase (they're
  in the header so the right app can recognise the file).

## Alternatives

- **Plain JSON only** (before): readable by anyone who gets the file.
- **Argon2id**: stronger against guessing, but ~30–60 KB of WebAssembly in
  every app. Revisit if browsers add it to Web Crypto.
- **A random recovery key instead of a passphrase**: strongest, but harder
  for people to keep safely. It may come with the account work.
