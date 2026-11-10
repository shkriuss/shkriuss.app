# 0007 Recovery key instead of passwords

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decisions 3 and 12), 6
  and 7, and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4)

## Context

- Every app works fully with no account and no network (section 1).
- Backups and sync data are encrypted by the app (decision 3).
- Each user runs the sync server in their own Cloudflare account
  (section 7).

## Decision

1. The account is a recovery key plus per-device keys.
2. The recovery key is a random 256-bit key. It is shown as words and as a
   QR code.
3. All backup and sync keys derive from the recovery key.
4. No passwords.
5. Each device has its own non-exportable signing key for sync. The server
   checks it. See [0006](0006-tink-and-key-hierarchy.md).
6. No Cloudflare Access.
7. Backup and restore to a file stays. See
   [0008](0008-backup-file-format.md).
8. A lost recovery key cannot be recovered by anyone. There is no reset,
   because the server holds only ciphertext.

## Options rejected

- **Passwords.** People pick weak ones, so they need slow hashing, which in
  practice means C code. A random 256-bit key needs none. A forgotten
  password could not be reset anyway, because the server holds only
  ciphertext.
- **Cloudflare Access.**
  - It checks who is at the door and encrypts nothing, so the recovery key
    is still needed.
  - It is built around a browser login. The apps have no WebView
    ([0019](0019-no-webview-no-runtime-code-loading.md)).
  - Its sessions expire, which would stall background sync.
  - It adds an identity provider for a backend with one user.
  - It ties every self-hoster to Cloudflare Zero Trust.

## Consequences

- Restoring a backup and setting up sync both need the recovery key,
  because their keys derive from it.
- If the recovery key is lost, data on devices that are already set up
  stays usable.
- If the recovery key and every device are lost, synced data and backup
  files cannot be opened. The user guide must say so.
- The self-hosting guide may show Cloudflare Access as an optional extra
  lock, with a service token.
- Open: how the recovery key is shown as words, how the user enters it
  again, and whether a device that is already set up can show the key
  again after the user authenticates. These are decided in
  `docs/security/crypto-design.md` in Phase 1, step 4, which completes this
  record ([PROMPTS.md](../development/PROMPTS.md)).
