# 0038 A stolen signing key

- Status: Accepted
- Date: 2026-11-14
- Source: Phase 2, step 2.7 of
  [PROMPTS.md](../development/PROMPTS.md#27-restore-and-rotation-rehearsal),
  and point 11 under "Found while writing this page" in the
  [threat model](../security/threat-model.md#found-while-writing-this-page).
  The owner decided on 2026-11-14: rotate at once. The owner accepted the
  record on 2026-11-14, after parts A and B of the rehearsal showed what
  it rests on.

## Context

- Whoever holds the suite key can sign an APK that installs as an update
  over every app of the suite. That update gets all of the app's data and
  keys ([threat model](../security/threat-model.md#the-owners-github-account)).
- Ways the key can be taken:
  - a takeover of the owner's GitHub account, which can approve a
    release, or change `release.yml` to write the key out;
  - a harmful tool or action in the Sign job;
  - the backup together with its passphrase;
  - one of the two copies outside GitHub, together with the passphrase.
- A thief still has to get the APK onto phones. Obtainium takes the apps
  only from this repository's releases on GitHub
  ([0015](0015-distribution-channels.md)). Without the owner's GitHub
  account, a thief must get users to install a file from somewhere else.
- A rotation with rollback off ([0037](0037-signing-key-rotation.md))
  locks a phone that has updated to the new key. Neither the old key
  alone, nor any other lineage made from it, can update that app again.
  The rehearsal showed this on 2026-11-14: Android answered both with
  "App not installed"
  ([signing-key-rehearsal.md](../development/signing-key-rehearsal.md#results),
  B4 and B5).
- Before that update, a phone is still open. Someone with the old key can
  make a lineage to a key of their own. A phone that installs their
  update first stays with them, and then refuses ours.
  - Obtainium warns for their update in the same way as for ours:
    "Signing certificate mismatch", with the old key as the expected
    hash. The downloaded hashes are the old key, then the thief's. Only
    the last hash differs from our rotation.
  - This was not tested. It follows from how a lineage works: the phone
    checks only that the key it has signed the new key, with the right
    to hand over the app. Our lineage and a thief's both pass that check.
- Published releases cannot be changed
  ([release.md](../development/release.md#2-immutable-releases)). Each
  one that the release workflow made has a workflow run, a commit and a
  build attestation ([0014](0014-release-flow-and-reproducible-builds.md)).
- The data apps have no network permission
  ([0005](0005-no-network-permission-in-data-apps.md)). No app can show
  users a warning. GitHub and the hub site are the only ways to reach
  them.

## Decision

### 1. Suspicion is enough

On any one of the signs below, act as if the key is stolen. Do not wait
for proof. Every hour of waiting is an hour in which a thief's update can
reach phones first.

### 2. How you tell

- A workflow run, draft release, release or tag that you did not start.
- A Sign job that ran without your approval. The environment `release`
  lists its deployments.
- A change to `release.yml`, or to the settings of `release`, that you
  did not make or approve.
- In your account's security log, a session, token, SSH key or app that
  you do not know.
- A run or change in signing-ceremony that you did not make, or one of
  the two copies outside GitHub is missing.
- A report through [SECURITY.md](../../SECURITY.md) of an APK with the
  suite's fingerprint that is not in any release's `SHA256SUMS`.

### 3. The first hour

Do these in order.

1. **Write down** the time and what you saw. Take screenshots. Delete
   nothing yet: the runs, drafts and logs show what happened.
2. **Secure your GitHub account.**
   1. Change the password.
   2. Check the second factor.
   3. Sign out every other session.
   4. Delete every token, SSH key and app with access that you do not
      know.
3. **Stop releases.**
   1. In shkriuss.app, open **Settings**, **Environments**, `release`.
      Delete the three secrets. The Sign job then cannot sign.
   2. Open **Actions**, **Release**, the menu, **Disable workflow**.
   3. Delete every draft release that you did not make.
4. **The machine account.** If it may be involved, remove its access
   under **Settings**, **Collaborators**.
5. **Warn users.** Publish a security advisory in shkriuss.app with the
   text in point 5:
   1. Open **Security**, **Advisories**, **New draft security advisory**.
   2. Paste the text.
   3. Tap **Publish advisory**.
6. **Note** the tag of the last release that you made yourself. Note every
   release or tag that you did not make.

### 4. The first day

1. In signing-ceremony, first check in the history of its workflow files
   that nobody else changed them.
2. Make the new key and the lineage there, as
   [0037](0037-signing-key-rotation.md) says. Back them up, make the two
   copies, and check them
   ([signing-key-rehearsal.md](../development/signing-key-rehearsal.md),
   parts D and E).
3. Follow [Rotate the signing key](../development/release.md#rotate-the-signing-key)
   in release.md. In fingerprints.md, the old certificate goes under
   "Previous certificates". There it is marked stolen on the date, with
   the tags of the releases that are ours.
4. Turn the Release workflow back on, and release a new version of every
   app.
5. Update the advisory with the new fingerprint, the new version of each
   app, and the steps for users.

### 5. What you tell users

Fill in the parts in angle brackets.

```text
The signing key of the shkriuss.app apps may have been stolen on <date>.

Until this advisory says that the new key is out:
- Do not install or update any app of the suite, from anywhere.
  In Obtainium, do not update them.
- Do not install an APK of these apps that someone sends you.

When the new key is out:
1. Update each app in Obtainium. Obtainium shows "Signing certificate
   mismatch". Tap "Install anyway" only if the last "Downloaded
   certificate hash" is the new fingerprint below, and the new
   fingerprint is the same here, on https://shkriuss.app/verify/ and in
   docs/security/fingerprints.md on GitHub. Otherwise tap "Don't
   install".
2. Open AppVerifier and tap the app. The last fingerprint it shows must
   be the new one. Copy the package name and the new fingerprint, as two
   lines, and tap "Verify from clipboard". It must show "Verification
   Status: SUCCESS".
3. If it shows any other fingerprint last, or Android refuses the
   update with "App not installed", the app on your phone did not come
   from us. Uninstall it, install it again with Obtainium, and restore a
   backup that you made before <date>.

New fingerprint: <new SHA-256>
Old fingerprint, stolen: <old SHA-256>
Our releases signed with the old key: <tags>
Releases that are not ours: <tags, or none>
```

### 6. Releases already signed

1. Published releases stay. They cannot be changed, and copies of them
   exist outside GitHub. Deleting ours would only take away the way to
   check them.
2. Those that the release workflow made before the theft are genuine.
   Each has its run and its attestation. Their tags are listed in the
   advisory and in fingerprints.md, under the old certificate.
3. Any other APK signed with the old key is not ours. Delete every release
   that you did not make, and list its tag in the advisory as not ours.
4. Only the newest release of each app, signed with the new key, gets
   fixes ([SECURITY.md](../../SECURITY.md)).

## Options rejected

- **A new key with no lineage, a clean break.** Every user would have to
  uninstall each app, install it again and restore a backup. For users
  who update, it protects no better than a rotation. The owner decided on
  2026-11-14.
- **Waiting for proof.** Every hour lets a thief's update reach more
  phones first.
- **Deleting our own old releases.** They are genuine, and their copies
  exist elsewhere anyway.

## Consequences

- The first day depends on the rotation of
  [0037](0037-signing-key-rotation.md). That includes a `rotate` action
  in signing-ceremony, which does not exist yet (Open in 0037). It must
  also make the new key, because the ceremony's `create` refuses while a
  backup exists. Until it exists, the first day takes longer.
- A phone that took the thief's update first cannot take ours. Its user
  must uninstall and install again. Data made after the theft may be lost.
- Users who never update keep the app signed with the old key. The thief
  can still reach them with a file. Only the advisory and the hub can
  tell them.
- Open: what users do about their recovery key, if a harmful update ran
  on their phone. It could read the app's keys and the words, if the
  words were entered or kept. This waits for the design of a new recovery
  key ([crypto-design.md](../security/crypto-design.md#open-questions),
  question 6).
- The threat model links this record under
  [The owner's GitHub account](../security/threat-model.md#the-owners-github-account).
