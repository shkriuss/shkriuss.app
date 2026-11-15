# Signing key rehearsal files

The workflow that [signing-key-rehearsal.md](../signing-key-rehearsal.md)
asks you to paste into signing-ceremony. It never runs in shkriuss.app:
GitHub runs workflows only from `.github/workflows/`.

- [`check-backup.yml`](check-backup.yml): goes into signing-ceremony, as
  `.github/workflows/check-backup.yml`. It checks the real backup and its
  copies, and changes nothing. Its comments call these two checks parts
  D and E: [Check the real backup](../signing-key-rehearsal.md#check-the-real-backup)
  and [Check the two copies](../signing-key-rehearsal.md#check-the-two-copies).
  It uses no action, because signing-ceremony allows only your own
  actions. It checks out with plain git.

To view it as plain text on a phone, open it and tap **Raw**. To copy
it, use the copy button at the top of the file.
