# Signing key rehearsal

How to check the real backup of the signing key and its two copies, from
a phone, and what the rehearsal of a restore and a rotation with
throwaway keys showed. The checks read the real backup and change
nothing.

Why: [ADR 0013](../adr/0013-signing-key-custody-and-rotation.md), points
8 and 10. A rotation works as
[ADR 0037](../adr/0037-signing-key-rotation.md) says. What to do if the
key is stolen is in [ADR 0038](../adr/0038-a-stolen-signing-key.md). How
to restore and rotate the real key is in
[release.md](release.md#the-signing-key).

## What the rehearsal showed

The rehearsal ran in a throwaway public repository, with throwaway keys
only, never with the real key, `release` or the real backup. It used
the Pixel 9 Pro, Obtainium 1.7.4 and apksigner from build tools 36.0.0.

Restore:

- The ceremony's `restore` writes the three secrets into an environment
  that exists. It cannot create the environment. With the environment
  deleted, it failed with "failed to fetch public key: HTTP 404: Not
  Found" and "The backup is saved, but the secrets were not all stored.
  Check CEREMONY_TOKEN, then run restore." Once the environment existed
  again, `restore` was green and showed the same fingerprint.
- The token had Environments and Secrets, read and write.
- An APK signed with the restored key installed with Obtainium, and
  Obtainium and AppVerifier showed its one certificate.

Rotation:

- With a minimum of Android 13 or newer (the suite's is Android 15),
  apksigner puts the new key and the lineage in the scheme v3 block. It
  writes no v3.1 block.
- A release after a rotation needs only the new key and the lineage. It
  must turn off schemes v1 and v2 by name. Without that, apksigner asks
  for the old key too, although it would not use it.
- The lineage gives the old key only the right to hand over the
  installed app and its data. `apksigner lineage --print-certs` shows the
  old key first.
- The rotated APK verified as scheme v3 only, no v3.1, one signer, the
  new key.
- The rotated update installed over the app signed with the old key,
  and the data stayed. Obtainium first showed "Signing certificate
  mismatch", with "Expected certificate hash" the old key and
  "Downloaded certificate hash" two lines, the old key and then the new
  one. The update went on after **Install anyway**.
- AppVerifier then showed both fingerprints, the old one first. **Verify
  from clipboard**, with the package name and the new key's SHA-256 on
  two lines, gave "Verification Status: SUCCESS".
- Over the rotated app, Android refused an APK signed with the old key
  alone, and one signed with a thief's lineage from the old key to
  another key. Both times it said "App not installed".

The two commands of a rotation, as the rehearsal ran them. The old key
keeps only its right to hand over the installed data:

```bash
apksigner rotate --out lineage.bin \
  --old-signer --ks old.p12 --ks-type PKCS12 --ks-key-alias <old alias> \
    --ks-pass env:OLD_PASSWORD --key-pass env:OLD_PASSWORD \
    --set-installed-data true --set-shared-uid false --set-permission false \
    --set-rollback false --set-auth false \
  --new-signer --ks new.p12 --ks-type PKCS12 --ks-key-alias <new alias> \
    --ks-pass env:NEW_PASSWORD --key-pass env:NEW_PASSWORD
```

```bash
apksigner sign --ks new.p12 --ks-type PKCS12 --ks-key-alias <new alias> \
  --ks-pass env:NEW_PASSWORD --key-pass env:NEW_PASSWORD \
  --lineage lineage.bin --rotation-min-sdk-version 33 \
  --v1-signing-enabled false --v2-signing-enabled false --v4-signing-enabled false \
  --out app.apk app-unsigned.apk
```

## Check the real backup

This check reads the real backup. It writes no secret, has no token
that can write, and prints only names, sizes, SHA-256 values and the
certificate's public fingerprint. It runs in signing-ceremony,
with [`check-backup.yml`](signing-key-rehearsal/check-backup.yml).
signing-ceremony allows only actions from your own repositories, and you
keep that setting. So the check uses no action at all. It checks out
with plain git and the job's read-only token.

The cost: like every restore, the real key is in the memory of a GitHub
runner while the check runs. It is never written to the runner's disk.
GitHub keeps the passphrase you type into **Check backup** with the run,
so you delete the runs at the end.

How it keeps the secrets out of the log:

- GitHub prints a step's script and its `env:` values in the log. So the
  check never puts the passphrase in either. It reads the passphrase from
  the run's event file, and masks it before it does anything else.
- It masks the keystore password the moment it reads it, before any use.

### 1. Add the check

1. Open [`check-backup.yml`](signing-key-rehearsal/check-backup.yml) in
   shkriuss.app. Copy the raw file.
2. In signing-ceremony, open `.github/workflows/check-backup.yml`.
   - If it is there already, tap the pencil and replace all of it with
     what you copied.
   - If it is not there, create it and paste.
3. Commit to `main`.

What to look for: the file in signing-ceremony has no line with `uses:`.

### 2. Run it without the passphrase

First a run that needs nothing secret. It shows that GitHub starts the
check, and that the check finds the backup.

1. Open **Actions**, **Check backup**, **Run workflow**.
2. **mode**: `files`. Leave the passphrase and the file names empty.
3. Tap **Run workflow**, and open the run.

What to look for: a green run. The step **Check out** ends with "Checked
out" and the commit of the run. The summary lists
`backup/signing-key.tar.gpg` with its SHA-256.

If the run fails, or does not start, stop here and do not type the
passphrase. Tell Claude in a session what the run says.

### 3. List the files in the backup

1. Open **Actions**, **Check backup**, **Run workflow**.
2. **mode**: `list`. **passphrase**: the real passphrase. Leave the
   file names empty.
3. Tap **Run workflow**, and open the run.

What to look for: a green run. The summary lists the SHA-256 of
`backup/signing-key.tar.gpg`, and the size and name of each file in the
backup. The log shows no passphrase anywhere. Note the name of the
keystore file and of the file with its password.

If the run fails with "The passphrase does not open
backup/signing-key.tar.gpg, or it holds no files.", the passphrase was
most likely mistyped. Run it again with the right passphrase. Delete
the failed run too, in step 5.

### 4. Check the key

1. Run it again. **mode**: `check`. Type the passphrase, and the two
   names exactly as step 3 showed them.

What to look for: every line of the summary says **Yes**:

- the passphrase opens the backup;
- one certificate, alias `shkriuss`;
- its private key belongs to the certificate;
- the same as the current line of
  [fingerprints.md](../security/fingerprints.md);
- the same as `backup/fingerprint.txt`.

If any line says **No**, change nothing. Tell Claude in a session what
the summary says, never the passphrase.

### 5. Delete the runs

1. Open each run of **Check backup**, tap the menu at the top right and
   **Delete workflow run**. Include the runs that failed.

What to look for: no run of **Check backup** is left that you typed the
passphrase into.

Keep `check-backup.yml` in signing-ceremony. Run it again whenever the
backup or its copies change.

## Check the two copies

The copies are in cloud storage. Two ways to check that each is the same
file as `backup/signing-key.tar.gpg`. Both compare SHA-256 values. A
matching size alone proves nothing.

First download each copy from the cloud storage to the phone. If the
cloud app offers to preview or convert the file, use its plain
**Download** instead. A changed file cannot match.

### Way 1: without an extra app

1. Rename the downloads `copy-1.tar.gpg` and `copy-2.tar.gpg`, in
   **Files**: long-press the file, then **Rename**. Each name must end in
   `.gpg`.
2. In signing-ceremony, at the top level of the repository, not in
   `backup/`, tap **Add file**, then **Upload files**. Pick both files.
   Commit to `main`.
3. Run **Check backup** with **mode** `files`. Leave the passphrase empty.
4. Delete both uploads: open each file, tap the menu, **Delete file**,
   and commit.
5. Delete the downloads in **Files**, and delete the run.

What to look for: in the summary, both copies say **Yes**, with the same
SHA-256 as the backup.

Git keeps every upload in the history of signing-ceremony, also after you
delete it. A copy that is the same file adds nothing: Git stores the same
bytes only once. A copy that differs stays in the history, encrypted as
before.

### Way 2: with an app

GrapheneOS has no built-in way to show a file's SHA-256. If you prefer
not to upload, use an app that shows it, from a source you trust. It only
ever sees the encrypted file.

1. Open each download in that app and show its SHA-256.
2. Compare all 64 characters with the SHA-256 of
   `backup/signing-key.tar.gpg` from any run of **Check backup**.
3. Delete the downloads.

## Open points

1. **A `rotate` action in the real ceremony.** A real rotation needs one.
   The ceremony's `create` refuses while a backup exists: "A backup
   already exists. This workflow never replaces a signing key." So
   `rotate` must also make the new key and back it up, and keep the old
   key's backup. In one job, it decrypts the old backup, makes the new
   key, and runs the two commands under
   [What the rehearsal showed](#what-the-rehearsal-showed). Claude cannot
   see signing-ceremony, so you add it, before a real rotation
   ([ADR 0037](../adr/0037-signing-key-rotation.md)).
2. **The token's permissions.** The ceremony's notes ask for
   Environments and Secrets, read and write, and the rehearsal used both.
   GitHub's documentation names only Environments for the calls the
   ceremony makes. Whether Environments alone is enough was not tested.
3. **AppVerifier with the old key.** The rehearsal tested only that the
   new key's SHA-256 gives "Verification Status: SUCCESS". Whether the
   old key's SHA-256 gives a failure on the rotated app was not tested.
4. **How often to run `check-backup.yml`**, beyond after each change of the
   backup.
