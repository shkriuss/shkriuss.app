# 0037 Signing key rotation

- Status: Accepted
- Date: 2026-11-14
- Source: Phase 2, step 2.7 of
  [PROMPTS.md](../development/PROMPTS.md#27-restore-and-rotation-rehearsal),
  with the owner's decisions in that session on 2026-11-14. It supersedes
  point 7 of [0013](0013-signing-key-custody-and-rotation.md). The owner
  accepted the record on 2026-11-14, after parts A and B of the
  rehearsal showed what it rests on.

## Context

- [0013](0013-signing-key-custody-and-rotation.md), point 7, says that key
  rotation uses APK signature scheme v3.1, from Android 13. Point 14 says
  that the release job signs with scheme v3 only. It fails unless
  `apksigner verify` reports scheme v3 and exactly one signer.
- Every app's minimum is Android 13, API 33
  ([0002](0002-grapheneos-first-minimum-android-13.md)).
- Android installs an update only if it is signed with the key of the
  installed app, or with a newer key whose proof of rotation the
  installed app accepts. That proof is the **lineage**.
- `apksigner rotate` makes a lineage: the new certificate, signed with the
  old key. In it, each old key has five rights:
  - **installed data**: an update signed with the newer key may replace an
    app installed with this key, and keep its data;
  - **shared UID**: apps signed with this key may share a user ID with
    apps signed with the newer key;
  - **permission**: apps signed with this key may get signature
    permissions that apps signed with the newer key define;
  - **rollback**: an update signed with this key may replace an app
    already signed with the newer key;
  - **auth**: apps signed with this key are trusted as if they had the
    newer key.
- What `apksigner` from build tools 36.0.0 does with a lineage. Claude
  tried it on 2026-11-14 in the cloud environment, with throwaway keys
  made and deleted there, and read it in apksigner's code:
  - The default of `--rotation-min-sdk-version` is 33. apksigner writes a
    v3.1 block only when the APK also runs on versions below that, to keep
    the old key there. With a minimum of 33 it writes none. The new key
    and the lineage go into the v3 block.
  - `apksigner verify` then reports: v3 true, v3.1 false, one signer, and
    the new certificate as signer 1.
  - Signing needs only the new key and the lineage, if schemes v1 and v2
    are turned off by name. Otherwise apksigner asks for the oldest key
    too, although an APK with a minimum of 33 gets neither scheme.
- The lineage holds only certificates and signatures. Every rotated APK
  carries it, and `apksigner lineage --in <apk> --print-certs` shows it.
  To change an old key's rights later, apksigner needs that old key.
- AppVerifier, from its source, read on 2026-11-14:
  - It shows every certificate in an app's lineage, the oldest first.
  - It compares only the last one, the current key, with pasted text and
    with its own list of apps.
  - An app that was never updated shows only the old certificate.
- Obtainium 1.6.16 and later, from its source, read on 2026-11-14:
  - Its setting "Warn about signing certificate changes" is on by default.
  - When an update carries a certificate the installed app does not have,
    it warns while you update in the app, and it skips that update in the
    background.
  - Fingerprints that a user typed into an app's settings in Obtainium
    block every other certificate.
- The rehearsal checked these readings on a phone on 2026-11-14, with
  Obtainium 1.7.4
  ([signing-key-rehearsal.md](../development/signing-key-rehearsal.md#results),
  part B):
  - apksigner 36.0.0 reported the rotated APK as scheme v3 only, no v3.1,
    one signer, the new key. Its lineage held the old key, with installed
    data on and the other four rights off, then the new key.
  - The rotated update installed over the app with the old key.
  - Android refused the old key alone, and a thief's lineage made from
    the old key, over the rotated app: "App not installed".
  - Obtainium warned before the update with "Signing certificate
    mismatch". It listed the expected hash, the old key, and the
    downloaded hashes, the old key and then the new one.
  - AppVerifier showed the old certificate, then the new one. With the
    package name and the new key's SHA-256, "Verify from clipboard"
    showed "Verification Status: SUCCESS". Whether the old key's SHA-256
    gives a failure was not tested.

## Decision

1. A rotation moves the whole suite to a new key, with a lineage made by
   `apksigner rotate`. There is still one key for the suite (0013,
   point 1).
2. The new key is made like the first: RSA 4096, `CN=shkriuss.app`, alias
   `shkriuss`, in a PKCS12 file (0013, points 3 and 12).
   - The signing-ceremony repository makes it, backs it up and restores
     it, as 0013, points 10 and 11, say.
   - The ceremony's `create` refuses while a backup exists. So the new
     key is made and backed up by the `rotate` action (Open, below).
   - The `release` environment keeps the same three secrets, which then
     hold the new key.
3. The old key's rights in the lineage: **installed data** on; **shared
   UID**, **permission**, **rollback** and **auth** off. The same for a
   planned rotation and after a theft
   ([0038](0038-a-stolen-signing-key.md)).
   - Installed data lets the update replace the installed app and keep its
     data.
   - With rollback off, once a phone has the rotated app, an APK signed
     with the old key alone cannot update it.
   - With permission and auth off, an app signed only with the old key
     gets no signature permission from the suite, and no trust as part of
     it.
   - No app of the suite shares a user ID.
4. A release after a rotation signs with the new key and the lineage:
   - `--lineage`, `--rotation-min-sdk-version 33`,
     `--v1-signing-enabled false` and `--v2-signing-enabled false`;
   - v4 stays off, as now.

   No v3.1 block is made. This replaces point 7 of 0013.
5. Point 14 of 0013 stays: scheme v3, exactly one signer. After a rotation
   that signer is the new key. So the fingerprint check of point 15
   compares the new certificate with the current line of fingerprints.md.
6. The Sign job also checks the signed APK's lineage:
   - its certificates, oldest first, are the previous certificates in
     fingerprints.md, then the current one;
   - the old keys' rights are as in point 3.
7. The lineage is a base64 text file, `docs/security/signing-lineage.txt`.
   - It is owner-only in CODEOWNERS. Only the owner provides it, as for
     fingerprints.md.
   - The Sign job checks it out next to fingerprints.md.
   - A copy goes into the ceremony's encrypted backup with the new key.
8. In fingerprints.md, the old certificate moves to "Previous
   certificates", with the dates it was used and the last release signed
   with it. The hub's verify page lists the previous certificates too.
9. The old key's backup is kept. Only with it can the old key's rights be
   changed later.
10. The steps, in order, are in
    [release.md](../development/release.md#rotate-the-signing-key).
11. What users see and do:
    1. Obtainium shows "Signing certificate mismatch" once for each app.
    2. They go on only when the release notes and the hub announce the
       new key.
    3. Before **Install anyway**, they compare: the first downloaded hash
       is the expected one, and the last is the new fingerprint on the
       hub.
    4. AppVerifier then shows two fingerprints. The last must be the new
       one. With it, "Verify from clipboard" shows "Verification Status:
       SUCCESS".
    5. Users who typed fingerprints into Obtainium add the new one.
    6. Nothing else. The data stays.

    The exact words are in [install.md](../user/install.md#when-the-signing-key-changes)
    and [verify.md](../user/verify.md#after-a-new-signing-key).

## Options rejected

- **A v3.1 block, with a rotation minimum above 33.** Android 13 would keep
  the old key, and two keys would be in use at once. Nothing is gained.
- **A new key with no lineage.** Every user would have to uninstall each
  app, install it again and restore a backup. A rotation does the same
  job without that.
- **apksigner's default rights for the old key.** They leave permission
  and auth on. Then an app signed with the old key would pass the suite's
  signature-protected interfaces. After a theft, that is exactly what
  must stop.
- **Rollback on.** apksigner itself warns that it removes the benefit of
  a rotation.
- **The lineage as a fourth release secret.** It changes point 4 of 0013,
  and nobody can review a secret. The lineage is public anyway. The owner
  decided on 2026-11-14.
- **Signing with both keys, the old one for v1 and v2.** No device that
  runs the apps reads v1 or v2, and it would bring the old key back into
  every release.

## Consequences

- A rotation needs changes to owner-only files. The owner asks for each
  at the time:
  - `release.yml`: points 4 and 6;
  - `.github/CODEOWNERS`: the lineage file;
  - fingerprints.md: the values, which only the owner provides;
  - the lineage file itself.

  It also needs a change to `tools/site`, so that the hub lists previous
  certificates, and to the docs.
- The rehearsal of a rotation is in
  [signing-key-rehearsal.md](../development/signing-key-rehearsal.md).
- [0002](0002-grapheneos-first-minimum-android-13.md) says that rotation
  uses scheme v3.1. With this record it is scheme v3 with a lineage,
  which every supported device reads too.
- Until a phone has updated every app, the apps on it run under two keys.
  Signature-protected calls between an app on the old key and an app on
  the new key may fail until both are updated. No app uses such an
  interface yet. Release every app on the same day.
- Open: how those calls behave during the update, for the handover
  between apps (step 3.0) and for the courier interface of sync
  (Phase 5).
- Open: signing-ceremony needs a `rotate` action before a real rotation.
  - Its `create` refuses while a backup exists: "A backup already
    exists. This workflow never replaces a signing key." So `rotate` must
    also make the new key and back it up, and keep the old key's backup
    (point 9).
  - In one job, it decrypts the old backup, makes the new key, and runs
    the commands of the step "Rotate and sign" in
    [`rehearsal.yml`](../development/signing-key-rehearsal/rehearsal.yml).
  - Claude cannot see that repository, so the owner adds it.
- Open: whether the ceremony's token needs only the permission
  Environments. Its notes ask for Environments and Secrets, and the
  rehearsal used both
  ([signing-key-rehearsal.md](../development/signing-key-rehearsal.md#open-points),
  point 2).
- Open: whether, and when, the old key's installed-data right is turned
  off once users have moved. Then an app that was never updated could no
  longer update.
