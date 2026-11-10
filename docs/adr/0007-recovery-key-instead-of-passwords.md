# 0007 Recovery key instead of passwords

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decisions 3 and 12), 6
  and 7

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

## Options rejected

- **Passwords.** Reason not recorded.
- **Cloudflare Access.** Reason not recorded.

## Consequences

- Restoring a backup and setting up sync both need the recovery key,
  because their keys derive from it.
- Open: how the recovery key is shown as words, and how the user enters it
  again. This comes in `docs/security/crypto-design.md` in Phase 1, step 4,
  which completes this record ([PROMPTS.md](../development/PROMPTS.md)).
- Open: what happens when a user loses the recovery key. The plan does not
  say.
