# Release

How to release an app from a phone. You start the release workflow, approve
the signing job, check the draft release and publish it. Publishing creates
the tag.

Why it works this way is in
[ADR 0013](../adr/0013-signing-key-custody-and-rotation.md) (the signing
key) and [ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md)
(the release flow). The workflow is
[`release.yml`](../../.github/workflows/release.yml). Set up in Phase 0,
step 6.

## What the workflow does

| Job | What it does | Secrets |
|---|---|---|
| Build | Checks the inputs, that `ci.yml` passed for this commit on `main`, that the tag is new and that the fingerprint file is in order. Builds the unsigned release APK and the R8 mapping file. Checks the APK's package name, its version, and that its version code follows the rule in [ADR 0021](../adr/0021-version-names-and-version-codes.md). | None |
| Rebuild and compare | Builds again on a new runner, in another folder, in another time zone and with another file permission mask. Fails unless the APK and the mapping file are the same, byte for byte. | None |
| Sign | Waits for your approval. Signs the APK with the suite key, using `apksigner` only. Verifies the signature. Fails unless the certificate matches [fingerprints.md](../security/fingerprints.md). | The three release secrets, in one step |
| Draft release | Adds a build provenance attestation for the signed APK. Creates a draft release with the APK, the mapping file and their SHA-256 checksums. Never creates a tag. | None |

No job uses a cache. Every job checks the files it gets from an earlier job
against that job's SHA-256 values.

## Before the first release

Do these once. They are repository settings, so only you can change them.

### 1. The `release` environment

Set it up before the first run. A run that names an environment that does
not exist creates it, with no protection at all.

1. Open `github.com/shkriuss/shkriuss.app/settings/environments` in the
   browser.
2. If `release` is listed, tap it. Otherwise tap **New environment**, type
   `release` and tap **Configure environment**.
3. Tick **Required reviewers** and add `shkriuss`.
4. Leave **Prevent self-review** unticked. You start the release and
   approve it yourself. With this ticked, GitHub would not let you approve
   a run you started.
5. Tap **Save protection rules**.
6. Untick **Allow administrators to bypass configured protection rules**
   and tap **Save protection rules**. Then no one, not even an admin, can
   start the signing job without the approval step.
7. Under **Deployment branches**, pick **Selected branches and tags**. Tap
   **Add deployment branch or tag rule**, pick **Branch**, type `main` and
   tap **Add rule**.
8. Under **Environment secrets** there must be exactly these three:
   - `SIGNING_KEYSTORE_B64`: the keystore file, encoded with base64.
   - `SIGNING_KEYSTORE_PASSWORD`: its password, which is also the key's
     password.
   - `SIGNING_KEY_ALIAS`: the key's alias, `shkriuss`.

   The `restore` action of the `signing-ceremony` repository writes them
   ([ADR 0013](../adr/0013-signing-key-custody-and-rotation.md), point 11).
   Never paste a secret into a Claude session.

### 2. Immutable releases

1. Open `github.com/shkriuss/shkriuss.app/settings`.
2. Scroll down to the "Releases" section.
3. Tick **Enable release immutability**.

After that, a published release's files and tag can no longer be changed
or deleted. If you delete a published release, its tag name can never be
used again. Drafts can still be changed. GitHub also adds a release
attestation to every release you publish.

### 3. Your right to create tags

Only you may create tags ([working-with-claude.md](working-with-claude.md)).
Publishing a draft creates its tag in your name. If a ruleset limits who
may create tags, your account must be allowed, for example on its bypass
list.

### 4. The fingerprint

[fingerprints.md](../security/fingerprints.md) holds the certificate's
SHA-256 that you provided. The workflow refuses to release anything signed
with another certificate.

## Run a release

Only you, the repository owner, can start or re-run a release. A run that
anyone else starts, or a job that anyone else re-runs, fails at once in
its first step, "Check the inputs", before it builds or signs anything.
That includes Claude's machine account.

Before you start:

1. The version is set in `android/app/<app>/build.gradle.kts`, and the
   change is merged into `main`. `versionCode` follows from `versionName`
   by the rule in
   [ADR 0021](../adr/0021-version-names-and-version-codes.md): for
   example `1.0.0-rc.1` is 10000301 and `1.0.0` is 10000900. CI fails the
   pull request if it does not. Claude prepares this in a pull request
   (prompt R6 in [PROMPTS.md](PROMPTS.md)).
