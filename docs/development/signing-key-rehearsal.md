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

## Where it runs

Parts 0 to C run in a new, public, throwaway repository, `key-rehearsal`.
You delete it at the end.

- It has its own environment `rehearsal`, set up like `release`: your
  approval, `main` only. Only a public repository can have that on GitHub
  Free or Pro.
- It holds a copy of the signing-ceremony workflow, pointed at
  `rehearsal`, and the rehearsal workflow
  [`rehearsal.yml`](signing-key-rehearsal/rehearsal.yml).
- Its token can reach nothing but `key-rehearsal`. So nothing in it can
  write to shkriuss.app, its `release` environment or signing-ceremony.
- It is public. Everything in it must be throwaway: the keys, the
  passphrase and the token.

Parts D and E run in signing-ceremony, with
[`check-backup.yml`](signing-key-rehearsal/check-backup.yml). They read
the real backup and change nothing.

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
install, Obtainium's warning and what AppVerifier shows.

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

### 3. Create the environment

1. In key-rehearsal, open **Settings**, then **Environments**, then
   **New environment**.
2. Type `rehearsal` and tap **Configure environment**.
3. Set it up as steps 3 to 7 of
   [The release environment](release.md#1-the-release-environment) say:
   required reviewer is you, **Prevent self-review** unticked,
   administrators may not bypass, deployment branch `main` only.
4. Add no secrets. The ceremony copy writes them.

What to look for: `rehearsal` is listed with "1 protection rule" or more,
and no secrets.

### 4. Make the token

The copy of the ceremony needs a credential to write the three secrets
into `rehearsal`. Make a new one that can do only that:

1. Open `github.com/settings/personal-access-tokens/new`.
2. **Token name**: `key-rehearsal`.
3. **Expiration**: **Custom**, 7 days from today.
4. **Resource owner**: you.
5. **Repository access**: **Only select repositories**, then
   `key-rehearsal` and nothing else.
6. **Permissions**, under **Repository permissions**:
   - **Environments**: **Read and write**. GitHub needs this to write an
     environment's secrets.
   - Everything else: **No access**. GitHub adds **Metadata: Read-only**
     to every token by itself.
7. Tap **Generate token**. GitHub shows it once.
8. Store it in key-rehearsal in the same way, and under the same name, as
   the real ceremony stores its own credential. For a repository secret:
   **Settings**, **Secrets and variables**, **Actions**, **New repository
   secret**.

If your ceremony uses another kind of credential, use the same kind in
the copy, with the same limits: only key-rehearsal, only environments.

If `generate` later fails because it cannot write the backup file, your
ceremony also commits files with this credential. Then edit the token and
add **Contents: Read and write**, still for key-rehearsal only.

You delete this token together with the repository, in part C. Never
paste it into a Claude session.

### 5. Copy the ceremony workflow

1. In signing-ceremony, open the workflow file. Tap the button that
   copies the raw file.
2. In key-rehearsal, tap **Add file**, then **Create new file**. Name it
   `.github/workflows/` and the same file name.
3. Paste. Change only:
   - the repository it writes to: `key-rehearsal` instead of
     `shkriuss.app`;
   - the environment: `rehearsal` instead of `release`;
   - the name of the credential, if you stored it under another name.
4. Tap **Commit changes**, and commit to `main`.

Optional, and a good idea: make the masking change of
[Open points](#open-points), point 1, in this copy now. Then the
rehearsal tests the change before the real ceremony gets it.

### 6. Add the rehearsal workflow

1. Open [`rehearsal.yml`](signing-key-rehearsal/rehearsal.yml) in
   shkriuss.app. Tap the button that copies the raw file.
2. In key-rehearsal, create the file `.github/workflows/rehearsal.yml`,
   paste, and commit to `main`.

### 7. Make a throwaway passphrase

Make a new passphrase for the throwaway backup, for example with your
password manager. Never use the real one, or one you use anywhere else.
The repository is public, and the copy may show what you type in its
logs.

### 8. Prepare the phone

Use the Pixel 9 Pro.

1. Open **Settings**, **Apps**. If **Catalog preview** is installed,
   uninstall it. The real Catalog stays.
2. Make sure Obtainium is version 1.6.16 or newer. Part B looks at a
   warning that came with that version.

## Part A: Restore

### A1. Make throwaway key A

1. In key-rehearsal, open **Actions** and the copy of the ceremony
   workflow. Tap **Run workflow**.
2. Pick the action `generate`. Type the throwaway passphrase. Tap
   **Run workflow**.
3. When it is green, open the throwaway `fingerprint.txt`, wherever the
   real ceremony puts it (`backup/fingerprint.txt` in signing-ceremony).
   Copy its SHA-256. It is public.

What to look for: a green run, and the throwaway backup and its
`fingerprint.txt`, in the same places as in the real ceremony.

### A2. Lose the key

1. Open **Settings**, **Environments**, `rehearsal`.
2. If `generate` wrote any secrets, delete each one.

What to look for: no secrets in `rehearsal`.

### A3. Restore it

1. Run the copy again, with the action `restore` and the throwaway
   passphrase.

What to look for: a green run. In `rehearsal`, three secrets,
`SIGNING_KEYSTORE_B64`, `SIGNING_KEYSTORE_PASSWORD` and
`SIGNING_KEY_ALIAS`, each updated just now.

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

### A6. Check it with AppVerifier

1. Open AppVerifier and tap **Catalog preview**.

What to look for: one SHA-256, the one from A1.

## Part B: Rotate

### B1. Rotate from key A to key B

1. Open **Actions**, **Rehearsal**, **Run workflow**.
2. **action**: `rotate`. **old_fingerprint**: the SHA-256 from A1.
3. Approve **Rotate A to B** as in A4.

What to look for: all jobs green. The summary's "Part B":

- shows three different keys: A, B and C;
- says "All three APKs: scheme v3, no v3.1 block, one signer";
- shows the rotated APK's lineage with two certificates, A first, then B;
- shows A's rights as `true false false false false`. That means key A
  may hand over the installed app and its data, and nothing else.

Keys B and C were made in the job and are gone.

### B2. Update with Obtainium

1. Publish the draft `v0.3.0-preview`, as in A5.
2. In Obtainium, pull the list down to check for updates. Tap **Catalog
   preview**, then **Update**.
3. Obtainium should warn that the signing certificate changed. **Write
   down its exact words.** Then go on.
4. Android asks whether to update the app. Allow it.

What to look for: an update, not a new install. The app opens. Write down
anything else Obtainium or Android shows.

### B3. Check it with AppVerifier

1. Open AppVerifier and tap **Catalog preview**.
2. Copy two lines into a note: `app.shkriuss.catalog.preview`, then key
   B's SHA-256 from the summary of B1. Paste them into AppVerifier.

What to look for: two SHA-256 lines, A first and B last. The pasted text
matches. Write down what AppVerifier shows.

### B4. Try the old key alone

1. Open the run of B1. Under **Artifacts**, tap
   `catalog-preview-0.3.0-preview-old-key-only.apk`.
2. Open the download and tap **Install**, or **Update**.

What to look for: Android refuses it. **Write down its exact words**, for
example "App not installed as package conflicts with an existing package."
This shows that once a phone has the rotated app, the old key alone can no
longer update it.

### B5. Try the thief's lineage

1. Do the same with `catalog-preview-0.3.0-preview-thief.apk`.

What to look for: Android refuses it too. Write down its words. This
shows that someone who holds the old key cannot take over a phone that
already has the rotated app, even with a lineage of their own.

## Part C: Clean up

Do all of these in one sitting.

1. Uninstall **Catalog preview** in **Settings**, **Apps**.
2. In Obtainium, remove Catalog preview.
3. In **Files**, delete the APKs you downloaded.
4. Delete the token: open `github.com/settings/personal-access-tokens`,
   tap `key-rehearsal`, then **Delete**.
5. Delete the repository: in key-rehearsal, open **Settings**, scroll to
   the bottom, tap **Delete this repository** and follow the steps. This
   deletes its secrets, runs, artifacts and releases.
6. Forget the throwaway passphrase.

What to look for: the token and the repository are gone.

## Part D: Check the real backup

This is the only part that touches the real backup. It writes no secret,
has no token that can write, and prints only names, sizes, SHA-256 values
and the certificate's public fingerprint.

The cost: like every restore, the real key is in the memory of a GitHub
runner while the check runs. It is never written to the runner's disk.
GitHub keeps the passphrase you type with the run, so you delete the runs
at the end.

How it keeps the secrets out of the log:

- GitHub prints a step's script and its `env:` values in the log. So the
  check never puts the passphrase in either. It reads the passphrase from
  the run's event file, and masks it before it does anything else.
- It masks the keystore password the moment it reads it, before any use.

### D1. Add the check

1. Open [`check-backup.yml`](signing-key-rehearsal/check-backup.yml) in
   shkriuss.app. Copy the raw file.
2. In signing-ceremony, create `.github/workflows/check-backup.yml`, paste
   it and commit to `main`.

### D2. List the files in the backup

1. Open **Actions**, **Check backup**, **Run workflow**.
2. **mode**: `list`. **passphrase**: the real passphrase. Leave the
   file names empty.
3. Tap **Run workflow**, and open the run.

What to look for: a green run. The summary lists the SHA-256 of
`backup/signing-key.tar.gpg`, and the size and name of each file in the
backup. The log shows no passphrase anywhere. Note the name of the
keystore file and of the file with its password.

### D3. Check the key

1. Run it again. **mode**: `check`. Type the passphrase, and the two
   names exactly as D2 showed them.

What to look for: every line of the summary says **Yes**:

- the passphrase opens the backup;
- one certificate, alias `shkriuss`;
- its private key belongs to the certificate;
- the same as the current line of
  [fingerprints.md](../security/fingerprints.md);
- the same as `backup/fingerprint.txt`.

If any line says **No**, change nothing. Tell Claude in a session what
the summary says, never the passphrase.

### D4. Delete the runs

1. Open each run of **Check backup**, tap the menu at the top right and
   **Delete workflow run**.
2. Only after D3 passed: do the same for every earlier run of the real
   ceremony workflow in which you typed the passphrase.

What to look for: no run is left that you typed the passphrase into.

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

Fill this in on GitHub (tap the pencil on this page), or tell Claude in a
session with the prompt in
[PROMPTS.md](PROMPTS.md#27-restore-and-rotation-rehearsal).

| Part | Date | Result | Notes |
|---|---|---|---|
| 0 Set up |  |  |  |
| A Restore |  |  |  |
| B Rotate |  |  |  |
| C Clean up |  |  |  |
| D The real backup |  |  |  |
| E The two copies |  |  |  |

The exact words, for the user guide:

| Where | What it showed |
|---|---|
| Obtainium, B2 |  |
| Android, B2 |  |
| AppVerifier, B3 |  |
| Android, B4 |  |
| Android, B5 |  |

## Open points

1. **The real ceremony shows the typed passphrase.** Mask it. Do not move
   it into a secret: then it would sit on GitHub next to the backup, and
   ADR 0013, point 10, says only you hold it. The lines to change, in the
   step that decrypts the backup:
   - Delete every line that gives the passphrase input to the step: an
     `env:` line such as `PASSPHRASE: ${{ inputs.passphrase }}`, and any
     `${{ inputs.passphrase }}` in the `run:` text. Use your input's name
     in place of `passphrase`.
   - Put these lines at the very top of the `run:` text. Then use
     `$passphrase` where the step used the old variable. Give it to gpg
     through standard input, never as an argument on the command line.

     ```bash
     mask() {
       local value="$1"
       value="${value//'%'/%25}"
       value="${value//$'\r'/%0D}"
       value="${value//$'\n'/%0A}"
       printf '::add-mask::%s\n' "$value"
     }
     passphrase="$(jq -r '.inputs.passphrase // ""' "$GITHUB_EVENT_PATH")"
     if [ -n "$passphrase" ]; then mask "$passphrase"; fi
     ```

   - If the step reads the keystore password from the backup, call `mask`
     on it as soon as it is read.
2. **A `rotate` action in the real ceremony.** A real rotation needs one.
   It decrypts the old and the new backup in one job and runs the
   commands of the step "Rotate and sign" in `rehearsal.yml`. Claude cannot
   see signing-ceremony, so you add it, before a real rotation
   ([ADR 0037](../adr/0037-signing-key-rotation.md)).
3. **How often to run `check-backup.yml`**, beyond after each change of the
   backup.
4. **The user guide.** [verify.md](../user/verify.md) and
   [install.md](../user/install.md) get the words from the results table
   after the rehearsal, not before.
