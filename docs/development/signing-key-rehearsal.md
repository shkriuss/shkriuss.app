# Signing key rehearsal

How to rehearse restoring the signing key from its backup, and rotating
it to a new key, from a phone. Both use throwaway keys only. The real
`release` environment, its secrets and the real backup are never touched.
The last two parts then check the real backup and its two copies, and
change nothing.

Why: [ADR 0013](../adr/0013-signing-key-custody-and-rotation.md), point 8.
A rotation works as [ADR 0037](../adr/0037-signing-key-rotation.md) says.
What to do if the key is stolen is in
[ADR 0038](../adr/0038-a-stolen-signing-key.md). This page is step 2.7 of
[PROMPTS.md](PROMPTS.md#27-restore-and-rotation-rehearsal). Do it before
Water, the first data app, is released.

Done on 2026-11-14, on the Pixel 9 Pro with Obtainium 1.7.4. Every part
passed. See [Results](#results). The steps below are corrected to match
what happened, so the rehearsal can be done again the same way.

## Where it runs

Parts 0 to C run in a new, public, throwaway repository, `key-rehearsal`.
You delete it at the end.

- It has its own environment `rehearsal`, set up like `release`: your
  approval, `main` only. Only a public repository can have that on GitHub
  Free or Pro.
- It holds a copy of the signing-ceremony workflow, pointed at
  `rehearsal`, and the rehearsal workflow
  [`rehearsal.yml`](signing-key-rehearsal/rehearsal.yml).
- While the copy runs, it reads two repository secrets of key-rehearsal,
  as the real ceremony does in signing-ceremony: `CEREMONY_TOKEN`, a
  token, and `BACKUP_PASSPHRASE`, a throwaway passphrase. You delete both
  as soon as the restore in A3 is green.
- Its token can reach nothing but `key-rehearsal`. So nothing in it can
  write to shkriuss.app, its `release` environment or signing-ceremony.
- It is public. Everything in it must be throwaway: the keys, the
  passphrase and the token.

Parts D and E run in signing-ceremony, with
[`check-backup.yml`](signing-key-rehearsal/check-backup.yml). They read
the real backup and change nothing.

- signing-ceremony allows only actions from your own repositories, and
  you keep that setting. So `check-backup.yml` uses no action at all. It
  checks out with plain git and the job's read-only token.
- `rehearsal.yml` uses three of GitHub's own actions. A new repository
  allows them ([Part 0, step 3](#3-allow-githubs-actions)).

| Part | What it shows | Where |
|---|---|---|
| [0](#part-0-set-up) | The throwaway repository is ready | key-rehearsal |
| [A](#part-a-restore) | The ceremony's restore brings a key back, and the release steps sign with it | key-rehearsal |
| [B](#part-b-rotate) | A rotated update installs over the old app; the old key alone, and a thief's lineage, cannot | key-rehearsal |
| [C](#part-c-clean-up) | Nothing is left behind | key-rehearsal, your phone |
| [D](#part-d-check-the-real-backup) | The real backup opens and holds the suite key | signing-ceremony |
| [E](#part-e-check-the-two-copies) | The two copies outside GitHub are the same file | signing-ceremony, your phone |

Allow about two hours for parts 0 to C. Each build takes about ten
minutes.

## What was tried before

On 2026-11-14 Claude ran the commands of both workflows in the cloud
environment, with throwaway keys made and deleted there. Nothing was
committed or kept. What it showed:

- With a minimum of Android 13, apksigner puts the new key and the
  lineage in the scheme v3 block. It writes no v3.1 block.
- A release after a rotation needs only the new key and the lineage. It
  must turn off schemes v1 and v2 by name
  (`--v1-signing-enabled false --v2-signing-enabled false`). Without that,
  apksigner asks for the old key too, although it would not use it.
- `apksigner lineage --print-certs` shows the old key first, with only
  the right to hand over the installed app and its data.
- The backup check works for a keystore file and for a keystore stored as
  base64. It reads them only through pipes, with OpenSSL. keytool cannot
  read a keystore from a pipe.

What only a phone shows is in parts A and B: Android's answer to each
install, Obtainium's warning and what AppVerifier shows. The owner's
results are under [Results](#results).

Later on 2026-11-14, Claude tried the checkout of `check-backup.yml`,
which uses no action. The test ran against a throwaway repository, served
by `git http-backend` behind a server that refuses every request without
the token. It showed:

- The checkout fetched exactly the commit it was asked for, the newest one
  and an older one, one commit deep.
- A wrong token and a commit that does not exist both failed at once.
- The token, and the header made from it, were found nowhere: not in
  `.git`, not in the git config, not in the URLs the server saw, and not
  in the output once masked.
- The unchanged check then ran in that checkout, in all three modes.
  Neither the passphrase nor the keystore password showed.

What only GitHub shows:

- that it starts the workflow in signing-ceremony;
- that it gives the run's commit to the job's token;
- that its log masks the token.

[D2](#d2-run-it-without-the-passphrase) shows the first two. On
2026-11-14 every run of part D was green.

## Part 0: Set up

### 1. Read the ceremony workflow first

You copy it into a public repository, so check it before anything else.

1. Open the signing-ceremony repository, then its folder
   `.github/workflows`.
2. Open each workflow file and read all of it.
3. Check that it holds only names of secrets, such as
   `${{ secrets.NAME }}`, never a value. A value looks like a long string
   of random letters and digits, a block of base64, a password or a token.

What to look for: names only. If you find anything that looks like a
value, stop. Do not copy the file. Ask Claude in a session what to do, and
never paste the value.

### 2. Create the repository

1. Open `github.com/new`.
2. Name it `key-rehearsal`. Pick **Public**. Tick **Add a README file**.
3. Tap **Create repository**.

### 3. Allow GitHub's actions

`rehearsal.yml` uses three of GitHub's own actions: `actions/checkout`,
`actions/upload-artifact` and `actions/download-artifact`. A new
repository allows all actions, so you need not change anything. The
rehearsal on 2026-11-14 ran without this step.

Only if you changed that setting in key-rehearsal:

1. In key-rehearsal, open **Settings**, then **Actions**, then
   **General**.
2. Under **Actions permissions**, pick **Allow shkriuss, and select
   non-shkriuss, actions and reusable workflows**.
3. Tick **Allow actions created by GitHub**. Leave **Allow actions by
   Marketplace verified creators** unticked, and leave the list of other
   actions empty.
4. Tap **Save**.

If GitHub's words differ, pick the choice that allows your own actions
and GitHub's, and nothing else. The ceremony copy uses no action, so this
choice is enough for it too.

What to look for: the choice is still picked when you open the page
again.

### 4. Create the environment

1. In key-rehearsal, open **Settings**, then **Environments**, then
   **New environment**.
2. Type `rehearsal` and tap **Configure environment**.
3. Tick **Required reviewers** and add `shkriuss`.
4. Leave **Prevent self-review** unticked. You start the runs and approve
   them yourself.
5. Tap **Save protection rules**.
6. Untick **Allow administrators to bypass configured protection rules**
   and tap **Save protection rules**.
7. Under **Deployment branches**, pick **Selected branches and tags**. Tap
   **Add deployment branch or tag rule**, pick **Branch**, type `main` and
   tap **Add rule**.
8. Add no secrets. The ceremony copy writes them.

What to look for: `rehearsal` is listed with "1 protection rule" or more,
and no secrets.

### 5. Make the token

The ceremony copy needs a token to write the three secrets into
`rehearsal`. Make a new one that can reach only key-rehearsal:

1. Open `github.com/settings/personal-access-tokens/new`.
2. **Token name**: `key-rehearsal`.
3. **Expiration**: **Custom**, 7 days from today.
4. **Resource owner**: you.
5. **Repository access**: **Only select repositories**, then
   `key-rehearsal` and nothing else.
6. **Permissions**, under **Repository permissions**:
   - **Environments**: **Read and write**.
   - **Secrets**: **Read and write**.
   - Everything else: **No access**. GitHub adds **Metadata: Read-only**
     to every token by itself.
7. Tap **Generate token**. GitHub shows it once. Copy it.
8. In key-rehearsal, open **Settings**, then **Secrets and variables**,
   then **Actions**. Tap **New repository secret**.
9. **Name**: `CEREMONY_TOKEN`. **Secret**: paste the token. Tap **Add
   secret**.

What to look for: `CEREMONY_TOKEN` is listed under **Repository secrets**.

The ceremony's own notes ask for both permissions, Environments and
Secrets. The rehearsal used both. GitHub's documentation names only
Environments for the calls the ceremony makes. Whether Environments alone
is enough was not tested ([Open points](#open-points), point 2).

You delete this secret and the token in A3, as soon as the restore is
green. Never paste the token into a Claude session.

### 6. Copy the ceremony workflow

1. In signing-ceremony, open the folder `.github/workflows` and the
   ceremony's workflow file. Tap the button that copies the raw file.
2. In key-rehearsal, tap **Add file**, then **Create new file**. Name it
   `.github/workflows/` followed by the same file name as in
   signing-ceremony.
3. Paste.
4. Find the step "Run the ceremony", and under it the lines below `env:`.
   Change exactly two lines, so that they read:
   - `APP_REPO: shkriuss/key-rehearsal`
   - `APP_ENVIRONMENT: rehearsal`
5. Change nothing else.
6. Tap **Commit changes**, and commit to `main`.

What to look for: in the new file, those two lines name key-rehearsal and
`rehearsal`. No line names shkriuss.app or `release`.

### 7. Add the rehearsal workflow

1. Open [`rehearsal.yml`](signing-key-rehearsal/rehearsal.yml) in
   shkriuss.app. Tap the button that copies the raw file.
2. In key-rehearsal, create the file `.github/workflows/rehearsal.yml`,
   paste, and commit to `main`.

### 8. Make a throwaway passphrase

1. Make a new passphrase of at least 30 characters, for example with your
   password manager. The ceremony refuses a shorter one. Never use the
   real one, or one you use anywhere else: the throwaway backup that it
   encrypts is public.
2. In key-rehearsal, open **Settings**, then **Secrets and variables**,
   then **Actions**. Tap **New repository secret**.
3. **Name**: `BACKUP_PASSPHRASE`. **Secret**: paste the passphrase. Tap
   **Add secret**.

What to look for: two repository secrets, `BACKUP_PASSPHRASE` and
`CEREMONY_TOKEN`.

You never type the passphrase into a run. The ceremony reads it from this
secret.

### 9. Prepare the phone

Do this once, before part A only. Never between part A and part B: part
B updates the app that part A installs.

Use the Pixel 9 Pro.

1. Open **Settings**, **Apps**. If **Catalog preview** is installed,
   uninstall it. The real Catalog stays.
2. Make sure Obtainium is version 1.6.16 or newer. Part B looks at a
   warning that came with that version. The rehearsal on 2026-11-14 used
   1.7.4.

## Part A: Restore

### A1. Make throwaway key A

1. In key-rehearsal, open **Actions** and tap the copy of the ceremony
   workflow. Tap **Run workflow**.
2. Leave the branch at `main`.
3. **action**: pick `create`. **confirm**: type `YES`.
4. Tap **Run workflow**. Pull the page down to reload it, and open the
   new run.
5. When it is green, open **Code**, the folder `backup` and the file
   `fingerprint.txt`. Copy its SHA-256. It is public.

What to look for:

- a green run;
- in key-rehearsal, the files `backup/signing-key.tar.gpg` and
  `backup/fingerprint.txt`;
- in **Settings**, **Environments**, `rehearsal`: three secrets,
  `SIGNING_KEYSTORE_B64`, `SIGNING_KEYSTORE_PASSWORD` and
  `SIGNING_KEY_ALIAS`.

The run's summary ends: "Now download backup/signing-key.tar.gpg, keep
copies outside GitHub, then delete the two secrets in this repository and
the access token." That is for the real ceremony. In the rehearsal, keep
the two repository secrets and the token until A3 is green, because A3
needs them. You need not download the throwaway backup.

`create` never replaces a key. If a backup already exists, it stops with
"A backup already exists. This workflow never replaces a signing key."

### A2. Lose the key

1. In key-rehearsal, open **Settings**, then **Environments**. Tap the
   name `rehearsal`. Do not tap the bin next to it.
2. Under **Environment secrets**, tap the bin next to
   `SIGNING_KEYSTORE_B64`, and confirm.
3. Do the same for `SIGNING_KEYSTORE_PASSWORD` and `SIGNING_KEY_ALIAS`.
4. Leave the two repository secrets, `CEREMONY_TOKEN` and
   `BACKUP_PASSPHRASE`. A3 needs them.

Delete the three secrets inside the environment, never the environment.
The bin on the list of environments deletes the whole environment, with
its protection rules. If you did that, create it again as
[Part 0, step 4](#4-create-the-environment) says, before A3.

What to look for: `rehearsal` is still listed, with its protection rules,
and it has no secrets.

### A3. Restore it

1. In key-rehearsal, open **Actions** and tap the copy of the ceremony
   workflow. Tap **Run workflow**.
2. Leave the branch at `main`.
3. **action**: pick `restore`. **confirm**: type `YES`.
4. Tap **Run workflow**. Pull the page down to reload it, and open the
   new run.

What to look for: a green run that shows "Signing key: restore finished"
and the SHA-256 from A1. In `rehearsal`, three secrets,
`SIGNING_KEYSTORE_B64`, `SIGNING_KEYSTORE_PASSWORD` and
`SIGNING_KEY_ALIAS`, each updated just now.

If the run fails with "failed to fetch public key: HTTP 404: Not Found"
for `.../environments/rehearsal/secrets/public-key`, and "The backup is
saved, but the secrets were not all stored. Check CEREMONY_TOKEN, then
run restore.":

1. Open **Settings**, **Environments**. If `rehearsal` is not listed,
   create it again as [Part 0, step 4](#4-create-the-environment) says.
   That was the cause on 2026-11-14.
2. If it is listed, check the token: open
   `github.com/settings/personal-access-tokens` and tap `key-rehearsal`.
   It must reach key-rehearsal, with the permissions of
   [Part 0, step 5](#5-make-the-token).
3. Run `restore` again.

As soon as the restore is green, clean up as the real ceremony does. The
later parts do not need these: `rehearsal.yml` reads only the three
secrets of `rehearsal` and the job's own token.

1. In key-rehearsal, open **Settings**, then **Secrets and variables**,
   then **Actions**.
2. Under **Repository secrets**, tap the bin next to `BACKUP_PASSPHRASE`,
   and confirm. Do the same for `CEREMONY_TOKEN`. Leave the secrets of
   `rehearsal`.
3. Open `github.com/settings/personal-access-tokens`, tap
   `key-rehearsal`, then **Delete**, and confirm.

What to look for: no repository secrets in key-rehearsal, three secrets
in `rehearsal`, and no token named `key-rehearsal`.

### A4. Sign with the restored key

1. Open **Actions**, **Rehearsal**, **Run workflow**.
2. **action**: `sign`. **old_fingerprint**: the SHA-256 from A1.
3. Tap **Run workflow**. Pull the page down to reload it, and open the
   new run.
4. After **Build**, the job **Sign with key A** shows "Waiting". Tap
   **Review deployments**, tick `rehearsal` and tap **Approve and
   deploy**.

What to look for: **Build**, **Sign with key A** and **Draft release** are
green. The summary's "Part A" shows the certificate SHA-256 from A1. This
shows that the restored secrets hold key A and sign as a release does.

### A5. Install it with Obtainium

1. Open **Releases** in key-rehearsal. Tap the draft `v0.2.0-preview`, the
   pencil, then **Publish release**.
2. In Obtainium, tap **Add app**. Type
   `https://github.com/shkriuss/key-rehearsal` and tap **Add**.
3. Tap **Install**. Open the app once.

What to look for: Catalog preview 0.2.0-preview installs and opens.

If Obtainium stops with "Error 403" for an address that starts with
`https://api.github.com/repos/shkriuss/key-rehearsal/releases/assets/`,
and "Too many requests (rate limited) - try again in" some minutes, GitHub
has refused too many requests from the phone's internet address. Wait a
few minutes, or switch between mobile data and Wi-Fi, then try again. On
2026-11-14 this happened on mobile data, and worked a few minutes later.

### A6. Check it with AppVerifier

1. Open AppVerifier and tap **Catalog preview**.

What to look for: one SHA-256, the one from A1.

## Part B: Rotate

### B1. Rotate from key A to key B

1. Open **Actions**, **Rehearsal**, **Run workflow**.
2. **action**: `rotate`. **old_fingerprint**: the SHA-256 from A1.
3. Tap **Run workflow**. Pull the page down to reload it, and open the
   new run.
4. After **Build**, the job **Rotate A to B** shows "Waiting". Tap
   **Review deployments**, tick `rehearsal` and tap **Approve and
   deploy**.

What to look for: all jobs green. The summary's "Part B":

- shows three different keys: A, B and C;
- says "All three APKs: scheme v3, no v3.1 block, one signer.";
- shows the rotated APK's lineage with two certificates, A first, then B;
- shows A's rights as `true false false false false`. That means key A
  may hand over the installed app and its data, and nothing else.

Keys B and C were made in the job and are gone.

### B2. Update with Obtainium

Catalog preview 0.2.0 from part A must still be installed. Do not
uninstall it before this step. If you did:

1. Open **Releases** in key-rehearsal and tap `v0.2.0-preview`.
2. Tap `catalog-preview-0.2.0-preview-key-a.apk` to download it.
3. Open the download and tap **Install**.
4. Then go on with step 1 below.

Then:

1. Open **Releases** in key-rehearsal. Tap the draft `v0.3.0-preview`, the
   pencil, then **Publish release**.
2. In Obtainium, pull the list down to check for updates. Tap **Catalog
   preview**. It shows "0.2.0-preview Installed", "v0.3.0-preview Latest"
   and, under "Certificate Hash", key A.
3. Tap **Update**. Obtainium shows "Signing certificate mismatch":
   "Catalog preview is signed with a different certificate than the
   installed version. Installing it will most likely fail. Only continue
   if you trust this source."
4. Compare the hashes in that dialog:
   - "Expected certificate hash" must be key A, the SHA-256 from A1.
   - "Downloaded certificate hash" shows two lines. The first must be key
     A. The last must be key B, from the summary of B1.
5. Tap **Install anyway**.
6. If Android asks whether to update the app, allow it. What Android asked
   on 2026-11-14 was not written down.

What to look for: an update, not a new install. The app opens. Obtainium
now shows "Certificate Hashes" with key A, then key B.

### B3. Check it with AppVerifier

1. Open AppVerifier and tap **Catalog preview**. It shows "Internal
   Database Status: NOT FOUND", the package name, key A and then key B,
   and "Verification Status: UNKNOWN".
2. In a note, write two lines: `app.shkriuss.catalog.preview`, then key
   B's SHA-256 from the summary of B1. Select both lines and copy them.
3. In AppVerifier, tap **Verify from clipboard**.

What to look for: "Verification Status: SUCCESS".

Only this case was tested: the new key's SHA-256 gives SUCCESS. Whether
key A's SHA-256 would give a failure was not tested
([Open points](#open-points), point 3).

### B4. Try the old key alone

1. Open the run of B1. Under **Artifacts**, tap
   `catalog-preview-0.3.0-preview-old-key-only.apk`.
2. Open the download and tap **Install**, or **Update**.
3. Android may first ask "Update this app using Package installer?",
   with "This app normally receives updates from Obtainium. By updating
   using a different source, you may receive future updates from any
   source on your phone. App functionality may change." Tap **Update
   anyway**. Android's answer to the file comes only after that.

That question appeared on 2026-11-14, while Obtainium was the installer
of the app. After the recovery at the start of B2, where 0.2.0 is
installed from the release page, it may not appear.

What to look for: Android refuses it. On 2026-11-14 it showed "App not
installed" with the button **Close**, and nothing more. This shows that
once a phone has the rotated app, the old key alone can no longer update
it.

### B5. Try the thief's lineage

1. Do the same with `catalog-preview-0.3.0-preview-thief.apk`.

What to look for: Android refuses it too. On 2026-11-14 it showed "App not
installed" with the button **Close**, as in B4. This shows that someone
who holds the old key cannot take over a phone that already has the
rotated app, even with a lineage of their own.

## Part C: Clean up

Do all of these in one sitting.

1. Uninstall **Catalog preview** in **Settings**, **Apps**.
2. In Obtainium, remove Catalog preview.
3. In **Files**, delete the APKs you downloaded.
4. Check that the token is gone: open
   `github.com/settings/personal-access-tokens`. No token is named
   `key-rehearsal`. If it is still there, tap it, then **Delete**.
5. Delete the repository: in key-rehearsal, open **Settings**, scroll to
   the bottom, tap **Delete this repository** and follow the steps. This
   deletes its secrets, runs, artifacts and releases.
6. Forget the throwaway passphrase. Delete it from your password manager.

What to look for: the token and the repository are gone.

## Part D: Check the real backup

This is the only part that touches the real backup. It writes no secret,
has no token that can write, and prints only names, sizes, SHA-256 values
and the certificate's public fingerprint. It uses no action, because
signing-ceremony allows only your own. It checks out with plain git.

The cost: like every restore, the real key is in the memory of a GitHub
runner while the check runs. It is never written to the runner's disk.
GitHub keeps the passphrase you type into **Check backup** with the run,
so you delete the runs at the end.

How it keeps the secrets out of the log:

- GitHub prints a step's script and its `env:` values in the log. So the
  check never puts the passphrase in either. It reads the passphrase from
  the run's event file, and masks it before it does anything else.
- It masks the keystore password the moment it reads it, before any use.

### D1. Add the check

1. Open [`check-backup.yml`](signing-key-rehearsal/check-backup.yml) in
   shkriuss.app. Copy the raw file.
2. In signing-ceremony, open `.github/workflows/check-backup.yml`.
   - If it is there already, tap the pencil and replace all of it with
     what you copied.
   - If it is not there, create it and paste.
3. Commit to `main`.
4. If a run of the old file stopped with "not allowed", and you typed the
   passphrase into it, delete that run as [D5](#d5-delete-the-runs) says.
   GitHub keeps what you typed with the run, also when the run never
   started.

What to look for: the file in signing-ceremony has no line with `uses:`.

### D2. Run it without the passphrase

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

### D3. List the files in the backup

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
most likely mistyped. That happened on 2026-11-14. Run it again with the
right passphrase. Delete the failed run too, in D5.

### D4. Check the key

1. Run it again. **mode**: `check`. Type the passphrase, and the two
   names exactly as D3 showed them.

What to look for: every line of the summary says **Yes**:

- the passphrase opens the backup;
- one certificate, alias `shkriuss`;
- its private key belongs to the certificate;
- the same as the current line of
  [fingerprints.md](../security/fingerprints.md);
- the same as `backup/fingerprint.txt`.

If any line says **No**, change nothing. Tell Claude in a session what
the summary says, never the passphrase.

### D5. Delete the runs

1. Open each run of **Check backup**, tap the menu at the top right and
   **Delete workflow run**. Include the runs that failed.

What to look for: no run of **Check backup** is left that you typed the
passphrase into.

Keep `check-backup.yml` in signing-ceremony. Run it again whenever the
backup or its copies change.

## Part E: Check the two copies

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

## Results

The owner's results of 2026-11-14, on the Pixel 9 Pro with Obtainium
1.7.4. An advisor (Claude, in a separate chat) read the public
key-rehearsal repository while it existed, and checked both published
APKs with apksigner from build tools 36.0.0.

| Part | Date | Result | Notes |
|---|---|---|---|
| 0 Set up | 2026-11-14 | Passed | Step 3 was not needed: a new repository allows all actions. The token had Environments and Secrets, read and write, as the ceremony's notes say. The copy of the ceremony changed two lines: `APP_REPO: shkriuss/key-rehearsal` and `APP_ENVIRONMENT: rehearsal`. It holds only names of secrets. |
| A Restore | 2026-11-14 | Passed | `create` made throwaway key A, `48:7F:F5:B4:8C:1D:33:58:3B:34:63:78:D9:70:3A:DE:46:F3:33:15:3B:C6:66:C6:F6:26:2B:77:0E:59:AC:5F`, and saved the backup and `fingerprint.txt`. The first `restore` failed with "failed to fetch public key: HTTP 404: Not Found" and "The backup is saved, but the secrets were not all stored. Check CEREMONY_TOKEN, then run restore." The cause: in A2 the whole environment `rehearsal` had been deleted, not its three secrets. After it was created again, `restore` was green: "Signing key: restore finished", the same fingerprint, and the three secrets were back. `sign` was green: Build, Sign with key A, Draft release. The advisor's check of `catalog-preview-0.2.0-preview-key-a.apk`: it verifies, scheme v3 only, one signer, key A. Obtainium installed 0.2.0-preview. Obtainium and AppVerifier showed one certificate, key A. |
| B Rotate | 2026-11-14 | Passed | `rotate` was green. Its summary showed three keys, "All three APKs: scheme v3, no v3.1 block, one signer.", and the lineage with A first, then B. Key B: `ED:15:1B:F4:C1:17:2E:D9:D5:A4:44:C1:8A:B6:4A:69:04:9D:1B:9D:64:4D:73:0F:96:DC:64:F2:7D:C1:A5:6F`. Key C began `B4:FA:64:C8:7B:25:16:0B:DF:52:06`. The advisor's check of `catalog-preview-0.3.0-preview-rotated.apk`: it verifies, scheme v3 only, no v3.1, one signer, key B; its lineage is key A, with installed data true and the other four rights false, then key B. B2 had to be repeated: 0.2.0 was uninstalled by mistake before it. After **Install anyway**, the update installed over 0.2.0. B3 gave SUCCESS with key B. Android refused B4 and B5. |
| C Clean up | 2026-11-14 | Done | The app, the APKs, the token and the repository are gone. The clean-up at the end of A3 was added to this page after the rehearsal. On 2026-11-14 the token was deleted in this part, and the two repository secrets went with the repository. |
| D The real backup | 2026-11-14 | Passed | `files`, `list` and `check` were green, and every line of `check` said Yes. The first run of `list` failed with "The passphrase does not open backup/signing-key.tar.gpg, or it holds no files.", because the passphrase was mistyped. The runs are deleted. |
| E The two copies | 2026-11-14 | Passed | Both copies said "Same as the backup: Yes". |

The exact words, for the user guide:

| Where | What it showed |
|---|---|
| Obtainium, B2, before the update | "0.2.0-preview Installed", "v0.3.0-preview Latest", and "Certificate Hash" with key A. |
| Obtainium, B2, after **Update** | A dialog. Title: "Signing certificate mismatch". Text: "Catalog preview is signed with a different certificate than the installed version. Installing it will most likely fail. Only continue if you trust this source." Then "Expected certificate hash" with key A, and "Downloaded certificate hash" with two lines, key A and then key B. Buttons: "Don't install" and "Install anyway". |
| Android, B2 | Not written down. After "Install anyway", the update installed over 0.2.0. |
| Obtainium, after B2 | "Certificate Hashes" with key A and then key B. |
| AppVerifier, B3 | "Internal Database Status: NOT FOUND", the package name, key A and then key B, and "Verification Status: UNKNOWN". After "Verify from clipboard" with the package name and key B's SHA-256 on two lines: "Verification Status: SUCCESS". |
| Android, B4 | First, because Obtainium was the installer of the app: "Update this app using Package installer?" "This app normally receives updates from Obtainium. By updating using a different source, you may receive future updates from any source on your phone. App functionality may change." Buttons: "Cancel" and "Update anyway". After "Update anyway": "App not installed", with the button "Close", and nothing more. |
| Android, B5 | The same as B4. |
| Obtainium, on mobile data | "Error 403 (https://api.github.com/repos/shkriuss/key-rehearsal/releases/assets/...)" and "Too many requests (rate limited) - try again in 46 minutes". It worked a few minutes later. |

The user guide uses these words in
[install.md](../user/install.md#when-the-signing-key-changes) and
[verify.md](../user/verify.md#after-a-new-signing-key).

## Open points

1. **A `rotate` action in the real ceremony.** A real rotation needs one.
   The ceremony's `create` refuses while a backup exists: "A backup
   already exists. This workflow never replaces a signing key." So
   `rotate` must also make the new key and back it up, and keep the old
   key's backup. In one job, it decrypts the old backup, makes the new
   key, and runs the commands of the step "Rotate and sign" in
   `rehearsal.yml`. Claude cannot see signing-ceremony, so you add it,
   before a real rotation
   ([ADR 0037](../adr/0037-signing-key-rotation.md)).
2. **The token's permissions.** The ceremony's notes ask for
   Environments and Secrets, read and write, and the rehearsal used both.
   GitHub's documentation names only Environments for the calls the
   ceremony makes. Whether Environments alone is enough was not tested.
3. **AppVerifier with the old key.** B3 tested only that the new key's
   SHA-256 gives "Verification Status: SUCCESS". Whether key A's SHA-256
   gives a failure on the rotated app was not tested.
4. **How often to run `check-backup.yml`**, beyond after each change of the
   backup.
