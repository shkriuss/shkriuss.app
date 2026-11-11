# 0014 Release flow and reproducible builds

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 10, 13, 15, 16 and 17, the
  owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4), the
  owner's decision on
  [pull request 5](https://github.com/shkriuss/shkriuss.app/pull/5) (the
  R8 mapping file), and the owner's design review for Phase 0, step 6 (the
  release workflow) on 2026-11-11

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
- R8 optimises release builds, so stack traces need the release's mapping
  file to show exact source files and lines
  ([build.md](../development/build.md#the-mapping-file)).

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
7. Reproducible builds (Phase 0, step 3):
   - Gradle never signs release or preview APKs. The compared file is the
     unsigned APK.
   - Version control info is left out of the APK, so it depends only on
     the source files, not on the `.git` folder.
   - AGP's dependency info block, encrypted for Google Play, is left out.
   - Everything that goes into a build is pinned: Gradle with a checksum,
     every dependency (see
     [0020](0020-dependency-verification.md)), the JDK, the SDK platform
     and the build tools.
   - The details, and how two clean builds were compared, are in
     [build.md](../development/build.md#reproducible-builds).
8. The workflow [`release.yml`](../../.github/workflows/release.yml)
   (Phase 0, step 6) starts only by hand (`workflow_dispatch`). It has two
   inputs:
   - `app`: picked from a fixed list in the workflow. Every job checks the
     same list again, because the API accepts any text.
   - `version`: one of the version forms in
     [0021](0021-version-names-and-version-codes.md), such as `1.0.0` or
     `1.0.0-rc.1`.
   - Inputs reach shell steps only through `env`. Nothing from an input is
     printed before it has passed the checks.
9. Before it builds, the job "Build" stops unless:
   - the run is on `main`,
   - CI passed on that exact commit. Only the newest run that GitHub
     Actions made from `ci.yml` for a push of that commit to `main`
     counts. It is found by the workflow number of
     `.github/workflows/ci.yml` in this repository. The run must have succeeded, and its latest attempt must hold
     the jobs "Gradle wrapper" and "Check", both passed. A check from
     another workflow with the same name does not count,
   - the tag `<app>-v<version>` does not exist,
   - [fingerprints.md](../security/fingerprints.md) has its one line in
     the expected form.
10. After it builds, it stops unless the APK's package is
    `app.shkriuss.<app>`, its `versionName` equals the `version` input,
    and its `versionCode` is the one that
    [0021](0021-version-names-and-version-codes.md) gives. CI checks the
    same rule for every app in every pull request, with the same script.
11. Jobs, in order:

    | Job | Token | Secrets | Project code |
    |---|---|---|---|
    | Build | `contents: read`, `actions: read` (the CI run) | None | Runs Gradle |
    | Rebuild and compare | `contents: read` | None | Runs Gradle |
    | Sign | `contents: read`, environment `release` | The three release secrets, in one step | None |
    | Draft release | `contents: write`, `id-token: write`, `attestations: write` | None | None, no checkout |

12. No caches: no download cache, and Gradle runs with `--no-build-cache`
    and `--no-configuration-cache`.
13. The reproducibility check: "Rebuild and compare" builds on a new
    runner, from a checkout in another, longer folder, in the time zone
    UTC+14 and with the file permission mask `077`. It compares the
    unsigned APK and the R8 mapping file with the first build's, byte for
    byte. If either differs, the run fails and the second build's files are
    kept as the artifact `rebuild-differs`.
14. Files move between jobs as run artifacts. Every job checks them
    against the SHA-256 values that the job which made them reported.
15. The attestation: SLSA build provenance for the signed APK, made with
    `actions/attest`. The repository is public, so attestations are
    available.
16. The draft release:
    - Title and tag name `<app>-v<version>`. The target is the commit that
      was built, so the tag points at it when the owner publishes.
    - Files: `<app>-v<version>.apk`, `<app>-v<version>-mapping.txt` and
      `SHA256SUMS`.
    - The notes list the commit, the run, both SHA-256 values, the
      certificate's SHA-256, the attestation and the changelog.
    - A version with a pre-release part (`-rc.1`) makes a pre-release.
    - The job stops if a release or draft with that tag already exists.
    - The workflow never creates a tag. After it creates the draft, it
      checks that the tag still does not exist.
17. Every release has its R8 mapping file attached, next to the APK (owner
    decision on pull request 5).
18. Actions: only GitHub's own. `actions/checkout`,
    `actions/upload-artifact`, `actions/download-artifact` and
    `actions/attest`. No third-party action, so nothing needs to be
    allowed in the repository settings.

## Options rejected

- **Signing inside the build job.** Build jobs must hold no secrets.
- **A workflow that creates the tag and publishes.** Only the owner creates
  tags. Publishing is the owner's last check.
- **Connecting Claude with the owner's GitHub account.** Claude could then
  merge its own pull requests. Claude uses a machine account with write
  access only.
- **A status check in place of a required review.** A pull request branch
  could fake it.
- **Signing with Gradle's `signingConfig`.** The key would sit inside the
  Gradle process, next to every plugin and dependency that the build runs.
  The job "Sign" runs no project code at all.
- **Third-party actions for signing or releases**, such as
  `r0adkll/sign-android-release` or `softprops/action-gh-release`. Not
  GitHub's own. `apksigner` and the GitHub CLI do the same in a few lines.
- **`actions/attest-build-provenance`.** GitHub's own, but since version 4
  it only passes its inputs on to `actions/attest`, which makes the same
  build provenance. Using `actions/attest` directly is one action fewer.
- **Building once.** It would not prove that the APK can be built again
  from the source.
- **Counting any check run named "Gradle wrapper" or "Check".** Any
  workflow, also one added in a later pull request, could report a check
  with the same name. The owner asked on pull request 9 that only
  `ci.yml`'s own run counts.

## Consequences

- Every release is built twice, and the two builds must match.
- A release takes two full builds, each with all its downloads, plus the
  wait for the owner's approval.
- Right after a merge, the owner waits until CI on `main` is green before
  starting a release.
- The owner publishes only the draft that the release workflow just made
  (section 15).
- Release workflows are owner-only. Claude changes them only when the owner
  asks for exactly that change (hard rule 6 in
  [CLAUDE.md](../../CLAUDE.md)).
- A new app is added to the list of apps in `release.yml`, in every job
  (prompt 2.6 in [PROMPTS.md](../development/PROMPTS.md)).
- The JDK and the Android SDK come from GitHub's runner image. If GitHub
  changes the image between the two builds, they can differ. Running the
  failed jobs again is the first thing to try.
- Phase 0 ends when an empty Catalog app builds reproducibly in CI, is
  signed, and installs through Obtainium (section 16). The steps are the
  rehearsal in [release.md](../development/release.md#rehearsal-with-catalog).
- The signing key itself is covered in
  [0013](0013-signing-key-custody-and-rotation.md).
- The `ci`, `pr-preview` and `release` workflows use only GitHub's own
  actions. The commits are listed in
  [ci.md](../development/ci.md#actions-used).
- Open: that a draft release works with the tag rules, and that the owner
  can publish it (section 17). The rehearsal in
  [release.md](../development/release.md#rehearsal-with-catalog) checks it.
- Open: whether the `site` workflow needs any third-party action, so the
  owner can allow it in the repository settings (section 17).
