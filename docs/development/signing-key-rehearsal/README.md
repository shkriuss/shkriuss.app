# Signing key rehearsal files

The two workflows that
[signing-key-rehearsal.md](../signing-key-rehearsal.md) asks you to
paste into other repositories. They never run in shkriuss.app: GitHub
runs workflows only from `.github/workflows/`.

- [`rehearsal.yml`](rehearsal.yml): goes into the throwaway repository
  `key-rehearsal`, as `.github/workflows/rehearsal.yml`. Parts A and B:
  it signs with the restored throwaway key, rotates it, and makes the
  test APKs and drafts.
- [`check-backup.yml`](check-backup.yml): goes into signing-ceremony, as
  `.github/workflows/check-backup.yml`. Parts D and E: it checks the real
  backup and its copies, and changes nothing.

To view one as plain text on a phone, open it and tap **Raw**. To copy
it, use the copy button at the top of the file.
