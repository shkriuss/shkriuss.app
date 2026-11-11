# 0013 Signing key custody and rotation

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decision 5), 10, 13, 14
  and 15, the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4), and the
  owner's design review for Phase 0, step 6 (the release workflow) on
  2026-11-11

## Context

- The threat model protects the signing key and the release pipeline. It
  defends against malicious dependencies or CI actions, takeover of GitHub,
  and unsafe changes by an AI agent (section 10).
- Users verify the signing certificate with AppVerifier against the
  fingerprints on the hub (section 14).
- Claude works through a machine account with write access only. It cannot
  read secrets. It has no access to the signing-ceremony repository
  (section 15).
- The owner has no computer. Signing can only happen in GitHub Actions
  (section 13).
- GitHub hides a secret's value wherever it appears in a log. It cannot
  hide a secret that a step writes to a file, an artifact or another
  program.

## Decision

1. One signing key for the whole suite.
2. The key is held in the GitHub `release` environment, with an encrypted
   backup.
3. The key is RSA 4096, with `CN=shkriuss.app` and the alias `shkriuss`.
4. The `release` environment holds these secrets, and no others:
   - `SIGNING_KEYSTORE_B64`
   - `SIGNING_KEYSTORE_PASSWORD`
   - `SIGNING_KEY_ALIAS`
5. Only the signing job in the `release` environment uses the key. It waits
   for the owner's approval and signs with `apksigner` only. See
   [0014](0014-release-flow-and-reproducible-builds.md).
6. Secrets live only in environments limited to `main`. There are no
   repository-level secrets.
7. Key rotation uses APK signature scheme v3.1 (Android 13 and later).
8. Restoring the key and rotating it are rehearsed with a throwaway key
   before the first public release.
9. Preview builds use a throwaway key and the application ID suffix
   `.preview`, so they install next to the real app.
10. The encrypted backup:
    - It is the file `backup/signing-key.tar.gpg` in the owner's private
      repository `signing-ceremony`.
    - It is encrypted with a passphrase that only the owner holds.
    - `backup/fingerprint.txt` in that repository holds the certificate's
      SHA-256.
    - The owner keeps two more copies outside GitHub.
11. Restore: the owner runs the `signing-ceremony` repository's workflow
    with the action `restore`. It decrypts the backup and writes the three
    secrets into the `release` environment again.
12. The keystore:
    - It is a PKCS12 file that holds the one key, under the alias in
      `SIGNING_KEY_ALIAS`.
    - The key has the same password as the keystore, so one secret holds
      both. This is how `keytool` makes PKCS12 keystores.
    - `SIGNING_KEYSTORE_B64` is the file encoded with base64. Line breaks
      are allowed.
13. How the job "Sign" in
    [`release.yml`](../../.github/workflows/release.yml) handles the key:
    - The three secrets reach one step only, "Sign with the suite key".
      No other step, job or workflow names them.
    - The job checks out only `docs/security/fingerprints.md`. No project
      code is on its runner.
    - The step writes the keystore into a new folder in the runner's
      temporary folder, readable only by the runner's user (`umask 077`).
      A `trap` deletes the folder when the step ends, also when it fails.
    - The password reaches `apksigner` as the name of a variable
      (`env:SIGNING_KEYSTORE_PASSWORD`), never as a command-line argument.
      Standard input is closed, so `apksigner` can never wait for a
      password prompt.
    - The step never uses `set -x` and never prints a secret.
14. Signature schemes: `apksigner` picks them from the APK's minimum SDK,
    33. It signs with scheme v3 only, which every Android version from 13
    reads. Scheme v4 is off, so no `.idsig` file is made. The job fails
    unless `apksigner verify` reports scheme v3 and exactly one signer.
15. The fingerprint check:
    - The certificate's SHA-256 is published in
      [fingerprints.md](../security/fingerprints.md), on one line in a
      fixed form. Only the owner provides it.
    - That file is owner-only in
      [CODEOWNERS](../../.github/CODEOWNERS).
    - The job "Build" checks the line's form before the owner is asked to
      approve.
    - The job "Sign" compares the signed APK's certificate with that line.
      If they differ, it fails and uploads nothing.
16. Settings of the `release` environment:
    - Required reviewer: the owner.
    - "Prevent self-review" is off. The owner both starts the release and
      approves it, and GitHub would not let the owner approve their own
      run otherwise.
    - "Allow administrators to bypass configured protection rules" is off,
      so the approval step is never skipped.
    - Deployment branches: `main` only.
    - The steps are in [release.md](../development/release.md).

## Options rejected

- **A cloud key service with a non-exportable key.** It needs a Google, AWS
  or Azure account, and it allows no offline backup. A move to one stays
  possible later, through key rotation.
- **One key per app.** The Sync app and the data apps talk through a
  signature-level permission, which needs the same key. One key is also one
  thing to guard.
- **A fourth secret for a separate key password.** The plan names three
  secrets. A PKCS12 keystore needs only one password.

## Consequences

- Every app in the suite is signed with the same key. The
  signature-protected interface between the data apps and the Sync app
  relies on this. See [0005](0005-no-network-permission-in-data-apps.md).
- A file not signed with the suite key fails the fingerprint check and
  cannot update an installed app (section 15).
- A release whose secrets hold any other key, such as a throwaway key left
  from a rehearsal, fails in the job "Sign" before anything is uploaded.
- Claude never edits signing config or release workflows unless the owner
  asks for exactly that change (hard rule 6 in
  [CLAUDE.md](../../CLAUDE.md)). Key files (`*.jks`, `*.keystore`, `*.p12`,
  `*.pfx`) are owner-only in
  [CODEOWNERS](../../.github/CODEOWNERS).
- Only the owner provides the fingerprints in
  [fingerprints.md](../security/fingerprints.md).
- The throwaway preview key (point 9) is made inside each preview job,
  used once and deleted. Every run makes a new one, so a preview cannot
  update an older preview. See [ci.md](../development/ci.md#pr-preview).
- GitHub hides every secret value in logs, also when the same text appears
  for another reason. The alias is `shkriuss`, so the job "Sign" shows
  `***` wherever that word appears in its log, for example in package
  names. This is harmless. The job's outputs are hex digits only, so
  GitHub never drops one for looking like a secret.
- A JKS keystore also loads with these settings, as long as its key has
  the keystore's password. This was tried in the cloud environment with
  `apksigner` from build tools 36.0.0, not in GitHub Actions.
- A key rotation will need more than this record: a lineage file made
  with `apksigner rotate`, signing with that lineage and scheme v3.1, a
  place to keep the lineage, a change to `release.yml`, and the old
  certificate moved to "Previous certificates" in fingerprints.md. It gets
  its own record when it is planned.
- Open: the restore and rotation rehearsal with a throwaway key (point 8)
  happens in the `signing-ceremony` repository, which Claude cannot see.