2. CI is green on the newest commit of `main`. Open the **Actions** tab and
   tap **CI**. The top run on `main` must have a green tick. Right after a
   merge, wait for it.
3. Parts 1 and 2 of the version's release checklist are done. Claude
   copies the [release checklist](release-checklist.md) to
   `docs/apps/<app>/release-checklist-<version>.md` in the same pull
   request as the version. Parts 3 and 4 follow these steps.

Then:

1. Open `github.com/shkriuss/shkriuss.app/actions/workflows/release.yml`.
2. Tap **Run workflow**.
3. Leave the branch at `main`.
4. Pick the app. Type the version exactly as `versionName`, for example
   `0.1.0`. A version ending in `-alpha.N`, `-beta.N` or `-rc.N`, such as
   `1.0.0-rc.1`, becomes a pre-release.
5. Tap **Run workflow**. Pull the page down to reload it, then tap the new
   run, named "Release" with the app and the version.
6. Wait for **Build** and **Rebuild and compare**. Each builds the app from
   scratch, so this takes a while.
7. **Sign** then shows "Waiting". Tap **Review deployments**, tick
   `release` and tap **Approve and deploy**. To stop the release here, tap
   **Reject** instead. A job that is not approved within 30 days fails.
8. Wait for **Sign** and **Draft release** to finish. The run's summary
   ends with the section "Draft release" and what to check.

## Check and publish the draft

1. Open `github.com/shkriuss/shkriuss.app/releases`. Only you see drafts.
2. Find the draft named `<app>-v<version>`, for example `catalog-v0.1.0`.
3. Check:
   - The notes link to a workflow run. It is the run you just started, and
     it is green.
   - The certificate SHA-256 in the notes is the same as in
     [fingerprints.md](../security/fingerprints.md).
   - It has three files: `<app>-v<version>.apk`,
     `<app>-v<version>-mapping.txt` and `SHA256SUMS`.
   - It says "Pre-release" only if the version has a hyphen.
4. Tap the pencil next to the draft.
5. Do not change the tag or the target. The tag is new and points at the
   commit that was built.
6. Tap **Publish release**. This creates the tag. From now on the files and
   the tag cannot be changed.

