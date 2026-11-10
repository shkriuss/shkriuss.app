# 0014 Release flow and reproducible builds

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 10, 13, 15, 16 and 17

## Context

- The owner has no computer. All work happens in a phone or tablet browser
  (section 1).
- The Claude Code cloud environment cannot run an emulator and holds no
  keys (section 13).
- The threat model protects the signing key and the release pipeline. It
  defends against malicious dependencies or CI actions, takeover of GitHub,
  and unsafe changes by an AI agent (section 10).
- Claude's machine account can push branches, including workflow files,
  which then run without secrets. It can start workflows on `main` and
  create draft releases (section 15).

## Decision

1. GitHub Actions is the authoritative build. Emulator tests, signing and
   releases run only there.
2. The release flow:
   1. The owner starts the `release` workflow on `main`.
   2. A job with no secrets builds the unsigned APK.
   3. A second job rebuilds and compares, to prove reproducibility.
   4. A signing job in the `release` environment waits for the owner's
      approval. It signs with `apksigner` only and verifies the result.
   5. The workflow attaches a build attestation and creates a draft
      release.
   6. The owner publishes the draft. That creates the tag. Releases are
      immutable.
3. Tags have the form `<app>-v<version>`, for example `water-v1.0.0`.
4. Rules for every workflow:
   - Actions are pinned to full commit SHAs.
   - Workflow tokens are read-only by default.
   - No repository-level secrets, only environment secrets.
5. Repository rules (section 15):
   - `main` needs a pull request with one approval, and approval of the
     latest push. The owner may bypass this for the owner's own pull
     requests only.
   - Only the owner may create tags.
   - Secrets live only in environments limited to `main`.
   - The `release` environment needs the owner's approval.
6. Planned workflows: `ci`, `pr-preview`, `protected-paths`, `release`,
   `site`, and later `backend`.

## Options rejected

None recorded.

## Consequences

- Every release is built twice, and the two builds must match.
- The owner publishes only the draft that the release workflow just made
  (section 15).
- Release workflows are owner-only. Claude changes them only when the owner
  asks for exactly that change (hard rule 6 in
  [CLAUDE.md](../../CLAUDE.md)).
- Phase 0 ends when an empty Catalog app builds reproducibly in CI, is
  signed, and installs through Obtainium (section 16).
- The signing key itself is covered in
  [0013](0013-signing-key-custody-and-rotation.md).
- Open: that a draft release works with the tag rules, and that the owner
  can publish it (section 17).
- Open: which third-party actions are needed, so the owner can allow them
  in the repository settings (section 17).
- Open: the details are completed in Phase 0, step 6
  ([PROMPTS.md](../development/PROMPTS.md)).
