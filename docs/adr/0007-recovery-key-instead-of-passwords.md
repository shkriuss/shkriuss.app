# 0007 Recovery key instead of passwords

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decisions 3 and 12), 6
  and 7, and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4).
  Completed on 2026-11-12 in Phase 1, step 4
  ([PROMPTS.md](../development/PROMPTS.md)) with the owner's decisions in
  the planning session of that step and on
  [pull request 22](https://github.com/shkriuss/shkriuss.app/pull/22).
  The detail is in [crypto-design.md](../security/crypto-design.md).

## Context

- Every app works fully with no account and no network (section 1).
- Backups and sync data are encrypted by the app (decision 3).
- Each user runs the sync server in their own Cloudflare account
  (section 7).
- The suite is many apps. Each has its own storage and its own keys in
  the Android Keystore. A user should not type 24 words into every app.
- Android makes a key that needs a system prompt only on a phone with a
  screen lock, and deletes such keys when the screen lock is removed.

## Decision

1. The account is a recovery key plus per-device keys.
2. The recovery key is a random 256-bit key. It is shown as words.
   - The words are the BIP-39 encoding with the English word list: 24
     words, with a checksum. Only the encoding is used, not the BIP-39
     seed.
   - The word list is `english.txt` from Trezor's python-mnemonic, the
     BIP-39 reference implementation. It is MIT licensed.
   - The QR code of the plan is not built for now. It is decided when the
     recovery key screens are built.
3. The record keyset, the backup keyset and the file-key keyset of each
   app derive from the recovery key. A file key is random. It is sealed
   by the file-key keyset, so it is protected by the recovery key but not
   derived from it. See [0006](0006-tink-and-key-hierarchy.md).
4. No passwords.
5. Each device has its own non-exportable signing key for sync. The server
   checks it. See [0006](0006-tink-and-key-hierarchy.md).
6. No Cloudflare Access.
7. Backup and restore to a file stays. See
   [0008](0008-backup-file-format.md).
8. A lost recovery key cannot be recovered by anyone. There is no reset,
   because the server holds only ciphertext.
9. Setup makes the user write the words down and confirm four of them.
   Keys are derived only after that.
10. An app where the recovery key was created or entered keeps it on the
    device and can show it again. It is a keeper app. If another keeper
    is already on the phone, the app asks first whether to keep it too.
    - The kept key is wrapped by its own Keystore key, which needs the
      system prompt for every single use, with the app lock on or off.
    - Day-to-day work uses only the derived keys.
    - The kept key is a convenience, not a backup. The paper copy is the
      backup.
11. The recovery key is entered again by typing the 24 words. The app
    checks the word list and the checksum. It offers no paste.
12. A second app on the same phone is set up by a keeper app through a
    signature-protected screen, after the system prompt. It gets its own
    derived keys and never the recovery key. The keeper also checks the
    caller's signing certificate itself. The keys travel with no further
    encryption. This handover is a step of its own before Phase 3, with
    its own decision record.
13. The screens that show or take the words block screenshots and the
    recent-apps preview. The recovery key is never in a backup file, a
    log, the clipboard, a sealed record or Android's own backup.
14. On a phone with no screen lock the recovery key is shown at setup and
    not kept. Backup, sync and files work with the derived keys.

Point 2 first read: "It is shown as words and as a QR code." Point 3
first read: "All backup and sync keys derive from the recovery key." The
owner chose words only for now, and one random key per file, on
2026-11-12.

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
- **Showing the recovery key only once.** Adding a device or another app
  would always need the paper copy. The owner chose to keep it, behind a
  prompt for every use.
- **Keeping the recovery key under the same key as the day-to-day keys.**
  Code that runs in the app could then read the root with no prompt.
- **Handing the recovery key itself to a second app.** Every app could
  then show it. But every app, also the weakest, would hold the root.
  The owner chose derived keys only.

## Consequences

- Restoring a backup and setting up sync both need the recovery key,
  because their keys derive from it.
- If the recovery key is lost, data on devices that are already set up
  stays usable. One exception: an app with the app lock on, after the
  screen lock is removed. See [0006](0006-tink-and-key-hierarchy.md).
- If the recovery key and every device are lost, synced data and backup
  files cannot be opened. The user guide must say so.
- The self-hosting guide may show Cloudflare Access as an optional extra
  lock, with a service token.
- The words look like a cryptocurrency wallet phrase. They are not one.
  The user guide must say so.
- An app that was set up by a keeper cannot show the recovery key. It
  says which app on the phone keeps it.
- When a keeper is uninstalled or its data is cleared, its copy is gone.
  The other apps keep working. No app can show the key or set up a new
  app until the words are entered again in some app.
- Removing the screen lock deletes the kept copy in every keeper.
- Until the handover between apps is built, every app is set up by
  entering the words, so every such app is a keeper.
- The app needs the BIP-39 English word list, 2048 words. It is data, not
  a library. Its source and its MIT notice are recorded in
  `docs/development/third-party.md`, which session B creates, and the
  MIT text sits next to the list.
- A preview build makes the same keys from the same words as its app.
  Testers never type real recovery words into a preview
  ([test-a-pull-request.md](../development/test-a-pull-request.md#safety)).
- Open: the points listed under "Open questions" in
  [crypto-design.md](../security/crypto-design.md#open-questions). Those
  that touch this record are the handover interface and how an app that
  is not a keeper checks the paper copy (the handover step), the QR
  code (step 1.7), and a new recovery key across devices (Phase 5).