Publish only a draft that this workflow made in a run you started. The
machine account can create drafts too, so a draft alone proves nothing
([working-with-claude.md](working-with-claude.md#what-the-machine-account-can-still-do)).

## When something fails

Tap the failed job to see the message. Most stop the run before you are
asked to approve.

| Message | What to do |
|---|---|
| Only the repository owner may start or re-run a release. | Someone other than you started the run, or re-ran a job in it. Start a new run yourself. |
| Start the release on the branch main. | Run it again with the branch `main`. |
| Unknown app. | Pick an app from the list. A new app is added to the list in a pull request (prompt 2.6). |
| The version must look like 1.0.0, 1.0.0-alpha.1, 1.0.0-beta.1 or 1.0.0-rc.1 ... | Type a version in one of those forms. No `v` in front. |
| CI (ci.yml) has not run for commit ... on main. | CI has not started yet, or the commit is not on `main`. Wait a minute, then start again. |
| CI (ci.yml) has not passed for commit ... | CI is still running, or it failed. The message links to the run. Wait until it is green, or fix it first, then start again. |
| The CI job "..." has not passed for commit ... | One of the two required CI jobs is missing or did not pass in the newest attempt. Open the linked run. |
| The tag ... already exists. | That version was released already. Raise the version in a pull request. |
| Expected exactly one line of the form: Current certificate SHA-256 ... | [fingerprints.md](../security/fingerprints.md) was changed. Put the line back in its form. |
| The version typed in (...) is not the APK's versionName. | Type the `versionName` from the app's `build.gradle.kts`, or change it there in a pull request. |
| versionName ... needs versionCode ..., but it is ... | The app's `versionCode` breaks the rule in ADR 0021. CI should have caught this. Fix it in a pull request. |
| ... differs between the two builds. | The build is not reproducible. Do not release. Tap **Re-run jobs**, then **Re-run failed jobs** once, in case GitHub changed its runner between the two builds. If it fails again, ask Claude to find the cause. The second build's files are in the run's artifact `rebuild-differs`. |
| A release secret is missing. | Check the three secrets of the `release` environment. |
| SIGNING_KEYSTORE_B64 is not a base64-encoded keystore. | Write the secrets again with the `restore` action of `signing-ceremony`. |
| apksigner could not sign. ... | The keystore, password and alias do not belong together. Write them again with `restore`. |
| The APK was signed with a certificate that is not the one in ... | The `release` environment holds another key. Nothing was uploaded. Restore the suite key. Change fingerprints.md only after a planned key rotation. |
| A release or draft for ... already exists. | Delete the old draft: on the Releases page, tap the bin next to it, then **Delete this release**. Then start again. |
| The tag ... exists now. The workflow must not create tags. | This should never happen. Do not publish the draft. Tell Claude in a session. |

A job that failed because a download failed can be run again: on the run's
page, tap **Re-run jobs**, then **Re-run failed jobs**. GitHub allows this
for 30 days. To stop a run at any time, tap **Cancel workflow**.

## Rehearsal with Catalog

The cloud environment has no keys and cannot run GitHub Actions, so these
were not tried there: the **Run workflow** form, the approval, the real
secrets and key, passing files between jobs, the attestation, a draft
without a tag, publishing under your tag rule, Obtainium and AppVerifier.
The rehearsal tries all of them.

### Part A: a dry run that leaves nothing behind

Done on 2026-11-11. The draft was deleted afterwards.

1. Do all of [Before the first release](#before-the-first-release).
2. Start a run with a wrong version, `0.1`. **Build** must fail within a
   minute with "The version must look like 1.0.0".
3. Start a run with app `catalog` and version `0.1.0`
   ([Run a release](#run-a-release)). Approve **Sign**.
4. On the run's summary page, check:
   - **Build** shows the package `app.shkriuss.catalog` and version `0.1.0`.
   - **Rebuild** says the second build made the same files.
   - **Sign** shows the certificate SHA-256 from fingerprints.md.
5. Open the draft and check it as in
   [Check and publish the draft](#check-and-publish-the-draft), steps 1
   to 3. Do not publish it.
6. Tap the attestation link in the notes. The page must name
   `.github/workflows/release.yml` and the commit from the notes.
7. Open `github.com/shkriuss/shkriuss.app/tags`. There must be no tag
   `catalog-v0.1.0`.
8. Optional: tap the APK in the draft to download it, install it, and check
   it with AppVerifier against fingerprints.md.
9. Delete the draft: on the Releases page, tap the bin next to it, then
   **Delete this release**. A draft has no tag, so the version can be used
   again.

### Part B: the Phase 0 gate

Done on 2026-11-11. Catalog 0.1.0 was published as `catalog-v0.1.0`,
installed with Obtainium and checked with AppVerifier. Nothing differed
from these steps.

This makes a real, permanent release. The tag `catalog-v0.1.0` can never be
used again, even if the release is deleted.

1. Start a run with app `catalog` and version `0.1.0`. Approve **Sign**.
2. Check and publish the draft
   ([Check and publish the draft](#check-and-publish-the-draft)).
3. Open `github.com/shkriuss/shkriuss.app/tags`. The tag `catalog-v0.1.0`
   is there, on the commit from the notes.
4. In Obtainium, add the app with the URL
   `https://github.com/shkriuss/shkriuss.app`. In its settings, filter
   release titles with the regular expression `^catalog-v`, so that other
   apps' releases from this repository are ignored. Install it.
5. Check the installed app with AppVerifier against
   [fingerprints.md](../security/fingerprints.md).

Write down anything that did not match these steps, so Claude can fix this
page.

## The mapping file

R8 makes stack traces show `r8-map-id-...` instead of source files, and
instruction offsets instead of line numbers
([build.md](build.md#what-a-stack-trace-shows)). The release's
`<app>-v<version>-mapping.txt` turns them back into exact files and lines.
You do not need it to install the app.

When someone sends you a stack trace:

1. Note which release it came from.
2. In a Claude session, paste the trace and name the release.
3. Claude translates it with R8's `retrace` tool, which is part of the
   Android SDK in the cloud environment, and that release's mapping file.

Open: not tried yet, including how the session gets the mapping file from
the release.
