# 0013 Signing key custody and rotation

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 2 (decision 5), 10, 13, 14
  and 15

## Context

- The threat model protects the signing key and the release pipeline. It
  defends against malicious dependencies or CI actions, takeover of GitHub,
  and unsafe changes by an AI agent (section 10).
- Users verify the signing certificate with AppVerifier against the
  fingerprints on the hub (section 14).
- Claude works through a machine account with write access only. It cannot
  read secrets. It has no access to the signing-ceremony repository
  (section 15).

## Decision

1. One signing key for the whole suite.
2. The key is held in the GitHub `release` environment, with an encrypted
   backup.
3. The key is RSA 4096, with `CN=shkriuss.app` and the alias `shkriuss`.
4. The `release` environment holds these secrets:
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

## Options rejected

None recorded.

## Consequences

- Every app in the suite is signed with the same key. The
  signature-protected interface between the data apps and the Sync app
  relies on this. See [0005](0005-no-network-permission-in-data-apps.md).
- A file not signed with the suite key fails the fingerprint check and
  cannot update an installed app (section 15).
- Claude never edits signing config or release workflows unless the owner
  asks for exactly that change (hard rule 6 in
  [CLAUDE.md](../../CLAUDE.md)). Key files (`*.jks`, `*.keystore`, `*.p12`,
  `*.pfx`) are owner-only in
  [CODEOWNERS](../../.github/CODEOWNERS).
- Only the owner provides the fingerprints in
  `docs/security/fingerprints.md`.
- Open: where the encrypted backup is kept, and how a restore works. The
  plan names a signing-ceremony repository but does not say what it holds.
- Open: the details are completed in Phase 0, step 6
  ([PROMPTS.md](../development/PROMPTS.md)).
