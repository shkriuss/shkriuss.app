# Threat model

What the suite protects, against whom, what stops each attacker and what
does not. It ends with the OWASP MASVS controls and every open question.

- Status: written on 2026-11-13, in Phase 1, step 1.8
  ([PROMPTS.md](../development/PROMPTS.md#18-threat-model)).
- Sources: section 10 of the [plan](../plan/PLAN.md#10-security-and-privacy),
  [crypto-design.md](crypto-design.md), and the decision records in
  [docs/adr](../adr/README.md).
- This page adds no decision of its own. It says what other pages
  decided, and where. The owner's decisions on this page are under
  [Decided on pull request 30](#decided-on-pull-request-30). Where
  nothing is decided, it says **Open**. Every open point is listed at
  the [end](#open-questions).
- What exists today: Catalog and the core modules
  ([modules.md](../architecture/modules.md)). No data app is released.
  There is no Sync app and no sync server yet. Where this page speaks of
  sync, of the handover between apps, or of a data app, it describes
  what is decided for them, not what is built.

## At a glance

| Attacker | What stops it | What does not |
|---|---|---|
| [A lost or stolen phone](#a-lost-or-stolen-phone) | Android's file-based encryption, keys in the phone's hardware, the optional app lock | All of it rests on the screen lock. Notification text on the lock screen while the app lock is off. |
| [Other apps on the phone](#other-apps-on-the-phone) | The app sandbox, nothing exported, keys per app | A malicious keyboard or accessibility service (out of scope) |
| [A network attacker](#a-network-attacker) | Data apps have no network permission. Everything synced is sealed. | Traffic analysis (out of scope). The Sync app's network settings are Open. |
| [A compromised or curious sync server](#a-compromised-or-curious-sync-server) | It holds only ciphertext. A changed blob does not open. | Sizes, counts, timing and the key ID. Replay and withholding wait for Phase 5. |
| [Malicious dependencies or CI actions](#malicious-dependencies-or-ci-actions) | Dependency verification, pinned GitHub actions, secrets in one step, reproducible builds | Trust on first use. A harmful release signed by its real publisher. No scan for known vulnerabilities. |
| [Takeover of GitHub, Cloudflare or the domain](#takeover-of-github-cloudflare-or-the-domain) | The owner's approval, narrow tokens, the fingerprint in more than one place | A takeover of the owner's GitHub account can sign a release with the suite key. |
| [Unsafe changes by an AI agent](#unsafe-changes-by-an-ai-agent) | Write access only, the owner's review, owner-only build checks | For most code, the owner's review is the only gate. |

[Out of scope](#out-of-scope): a compromised operating system, an
unlocked phone in an attacker's hands, a malicious keyboard or
accessibility service, coercion, and traffic analysis of sync timing and
sizes.

## What is protected

Section 10 of the plan names five things.

### Records and files

1. **Records**, such as reminders, notes and amounts, are rows in each
   app's Room database. Android's file-based encryption protects them.
   The app adds no encryption of its own
   ([ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)).
2. **Files and attachments** are encrypted. Each file content has its own
   random key. The key is stored, wrapped, in the file's row
   ([crypto-design.md](crypto-design.md#file-keys)).
3. **Backups** are one encrypted stream under the app's `backup` key
   ([ADR 0008](../adr/0008-backup-file-format.md)).
4. **Synced data** will be sealed records and the same encrypted file
   streams ([ADR 0009](../adr/0009-sync-protocol-and-server.md), Phase 5).
5. Data about the data also counts: the text of notifications, the times
   of reminders, and how large things are.

### The recovery key

1. 32 random bytes, shown as 24 words. It is the account. Every key for
   backup and sync derives from it
   ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md)).
2. The paper copy is the backup. An app may keep a copy on the phone,
   wrapped by its Recovery guard, which needs the system prompt for every
   single use ([crypto-design.md](crypto-design.md#the-recovery-key)).
3. The key is never in a log, a notification, a backup file, Android's
   own backup, a sealed record or the clipboard
   ([crypto-design.md](crypto-design.md#screens-that-show-or-take-the-words)).

#### What the 24 words open

1. Whoever has the words and a backup file can open that backup, of any
   app of the suite: every record and every file in it.
2. Whoever has the words and the data on the sync server can open all of
   it, of every app.
3. There is no password on top of the words
   ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md)).
   Nothing else is asked.
4. The words alone open nothing on a locked phone. They are not the
   phone's screen lock.
5. A new recovery key cannot take back what the old one could already
   open ([crypto-design.md](crypto-design.md#a-new-recovery-key)).
6. Open: whether the words alone let someone add a device to the sync
   server. That belongs to the sync design (Phase 5).

So the paper is worth as much as all the data. The user guide says the
same: "Whoever has the words can read your backups and your synced data"
([recovery-key.md](../user/recovery-key.md#what-it-is)).

### Device keys

1. Each installed app has its own hardware keys in the Android Keystore,
   in StrongBox where the phone has it: the Background key, the Unlocked
   key, the Lock key and the Recovery guard
   ([crypto-design.md](crypto-design.md#hardware-keys)). They cannot be
   read out, not even by the app.
2. They wrap the app's keysets, which are stored as files in the app's
   no-backup folder ([crypto-design.md](crypto-design.md#where-keys-are-stored)).
3. Later, each device gets a sync signing key that cannot leave it
   ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md)). Its
   design is Open (crypto-design.md, open question 7, Phase 5).

### The signing key

1. One key signs every app of the suite: RSA 4096, `CN=shkriuss.app`
   ([ADR 0013](../adr/0013-signing-key-custody-and-rotation.md)).
2. Android installs an update only if it is signed with the same key. So
   an APK signed with this key installs as an update over any app of the
   suite.
3. It is kept as three secrets in the GitHub `release` environment. Only
   the Sign job of the release workflow reads them, after the owner
   approves.
4. An encrypted copy is in the owner's private `signing-ceremony`
   repository, and the owner keeps two more copies outside GitHub
   (ADR 0013, point 10).

### The release pipeline

1. The workflows that build, check, sign and publish
   ([ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md),
   [release.md](../development/release.md),
   [ci.md](../development/ci.md)).
2. The repository rules that guard `main` and tags
   ([working-with-claude.md](../development/working-with-claude.md#rules-that-enforce-this)).
3. The fingerprint in [fingerprints.md](fingerprints.md). The release
   checks every APK against it, and users compare their apps with it.
4. The hub site, which shows the fingerprint
   ([ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md)).
5. The files that pin every download of the build
   ([ADR 0020](../adr/0020-dependency-verification.md)).

## What the design trusts

The promises on this page hold only while these hold.

1. **Android and GrapheneOS.** The app sandbox, file-based encryption,
   the Keystore and the system prompt work as Android's reference says
   ([crypto-design.md](crypto-design.md#assumptions), assumption 11).
2. **The phone's key hardware.** StrongBox or the trusted execution
   environment keeps keys inside. A phone with a software-only Keystore
   is allowed, and its security screen says so
   ([crypto-design.md](crypto-design.md#strongbox-and-other-hardware)).
3. **Tink**, the only cryptography library
   ([crypto-design.md](crypto-design.md#the-library)).
4. **The phone's screen lock.** File-based encryption and the system
   prompt rest on it. The prompt takes the PIN, pattern or password as
   well as a fingerprint
   ([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)).
5. **The user's paper copy** of the 24 words.
6. **GitHub.** It hosts the code, runs the workflows on its own runners,
   makes the actions they use, and keeps the secrets. The JDK and the
   Android SDK come from its runner image
   ([ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md)).
7. **The owner**, who reviews every pull request and approves every
   release.

## Attackers

The seven attackers of plan section 10. For each: what stops it, what
does not, and what is Open.

### A lost or stolen phone

Someone has the phone, and it is locked. An unlocked phone in an
attacker's hands is [out of scope](#out-of-scope).

What stops it:

1. Android's file-based encryption. Each app keeps everything in
   credential-encrypted storage. After a restart, no part of an app runs
   until the first unlock
   ([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md),
   [crypto-design.md](crypto-design.md#where-keys-are-stored), point 3).
2. Hardware keys. Every keyset is wrapped by a key inside the Keystore,
   in StrongBox where the phone has it.
3. On Android 15 and later, the Unlocked key refuses to work while the
   phone is locked. It wraps `backup`, and `file-key` while the app lock
   is off.
4. With the app lock on, every file key needs the system prompt
   ([The app lock](#the-app-lock)).
5. A kept recovery key always needs the system prompt, with the app lock
   on or off.
6. Android's own backup and device transfer are off. crypto-design.md
   asks this of every app ("Where keys are stored", point 1). Catalog,
   the only app today, turns both off.

What does not:

1. All of it rests on the screen lock. A thief who knows or guesses the
   PIN, pattern or password has an unlocked phone, and the system prompt
   takes the same PIN.
2. With the app lock off, a notification's text shows on the lock screen
   if the phone's Android setting allows it
   ([reminders.md](../user/reminders.md#allow-notifications)). With the
   app lock on, the text is hidden
   ([notifications.md](../architecture/notifications.md#while-the-app-lock-is-on)).
3. A phone with a software-only Keystore has no hardware to keep the
   keys in.
4. On Android 13 and 14 there is no Unlocked key. `backup`, and
   `file-key` while the app lock is off, sit under the Background key,
   which works while the phone is locked. This matters only against
   someone who breaks Android on a phone that was unlocked once since it
   started ([crypto-design.md](crypto-design.md#android-13-and-14)).
5. On a phone that was unlocked once since it started, Android holds the
   keys of its file-based encryption. Someone who can break Android then
   can read the rows. A compromised operating system is
   [out of scope](#out-of-scope).

### Other apps on the phone

A harmful app is installed next to the suite.

What stops it:

1. The app sandbox. Another app cannot read the suite's private storage.
2. Each app has its own hardware keys, and its own keys derived from the
   recovery key. One app cannot compute the keys of another
   ([crypto-design.md](crypto-design.md#deriving-keys)).
3. Nothing is exported except each app's launcher screen. The alarm
   receivers and the security screens are not exported. The screen-off
   receiver is registered as not exported. A tap on a notification opens
   only the same app, through an explicit, immutable intent
   ([permissions.md](permissions.md)).
4. There is no content provider of our own, no file provider and no deep
   link.
5. Files enter and leave only through the system pickers. No app of the
   suite has a storage permission
   ([permissions.md](permissions.md#rules)).
6. The screens that show or take the words block screenshots, screen
   recording and the recent-apps picture. They turn off autofill and
   keyboard learning, and never use the clipboard
   ([security-screens.md](../architecture/security-screens.md#what-protects-the-words)).
7. Apps of the suite are to share keys and data only through screens and
   interfaces that only apps signed with the suite key can open: the
   handover between apps (step 3.0) and the courier interface of sync
   ([ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)).
   Neither is built.

What does not:

1. A malicious keyboard or accessibility service. It sees what the user
   types and what the screen shows. It is [out of scope](#out-of-scope).
2. An app that the user gives notification access reads the text of
   every notification, unless the app lock hides it.
3. An app that the user lets record the screen captures every screen
   except the word screens, unless the user turns on "Hide in recent apps
   and block screenshots"
   ([app-lock.md](../user/app-lock.md#recent-apps-and-screenshots)).
4. A preview build makes the same keys as its app from the same words.
   The owner accepted this. Testers must never type real words into a
   preview ([crypto-design.md](crypto-design.md#decided-on-pull-request-22)).
5. The signature-protected interfaces trust every app signed with the
   suite key. Whoever has that key can build an app that passes them
   ([The owner's GitHub account](#the-owners-github-account)).

Open:

- The handover: its screen, its signature permission and what it checks
  (crypto-design.md, open questions 1 and 2, step 3.0).
- The courier interface (ADR 0005, Phase 5).

### A network attacker

Someone watches or changes traffic on its way.

What stops it:

1. Data apps have no network permission
   ([ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)). The
   APK rules check fails the build of an app that asks for a permission
   it is not allowed, and today no app is allowed any
   ([permissions.md](permissions.md#rules)). So a data app sends nothing.
2. Only the Sync app will talk to the network. It will move only sealed
   records and encrypted files, which it cannot open
   ([ADR 0009](../adr/0009-sync-protocol-and-server.md)). A blob that is
   changed, cut or swapped does not open
   ([crypto-design.md](crypto-design.md#associated-data)).
3. Apps come from GitHub Releases over HTTPS, through Obtainium
   ([ADR 0015](../adr/0015-distribution-channels.md)). Android installs
   an update only if it has the same signing key as the installed app
   ([install.md](../user/install.md#updates)). Users check the first
   install with AppVerifier ([verify.md](../user/verify.md)).
4. The hub site is served over HTTPS and sends HSTS
   ([site.md](../development/site.md#security-headers)).

What does not:

1. Traffic analysis of sync timing and sizes. It is
   [out of scope](#out-of-scope).
2. A user who installs from somewhere else and skips the check with
   AppVerifier.

Open: the Sync app's network settings, and whether it pins the server's
identity (Phase 5). See [Network](#network) under MASVS.

### A compromised or curious sync server

Each user runs the sync server in their own Cloudflare account (plan
section 7). Whoever controls that server or that account, Cloudflare
included, is this attacker
([ADR 0009](../adr/0009-sync-protocol-and-server.md)). Nothing of sync is
built yet.

What stops it:

1. The server stores only ciphertext. The keys come from the recovery
   key, which never leaves the user's devices and paper.
2. A blob that is changed, cut, moved to another record or read as
   another kind does not open
   ([crypto-design.md](crypto-design.md#associated-data)).
3. Conflicts are resolved on the devices, not on the server.

What does not:

1. What the server can still learn. See
   [below](#what-the-sync-server-and-the-network-can-still-learn).
2. Replay and withholding. It can hand out an old sealed record again, or
   hold one back. Both are valid blobs
   ([crypto-design.md](crypto-design.md#what-the-design-protects)).
3. Reordering, and deleting everything. The apps are local-first, so
   each device keeps its own copy. Backups are separate files.
4. Filling a phone's storage. File ciphertext that arrives while an app
   is locked is stored unchecked until the file is opened
   (crypto-design.md, open question 9).

Open: the protocol, a hostile server, replay and reordering, lost and
revoked devices (ADR 0009, Phase 5, step 1).

### Malicious dependencies or CI actions

#### A harmful library inside an app

A library runs inside the app, with the app's rights.

What it can reach:

1. That app's rows, files and derived keys.
2. The recovery key, while it is in that app's memory: while it is
   created, entered or shown, and while all 24 words are entered to turn
   on the app lock ([crypto-design.md](crypto-design.md#keys-in-memory)).
   With the recovery key it could make the keys of every app.
3. Anything else the app's own code can do.

What limits it:

1. A data app has no network permission. The library cannot send
   anything over the network from it.
2. It cannot read the kept recovery key without a system prompt, which
   the user sees.
3. It cannot reach another app's storage or hardware keys.
4. Every new dependency needs a decision record (hard rule 5 in
   [CLAUDE.md](../../CLAUDE.md)). Tink is the only cryptography library.
5. The APK rules check fails an APK with native libraries, with classes
   of Google Play services, or with a permission that is not allowed
   ([build.md](../development/build.md#apk-rules-check)).

#### A harmful download or action in the build

What stops it:

1. Gradle checks every downloaded file against a committed SHA-256 value
   and PGP signature, with a committed keyring and no key server
   ([ADR 0020](../adr/0020-dependency-verification.md)).
2. Only Google's Maven repository and Maven Central. No module may add a
   repository ([build.md](../development/build.md#repositories)).
3. The Gradle wrapper is pinned by checksum, and CI checks the wrapper
   jar ([ci.md](../development/ci.md#job-gradle-wrapper)).
4. Workflows use only GitHub's own actions, pinned to full commit SHAs.
   Tokens are read-only by default
   ([ci.md](../development/ci.md#rules-every-workflow-follows)).
5. Secrets reach exactly two steps: signing a release and deploying the
   site. The Sign job runs no code of the project
   ([ADR 0013](../adr/0013-signing-key-custody-and-rotation.md),
   point 13).
6. The release uses no cache. A second build on a new runner must give
   the same bytes. The signed APK gets a build attestation
   ([ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md)).
7. Wrangler, which deploys the site, is pinned with a lockfile and
   SHA-512 values, and installed without its install scripts
   ([ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md)).
8. The verification files, the wrapper, the workflows and the build
   checks are owner-only paths
   ([CODEOWNERS](../../.github/CODEOWNERS)).

What does not:

1. Trust on first use. The checksums and keys were taken from what the
   servers gave on 2026-11-10. Except for one key, nothing was checked by
   hand ([build.md](../development/build.md#where-trust-comes-from)).
2. Gradle trusts a key for a whole Maven group where it can. A new
   version in that group, signed by the same key, is then trusted
   without a new entry.
3. A harmful release that its real publisher signed passes every check.
4. The second build catches a build that differs. It cannot catch a
   harmful input that both builds share.
5. The JDK, the Android SDK and Python come from GitHub's runner image,
   which is not pinned (ADR 0014,
   [ADR 0022](../adr/0022-hub-site-generator.md)). The emulator and its
   system images are not pinned either
   ([ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md)).
6. The Sign job installs the build tools with `sdkmanager`, pinned by
   version only, and runs their `apksigner` with the key.
7. Nothing scans the dependencies for known vulnerabilities. Updates come
   from a monthly prompt (R5 in
   [PROMPTS.md](../development/PROMPTS.md)). Open (plan section 17).

### Takeover of GitHub, Cloudflare or the domain

#### The owner's GitHub account

The owner's account administers the repository and everything GitHub
holds for it.

What a takeover can do:

1. **Sign a release with the suite key.** The account can start the
   release workflow and approve its Sign job. "Prevent self-review" is
   off, because the owner starts and approves every release
   ([ADR 0013](../adr/0013-signing-key-custody-and-rotation.md),
   point 16).
2. **Take the key itself.** It can merge a change to `release.yml` that
   writes the key out. GitHub hides a secret in a log, but not a secret
   that a step writes to a file, an artifact or another program
   (ADR 0013). After that it can sign anything, anywhere, and leave no
   trace on GitHub.
3. **Merge anything to `main`**, and publish releases.
4. **Change the fingerprint in all three places**: fingerprints.md, the
   notes of new releases, and the hub site, which deploys from `main` by
   itself ([site.md](../development/site.md#4-the-environment)).
   Comparing the three places does not help then
   ([verify.md](../user/verify.md#check-in-more-than-one-place)).
5. **Reach every installed app.** An APK signed with the suite key
   installs as an update over the real app, and gets all of its data and
   keys. AppVerifier shows the right fingerprint for it. Such an update
   can ask for any permission: the APK rules check runs only on builds
   of this repository.
6. **Download the encrypted copy of the key** from `signing-ceremony`.
   Its passphrase is only with the owner (ADR 0013, point 10).

What limits it, and no more than this:

1. Nothing stops the takeover itself. How the owner's account is
   protected, for example by a second factor, is not documented. Open.
2. Releases that are already published are immutable. Their files and
   tags cannot be changed
   ([release.md](../development/release.md#2-immutable-releases)). A
   takeover can only add new releases.
3. A release made by the workflow leaves a public trace: a commit on
   `main`, a workflow run, and a build attestation that names both.
   Anyone can rebuild that commit and compare the bytes
   ([ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md)).
4. An APK signed outside the workflow has no build attestation. Users are
   not told to check attestations. So this limits only someone who looks.
5. With a key of its own, a takeover can reach only new installs.
   Android refuses an update signed with another key.
6. Open: what to do if the key is stolen. A key rotation needs its own
   decision record, which is not written yet (ADR 0013).

#### Claude's machine account

What stops it:

1. It has write access only. It cannot merge without the owner, create
   tags, read secrets or change settings
   ([working-with-claude.md](../development/working-with-claude.md#claude)).
2. `main` needs a pull request with an approval, and approval of the
   latest push.
3. Every job of the release workflow checks that the owner started the
   run. A release run that this account starts fails
   ([release.md](../development/release.md#run-a-release)).
4. The owner publishes only the draft that a release run of their own
   just made ([release.md](../development/release.md#check-and-publish-the-draft)).

What does not:

1. It can push branches with workflow files, which then run without
   secrets
   ([working-with-claude.md](../development/working-with-claude.md#what-the-machine-account-can-still-do)).
2. It can start workflows on `main` and create draft releases.
3. It can remove the protected-paths label, and edit or delete its
   comment ([protected-paths.md](protected-paths.md#what-it-does-not-protect-against)).
4. Preview APKs are built from code that nobody has reviewed. The safety
   rule says to install previews only from pull requests that the owner
   or this account opened
   ([test-a-pull-request.md](../development/test-a-pull-request.md#safety)).
   A taken-over account could put anything into one.

The account is `shkriuss-bot`. It has worked since Phase 0
([working-with-claude.md](../development/working-with-claude.md#claude)).

#### The Cloudflare account

The owner's Cloudflare account serves the hub site. A user's own sync
server is the attacker
[above](#a-compromised-or-curious-sync-server).

What stops it:

1. No code of ours runs there. The Worker serves static files only
   ([ADR 0023](../adr/0023-hub-site-hosting-and-deploy.md)).
2. The deploy token reaches one Worker, with no permission on the
   domain's zone ([site.md](../development/site.md#3-the-token)).
3. Apps are never downloaded from Cloudflare. Obtainium takes them from
   GitHub ([install.md](../user/install.md)).
4. The fingerprint is also on GitHub. A changed site would not agree
   with it ([verify.md](../user/verify.md#check-in-more-than-one-place)).

What does not:

1. A takeover of the whole account can change the site and the domain's
   settings.
2. A user who checks only the site would trust a wrong fingerprint.
3. How the account is protected is not documented. Open.

#### The domain

`shkriuss.app` points to the hub site.

What stops it:

1. The site sends HSTS for two years, also for subdomains
   ([site.md](../development/site.md#security-headers)).
2. Obtainium and the releases use `github.com`, not the domain.
3. The fingerprint is also on GitHub.

What does not:

1. Whoever controls the domain can point it at a site of their own, with
   a wrong fingerprint.
2. Open: the registrar lock, DNSSEC and CAA records are not documented.

### Unsafe changes by an AI agent

Claude writes most of the code. A change can be unsafe because Claude
made a mistake, or because text it read misled it. The controls are the
same.

What stops it:

1. The hard rules in [CLAUDE.md](../../CLAUDE.md) and the rules in
   `.claude/rules/`. They are instructions. They enforce nothing by
   themselves.
2. Claude works through the machine account above, from a cloud
   environment that holds no secrets
   ([cloud-environment.md](../development/cloud-environment.md)).
3. The owner reviews and approves every pull request. The required checks
   "Gradle wrapper" and "Check" must pass
   ([ci.md](../development/ci.md#required-checks)).
4. Owner-only paths ([CODEOWNERS](../../.github/CODEOWNERS)), and the
   [protected-paths flag](protected-paths.md), which marks a pull request
   that changes one.
5. Owner-only build checks enforce hard rules 2, 3 and 4 (the APK rules
   check), the record rules (the schema and DAO checks), and that every
   instrumented test runs ([build.md](../development/build.md)).
6. Dependency verification fails a build that downloads a file it does
   not know.
7. Preview builds use a throwaway key and their own application ID, so
   they never replace a real app
   ([ci.md](../development/ci.md#pr-preview)).
8. Prompt R2 asks a separate session for a strict review
   ([PROMPTS.md](../development/PROMPTS.md#r2-independent-review)).

What does not:

1. The flag gives notice only. It never blocks a merge, and it lists ten
   limits of its own
   ([protected-paths.md](protected-paths.md#what-it-does-not-protect-against)).
2. Code outside the owner-only paths is not flagged: app code,
   `build.gradle.kts` files, the version catalog, `tools/`, `site/` and
   `docs/`.
3. Some hard rules are kept by review only. No build check refuses a
   WebView or runtime code loading (hard rule 1), checks that an app
   turns Android's own backup off, or finds logging of user content
   outside `core/crypto`.
4. A pull request's own copy of `ci.yml` and `pr-preview.yml` runs before
   anyone reviews it, without secrets
   ([ci.md](../development/ci.md#what-a-pull-request-can-do-in-these-workflows)).
5. The emulator jobs are not required checks
   ([ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md)).

## Out of scope

Plan section 10 puts five things out of scope. Out of scope means the
design makes no promise against them. Where no page gives a reason, the
reason below is the plain technical one.

1. **A compromised operating system.** The operating system holds the
   keys, shows the system prompt and sees each app's memory. No app can
   protect itself from the system it runs on. The handover between apps
   relies on this too
   ([crypto-design.md](crypto-design.md#setting-up-a-second-app-on-the-same-phone)).
   GrapheneOS lowers the chance. Each release is checked with its
   hardening on
   ([release-checklist.md](../development/release-checklist.md#part-1-grapheneos-on-the-pixel-9-pro)).
2. **An unlocked phone in an attacker's hands.** To Android, whoever
   holds the unlocked phone is its user. It cannot tell them apart. See
   [How the optional app lock fits](#how-the-optional-app-lock-fits).
3. **A malicious keyboard or accessibility service.** The user gives it
   the right to see what is typed and what the screen shows. The word
   field asks the keyboard not to learn, but a harmful keyboard can
   ignore that
   ([security-screens.md](../architecture/security-screens.md#what-protects-the-words)).
4. **Coercion.** No software can tell a forced unlock from a willing
   one. The app lock guide says so
   ([app-lock.md](../user/app-lock.md#what-it-protects-and-what-it-does-not)).
5. **Traffic analysis of sync timing and sizes**
   ([ADR 0009](../adr/0009-sync-protocol-and-server.md)). Hiding them
   would need padding and dummy traffic. The design has neither, and the
   plan does not ask for them.

Limits that other pages decided:

1. **Database rows at rest, beyond Android's file-based encryption.**
   SQLCipher was rejected because it is a C library loaded through JNI.
   The app lock is an access gate for rows, not encryption
   ([ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)).
2. **Sizes, counts and timing** of what is stored and synced
   ([crypto-design.md](crypto-design.md#what-the-design-protects)).

Replay and withholding by the sync server are not out of scope. They
wait for the sync design (Phase 5).

### How the optional app lock fits

"An unlocked phone in an attacker's hands" is out of scope, and the app
lock is optional. This is how the two fit. Other sections link here and
promise nothing more.

1. The design makes no promise for an unlocked phone. With the app lock
   off, nothing in the app asks anyone for anything.
2. If the user turns the app lock on, it narrows what this app shows to
   someone who holds the unlocked phone:
   - its files need the system prompt,
   - its screens are not drawn until the prompt is answered,
   - its own settings need the prompt each time.
3. It does not bring the case into scope:
   - anyone who knows the phone's PIN, pattern or password answers the
     prompt,
   - records are only hidden, not encrypted,
   - with a timer, the app can stay unlocked for a while after the user
     leaves it ([app-lock.md](../user/app-lock.md#when-the-app-locks)),
   - a compromised operating system, or coercion, gets past it.
4. So the app lock is an extra, not a promise. What it does and does not
   do is listed under [The app lock](#the-app-lock).

## The app lock

The app lock is optional, set per app, and off until the user turns it
on. The first app with it will be Water
([app-lock.md](../user/app-lock.md)). The design is in
[crypto-design.md](crypto-design.md#the-app-lock) and
[security-screens.md](../architecture/security-screens.md#the-app-lock).

What it protects:

1. **Files and attachments.** With the app lock on, the `file-key`
   keyset is wrapped by the Lock key, which works for one operation per
   system prompt. So every file key needs the prompt
   ([crypto-design.md](crypto-design.md#what-the-prompt-guards)).
2. **The screens.** While the app is locked, a screen's content is not
   composed. Nothing of it is drawn, and TalkBack cannot reach it
   ([security-screens.md](../architecture/security-screens.md#the-gate)).
3. **The recent-apps picture.** While the app lock is on, the app shows
   blank there.
4. **Notification text.** While the app lock is on, a notification shows
   only its kind and a fixed text, unless the user turns on "Show the
   text in notifications"
   ([notifications.md](../architecture/notifications.md#while-the-app-lock-is-on)).
5. **Its own settings.** The app lock screen asks for the prompt each
   time it opens. Whoever is handed the open app cannot turn the lock
   off, choose a longer time, or show the text of notifications
   ([security-screens.md](../architecture/security-screens.md#the-app-lock-screen)).

What it does not protect:

1. **Records.** The app lock does not encrypt rows. It only hides them
   ([ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md)).
2. **The `record` and `backup` keysets.** They need no prompt. Sync,
   reminders, and a backup that the user started before leaving, go on
   while the app is locked
   ([crypto-design.md](crypto-design.md#what-works-while-an-app-is-locked)).
3. **Against anyone who knows the phone's PIN, pattern or password.**
   The prompt takes it
   ([ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md)).
4. **The timer case.** With a timer, if the user switches to another app,
   turns the screen off, and the phone is used again before the time is
   up, the app may still be unlocked
   ([security-screens.md](../architecture/security-screens.md#when-the-app-locks)).
5. **Keys in memory.** An app that waits in the background with a timer
   keeps `file-key` in memory until it comes back or locks
   ([crypto-design.md](crypto-design.md#keys-in-memory), point 5).
6. **Screenshots and screen recording** of the unlocked app, unless
   "Hide in recent apps and block screenshots" is on. It is off by
   default ([app-lock.md](../user/app-lock.md#recent-apps-and-screenshots)).
7. **A compromised operating system, and coercion**
   ([app-lock.md](../user/app-lock.md#what-it-protects-and-what-it-does-not)).
8. **Files after the screen lock is removed, if the words are lost too.**
   Removing the screen lock deletes the Lock key. Then only the words
   open the app's files on this phone. The owner accepted this case
   ([crypto-design.md](crypto-design.md#no-phone-setting-destroys-files)).

Also:

- The recovery-key screens are not behind the gate. They protect
  themselves: the window blocks capture, and showing the words needs its
  own prompt
  ([security-screens.md](../architecture/security-screens.md#the-gate)).
- Open: a check that every screen of an app puts its content behind the
  gate. Step 2.2 builds it
  ([security-screens.md](../architecture/security-screens.md#open)).

How this fits with an unlocked phone in an attacker's hands:
[How the optional app lock fits](#how-the-optional-app-lock-fits).

## What the sync server and the network can still learn

Nothing of sync is built. This section says what follows from the
formats that are fixed, and what the sync design still has to decide
([ADR 0009](../adr/0009-sync-protocol-and-server.md), Phase 5).

### The network

1. A data app sends nothing. It has no network permission.
2. Someone who watches the Sync app's traffic sees when it talks, how
   much it sends and receives, and which server it talks to. What else
   they see depends on the Sync app's network settings, which are Open.
3. Obtainium and the browser fetch from GitHub and from the hub site.
   Those see what any web server sees, such as addresses and times.

### The sync server

What it learns for certain, from the formats in crypto-design.md:

1. **Sizes.** A sealed record is as long as the record plus 50 bytes. A
   file stream is as long as the file plus 45 bytes, plus 16 bytes for
   each segment of about 1 MiB
   ([crypto-design.md](crypto-design.md#blob-layouts)).
2. **Counts and timing.** How many records and files there are, and when
   each device sends or fetches them.
3. **The key ID.** Every sealed record starts with the four-byte key ID
   of the recovery key, in the clear
   ([crypto-design.md](crypto-design.md#kind-1-sealed-record)). It is
   the same for every app and every device of one user, so it ties all
   of a user's data together. After a new recovery key, new records
   carry a new key ID.
4. **The kind and version bytes** at the start of every blob.
5. **Its own sequence numbers**, and the cursors that devices ask with.
6. **Which device sent what.** Each device signs with its own key, which
   the server checks
   ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md)).
7. **The network details** of each request, such as the address and the
   time.

What depends on the sync design (Open, Phase 5): whether record IDs, app
names, kinds of record, file IDs and deletion markers travel in the
clear, and how a file's ciphertext is tied to its record. A sealed
record is opened with its record ID, which comes with it, not inside it.

What it can do: hand out old records again, hold some back, change their
order, delete them, or fill a phone with file ciphertext that never
opens.

What it cannot do: read anything sealed, change a blob so that it still
opens, or move a blob to another record or file.

### Whoever holds a backup file

A backup file goes where the user picks, for example a USB stick or a
cloud drive. Whoever holds it learns
([backup-format.md](../architecture/backup-format.md#what-a-changed-or-cut-file-does)):

1. The app it is from, the key ID and the format version. They are in
   its header, in the clear.
2. Roughly how much data the app holds, from the file's length. The
   number of records and files, and the length of each, is hidden.
3. The app and the date, from the suggested file name, unless the user
   changes it.
4. That two backups belong to the same user. They carry the same key ID.

An older backup is still a good backup. Someone who can swap files can
give the user an older one, and the file cannot say whether a newer one
exists.

Without the words, nobody can open a backup. With the words, everything
in it opens ([What the 24 words open](#what-the-24-words-open)).

## OWASP MASVS 2.1.0

The plan's baseline is OWASP MASVS 2.1.0 at profile L2, plus the privacy
controls. The resilience profile is skipped on purpose (plan section 10).

### How the profiles work

1. MASVS 2.1.0 itself has no levels. Its levels L1, L2 and R became the
   "MAS Testing Profiles", kept outside the standard
   ([Using the MASVS](https://github.com/OWASP/masvs/blob/v2.1.0/Document/03-Using_the_MASVS.md)).
2. Today the MAS project gives the profiles to weaknesses in
   [MASWE](https://github.com/OWASP/maswe) and to tests in the
   [MASTG](https://github.com/OWASP/owasp-mastg). Each weakness names the
   MASVS controls it falls under.
3. This page uses that mapping as it was read on 2026-11-13. It changes
   upstream. Several tests are still placeholders, for example
   MASTG-TEST-0306.
4. With that mapping:
   - **L2** covers all 16 controls of STORAGE, CRYPTO, AUTH, NETWORK,
     PLATFORM and CODE, through the weaknesses MASWE-0001 to 0050.
   - **P**, the privacy profile, covers the four PRIVACY controls,
     through MASWE-0066 to 0078.
   - **R**, the resilience profile, covers the four RESILIENCE controls,
     through MASWE-0051 to 0065.

### Status words

- **Met.** Every weakness of the control is handled.
- **Met for what is built.** Everything that exists handles it. What is
  not built yet is Open.
- **Partly met.** Some weaknesses are handled and some are not. Each gap
  is named. A gap that a decision chose is a **deviation**, with a link
  to the decision. The owner confirmed every deviation on this page as
  accepted on 2026-11-13.
- **Not met.** Nothing handles it.
- **Does not apply.** The suite has nothing the control is about. The
  reason is given.
- **Not applied, by decision.** Resilience only.

No status is rounded up. Each line names its MASWE weakness, so that it
can be checked.

### Storage

**MASVS-STORAGE-1: The app securely stores sensitive data.**
Status: **Partly met.**

- MASWE-0001, sensitive data stored unencrypted in private storage. Its
  test for Room databases, MASTG-TEST-0306, is still a placeholder.
  - Records sit unencrypted in a Room database and rely on Android's
    file-based encryption. This is an accepted deviation, decided in
    [ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md).
  - The same holds for records staged during a restore
    ([backup-format.md](../architecture/backup-format.md#staging)), for
    the IDs and times of reminders that `core/notify` keeps
    ([notifications.md](../architecture/notifications.md#what-goes-where)),
    and for the app lock settings, which hold no user content
    ([ADR 0032](../adr/0032-app-lock-settings-in-android-preferences.md)).
  - Files and attachments are encrypted, each with its own key
    ([crypto-design.md](crypto-design.md#file-keys)).
- MASWE-0002, sensitive data outside private storage: met. A backup file
  is encrypted. Files leave the app only through the system pickers, to
  a place the user chooses.
- MASWE-0003, keys outside the platform keystore: met. The hardware keys
  are in the Android Keystore. Every other key is stored only wrapped by
  one ([crypto-design.md](crypto-design.md#where-keys-are-stored)). A
  phone with a software-only Keystore is allowed, with a notice.
- MASWE-0004, secrets in the app package: met. No secret is in the code
  (hard rule 7).

**MASVS-STORAGE-2: The app prevents leakage of sensitive data.**
Status: **Partly met.**

- MASWE-0005, logs: no code that ships in an app logs anything today.
  Only `core/crypto` has a test that forbids logging. Everywhere else,
  hard rule 10 is kept by review.
- MASWE-0006, backups: Android's own backup and device transfer are off
  in Catalog. crypto-design.md asks this of every app ("Where keys are
  stored", point 1). No build check enforces it.
- MASWE-0001 and 0002: as STORAGE-1.
- MASWE-0018 and 0029 to 0032: as PLATFORM-1. MASWE-0033 and 0034: as
  PLATFORM-2. MASWE-0036 to 0040: as PLATFORM-3.
- Keys leave memory only when references to them are dropped. Kotlin
  cannot wipe memory for certain
  ([crypto-design.md](crypto-design.md#keys-in-memory), point 6).

### Cryptography

**MASVS-CRYPTO-1: The app employs current strong cryptography and uses
it according to industry best practices.**
Status: **Met for what is built.**

- MASWE-0007, encryption: met. XChaCha20-Poly1305 for records and file
  keys, AES-256-GCM-HKDF streaming for files and backups, and AES-256-GCM
  in the Keystore, all through Tink or the Keystore. Our code never picks
  a nonce ([crypto-design.md](crypto-design.md#rules)).
- MASWE-0008, hashing: met. SHA-256 is used only as the checksum of the
  words and of the word list.
- MASWE-0009, MACs: met. There is no MAC of our own. The AEADs check
  every blob.
- MASWE-0010 and 0011, signatures: nothing signs yet. The sync signing
  key is Open (crypto-design.md, open question 7, Phase 5).
- MASWE-0012, random numbers: met. Every key, nonce and salt comes from
  Tink or the Keystore.
- MASWE-0047, standard APIs: met. Tink and the Android Keystore only,
  and only constructions that Tink provides.

**MASVS-CRYPTO-2: The app performs key management according to industry
best practices.**
Status: **Partly met.**

- Met:
  - MASWE-0003: as STORAGE-1.
  - MASWE-0013, making keys: the Keystore and Tink make every key. Our
    code never does.
  - MASWE-0014, deriving keys: HKDF-SHA256 through Tink, from a random
    256-bit key ([crypto-design.md](crypto-design.md#deriving-keys)).
- Accepted deviations:
  - MASWE-0015, rotation: keys change on events, not by the calendar.
    Keysets can hold several keys, and every blob names its key
    ([crypto-design.md](crypto-design.md#key-rotation)).
  - MASWE-0016, limits on key use: the Background key needs no prompt
    and works while the phone is locked, so that sync and reminders go
    on. It wraps only `record`, whose records are in the database anyway
    ([crypto-design.md](crypto-design.md#why-four-keys)). On Android 13
    and 14 there is no Unlocked key
    ([crypto-design.md](crypto-design.md#android-13-and-14)). With the
    app lock off, `file-key` needs no prompt.
  - MASWE-0017, a screen lock: the app asks Android whether the phone
    has one. A phone without one is allowed. The app says what that
    means and does not offer what needs a screen lock
    ([crypto-design.md](crypto-design.md#a-phone-with-no-screen-lock)).
  - MASWE-0020 and 0022: as AUTH-2.
  - MASWE-0001: as STORAGE-1.
- Open: a new recovery key, and the sync signing key (crypto-design.md,
  open questions 6 and 7, Phase 5).

### Authentication

**MASVS-AUTH-1: The app uses secure authentication and authorization
protocols and follows the relevant best practices.**
Status: **Open (Phase 5).**

- No app talks to a server yet, so there is no remote login. The sync
  server will check a signature from each device
  ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md)). The
  protocol is Open.
- MASWE-0018, components: met for what is built. Nothing is exported
  except the launcher screen.
- MASWE-0019, autofill for credential managers: does not apply. There
  are no passwords. The word field turns autofill off on purpose.
- MASWE-0047: as CRYPTO-1.

**MASVS-AUTH-2: The app performs local authentication securely according
to the platform best practices.**
Status: **Partly met.**

- Met: the app lock is bound to a key for files. `file-key` opens only
  through a system prompt that holds a Keystore cipher, one operation per
  prompt (MASWE-0020, MASTG-TEST-0330;
  [crypto-design.md](crypto-design.md#the-system-prompt)).
- Accepted deviations:
  - Records are behind the gate only. For them, the prompt's success is
    an event the app acts on, not a key (MASWE-0020, MASTG-TEST-0327).
    Decided in [ADR 0004](../adr/0004-room-on-system-sqlite-no-sqlcipher.md).
  - The prompt takes the phone's PIN, pattern or password as well as a
    fingerprint (MASWE-0021, MASTG-TEST-0326). Decided in
    [ADR 0031](../adr/0031-use-biometric-for-the-system-prompt.md).
  - Keys are not invalidated when a fingerprint is added (MASWE-0022,
    MASTG-TEST-0328), so that no phone setting destroys files
    ([crypto-design.md](crypto-design.md#no-phone-setting-destroys-files)).
  - MASWE-0016: as CRYPTO-2.
- Open: a check that every screen is behind the gate (step 2.2).

**MASVS-AUTH-3: The app secures sensitive operations with additional
authentication.**
Status: **Partly met.**

- MASWE-0023, a second step for sensitive actions:
  - Showing the recovery words needs a system prompt each time
    ([crypto-design.md](crypto-design.md#showing-it-again)).
  - The app lock screen asks for the prompt each time it opens.
  - Turning the app lock on needs the words and a prompt.
  - Setting up another app from a keeper will need a prompt (step 3.0,
    not built).
  - With the app lock off, opening a file needs nothing more than the
    unlocked phone. The app lock is optional
    ([crypto-design.md](crypto-design.md#the-app-lock)).
- MASWE-0024, data after the session ends: with the app lock on,
  `file-key` is dropped when the app locks. An app that waits with a
  timer keeps it until it comes back or locks.
- MASWE-0025, non-repudiation: does not apply today. Nothing is sent to
  anyone. Sync is Phase 5.
- MASWE-0016 and 0019: as above.

### Network

**MASVS-NETWORK-1: The app secures all network traffic according to the
current best practices.**
Status: **Does not apply to data apps. Open for the Sync app.**

- Data apps have no network permission
  ([ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)). They
  have no traffic, so MASWE-0026 and 0027 do not apply to them.
- The Sync app does not exist yet. Its TLS settings and certificate
  checks are Open (Phase 5).

**MASVS-NETWORK-2: The app performs identity pinning for all remote
endpoints under the developer's control.**
Status: **Open (Phase 5).**

- MASWE-0028. Only the Sync app will have a remote endpoint. Each user
  deploys the server to their own Cloudflare account (plan section 7),
  so it is under the user's control, not the developer's. Whether the
  Sync app pins anything is Open.

### Platform

**MASVS-PLATFORM-1: The app uses IPC mechanisms securely.**
Status: **Met for what is built.**

- MASWE-0018 and 0032, components and intents: met. Only the launcher
  screen is exported. Receivers are not exported and ignore actions they
  do not expect. A notification opens only the same app, through an
  explicit, immutable intent ([permissions.md](permissions.md),
  [notifications.md](../architecture/notifications.md#what-goes-where)).
- MASWE-0029, deep links: met. There are none.
- MASWE-0030, the clipboard: met. The words never go on the clipboard,
  and a paste never lands in the word field
  ([security-screens.md](../architecture/security-screens.md#what-protects-the-words)).
  Nothing else uses the clipboard today.
- MASWE-0031, app extensions: does not apply. The apps offer no
  extension points.
- Open: the handover between apps (step 3.0) and the courier interface
  ([ADR 0005](../adr/0005-no-network-permission-in-data-apps.md),
  Phase 5). Both are to be signature-protected. Both will carry keys or
  data.

**MASVS-PLATFORM-2: The app uses WebViews securely.**
Status: **Does not apply.**

- No app has a WebView (hard rule 1,
  [ADR 0019](../adr/0019-no-webview-no-runtime-code-loading.md)).
  MASWE-0033 to 0035 do not apply.
- Review keeps the rule. No build check refuses a WebView.

**MASVS-PLATFORM-3: The app uses the user interface securely.**
Status: **Partly met.**

- MASWE-0036, the screen: the word field shows its letters, so that 24
  words can be typed. It asks the keyboard not to learn and offers no
  suggestions (MASTG-TEST-0258).
- MASWE-0037, notifications:
  - Every notification is private on the lock screen
    (`VISIBILITY_PRIVATE`).
  - With the app lock on, the text is hidden everywhere, unless the user
    shows it.
  - With the app lock off, the lock screen shows the text if the phone's
    setting allows it.
- MASWE-0038, screenshots and the background:
  - The word screens block screenshots, screen recording and the
    recent-apps picture.
  - While the app lock is on, the app is blank in recent apps.
  - Other screens block screenshots only with "Hide in recent apps and
    block screenshots", which is off by default.
- MASWE-0039, overlays: not handled. Nothing in the docs or the code
  protects a screen against an overlay (MASTG-TEST-0340). Open.
- MASWE-0040, accessibility services: TalkBack reads the words aloud,
  and the screen says so first. A malicious accessibility service is
  [out of scope](#out-of-scope). The apps do not mark any view as
  sensitive for accessibility services. Open.
- MASWE-0023: as AUTH-3.

### Code

**MASVS-CODE-1: The app requires an up-to-date platform version.**
Status: **Partly met.**

- MASWE-0041, a recent platform: met. The minimum is Android 13
  (API 33), which has every platform feature the design relies on. The
  design handles what changed in Android 15
  ([ADR 0002](../adr/0002-grapheneos-first-minimum-android-13.md),
  [crypto-design.md](crypto-design.md#android-13-and-14)).
- MASWE-0042, the latest target: met. Target SDK 37
  ([build.md](../development/build.md#at-a-glance)).
- MASWE-0039, overlays, also falls under this control. It is not handled
  (PLATFORM-3).

**MASVS-CODE-2: The app has a mechanism for enforcing app updates.**
Status: **Not met.**

- MASWE-0043. No app has a way to make the user update.
- A data app cannot check for updates: it has no network permission.
  Updates come through Obtainium, which tells the user
  ([install.md](../user/install.md#updates)).
- Only the newest release of each app gets security fixes
  ([SECURITY.md](../../SECURITY.md)).
- Open: whether the suite should have a way to make users update.

**MASVS-CODE-3: The app only uses software components without known
vulnerabilities.**
Status: **Partly met.**

- MASWE-0044, known vulnerabilities: not met. No scan for known
  vulnerabilities runs (MASTG-TEST-0272 and 0274). Plan section 17 lists
  code scanning as still to set up. Open.
- MASWE-0045, the compiler's security features: does not apply. The apps
  have no native code (hard rule 2). Grammar's Rust code is the later
  exception, under its own
  [ADR 0011](../adr/0011-no-native-code-grammar-exception.md).
- MASWE-0046, deprecated APIs: met. Compiler warnings and lint warnings
  are errors, and a call to a deprecated API is a warning
  ([build.md](../development/build.md#lint)).
- MASWE-0047: as CRYPTO-1.
- MASWE-0048, harmful code in the app: partly. Every dependency needs a
  decision record, every downloaded file is verified
  ([ADR 0020](../adr/0020-dependency-verification.md)), and the owner
  reviews every change. No check can prove that a dependency holds no
  harmful code.

**MASVS-CODE-4: The app validates and sanitizes all untrusted inputs.**
Status: **Met for what is built.**

- MASWE-0050, untrusted data: met for the inputs that exist.
  - Every blob reader checks the magic, the kind and the version first,
    and gives one of six fixed answers
    ([crypto-design.md](crypto-design.md#reading-a-blob)).
  - The backup reader refuses a file that breaks any rule of the format,
    and changes nothing until the whole stream is checked
    ([backup-format.md](../architecture/backup-format.md#reading-and-checking)).
  - The word field takes only the letters a to z, one at a time.
  - A backup is taken only as a `content:` address from the system
    picker ([backup-format.md](../architecture/backup-format.md#the-system-file-picker)).
  - The receivers ignore every action they do not expect.
  - No input is read as serialized Java objects.
- MASWE-0029, deep links: there are none. MASWE-0034 and 0035: there is
  no WebView.
- MASWE-0049, loading code at runtime: there is none (hard rule 1,
  [ADR 0019](../adr/0019-no-webview-no-runtime-code-loading.md)). No
  build check refuses it.
- MASWE-0045: as CODE-3.
- Open: what the Sync app takes in (Phase 5). File ciphertext that
  arrives while an app is locked is checked only when the file is first
  opened (crypto-design.md, open question 9).

### Privacy

**MASVS-PRIVACY-1: The app minimizes access to sensitive data and
resources.**
Status: **Partly met.**

- MASWE-0066, permissions: met for what is built.
  - Every permission is listed with its reason in
    [permissions.md](permissions.md).
  - The APK rules check fails an app that asks for a permission it is
    not allowed.
  - There is no storage permission. Files come through the system
    pickers.
  - The QR code was left out partly to keep the camera permission out of
    every data app ([crypto-design.md](crypto-design.md#the-qr-code)).
  - Every app that uses `core/notify` gets all three of its permissions,
    also an app that needs only notifications (notifications.md, open
    question 3).
  - Open: the screen that asks for the notification permission
    ([notifications.md](../architecture/notifications.md#open), open
    question 1).
- MASWE-0073, declared data: not written yet. See PRIVACY-3.

**MASVS-PRIVACY-2: The app prevents identification of the user.**
Status: **Partly met.**

- MASWE-0067 and 0068, identifiers:
  - There is no account, no advertising ID, no analytics, no crash
    reporter and no Google Play services (hard rule 3).
  - The key ID is the same in every sealed record, every backup and
    every app of one user. It is a stable identifier wherever these go.
    The device signing keys will be stable too (Phase 5).
  - The sync server is the user's own.
- MASWE-0069, functions that protect privacy: met. The system pickers
  take the place of storage permissions. Reminders use alarms on the
  phone, not a push service
  ([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md)).
- MASWE-0070, telling the user first: met for what is built. The app
  lock warns before it is turned on. Preview builds warn against real
  words.
- MASWE-0071, defaults: the app lock is off until the user turns it on.
  Blocking screenshots is off by default. While the app lock is on,
  notification text is hidden by default. Nothing syncs until the user
  sets up sync.

**MASVS-PRIVACY-3: The app is transparent about data collection and
usage.**
Status: **Partly met.**

- MASWE-0072, a privacy policy: not met. There is no privacy policy
  page. The privacy claims are in the [README](../../README.md) and on
  the hub's home page. Open.
- MASWE-0073, declared data: not written yet. The data inventory, what
  each app stores and where, is planned ([README.md](README.md)). It is
  due with Water (step 2.6).
- MASWE-0074, tracking domains: met. Data apps connect nowhere. The hub
  site loads nothing from other sites
  ([site.md](../development/site.md)).
- MASWE-0075, reproducible builds: met. Every release is built twice and
  compared ([ADR 0014](../adr/0014-release-flow-and-reproducible-builds.md)).

**MASVS-PRIVACY-4: The app offers user control over their data.**
Status: **Partly met.**

- MASWE-0076, managing data:
  - The data stays on the phone unless the user sets up sync or makes a
    backup.
  - Backup and restore to a file of the user's choice exist in
    `core/backup`. Their screens come in step 2.5.
  - Clearing an app's data in Android's settings deletes everything of
    that app, keys included.
  - How a user deletes their data from the sync server is Open
    (Phase 5).
- MASWE-0077, what is shown: the user chooses whether notifications show
  their text, and whether the app blocks screenshots.
- MASWE-0078, consent: nothing leaves the phone unless the user sets up
  sync or saves a backup.

### Resilience: skipped on purpose

Plan section 10 skips the resilience profile on purpose. It gives no
further reason. All four controls are **Not applied, by decision**.

| Control | What the suite does not do |
|---|---|
| MASVS-RESILIENCE-1: The app validates the integrity of the platform. | No root, emulator or device check (MASWE-0051 to 0054). A phone with a software-only Keystore gets a notice, nothing more. |
| MASVS-RESILIENCE-2: The app implements anti-tampering mechanisms. | No check of its own signature, files or code at runtime (MASWE-0055 to 0058). Android still checks the signature of every update. |
| MASVS-RESILIENCE-3: The app implements anti-static analysis mechanisms. | No obfuscation (MASWE-0059 to 0062). The build never renames classes, because "the code is public, so renaming hides nothing" ([build.md](../development/build.md#the-decision)). The APK rules check depends on it. |
| MASVS-RESILIENCE-4: The app implements anti-dynamic analysis techniques. | No debugger or tool detection (MASWE-0063 to 0065). |

This is not the GrapheneOS release checklist. That checklist makes sure
that each app works with GrapheneOS's hardening turned on: the hardened
memory allocator, memory tagging, secure app spawning and restricted
dynamic code loading
([release-checklist.md](../development/release-checklist.md#part-1-grapheneos-on-the-pixel-9-pro)).
It protects the app through the platform. It is not a resilience
control.

## Decided on pull request 30

The owner's decisions of 2026-11-13 on this page. Each is built into the
page above.

| Question | Decision |
|---|---|
| The six deviations from MASVS: unencrypted rows (ADR 0004), the prompt takes the phone's PIN (ADR 0031), a new fingerprint does not invalidate keys, keys change on events only, the Background key works with no prompt while the phone is locked, a phone with no screen lock is allowed | Accepted. Confirmed by the owner on 2026-11-13 ([Status words](#status-words)). |
| The points under [Found while writing this page](#found-while-writing-this-page) | They stay Open. The owner decides a step for each at the Phase 1 gate ([PROMPTS.md](../development/PROMPTS.md#phase-1-gate-you)). |
| The name of Claude's machine account | `shkriuss-bot`. It has worked since Phase 0. Recorded in [working-with-claude.md](../development/working-with-claude.md#claude). |

## Open questions

Everything this page marks Open. None is decided here.

### Open in other pages

Phase 2, Water:

1. A check that every screen is behind the app lock's gate. Step 2.2
   ([security-screens.md](../architecture/security-screens.md#open)).
2. The screen that asks for the notification permission. Step 2.4
   ([notifications.md](../architecture/notifications.md#open),
   question 1).
3. When the app checks a backup, and what keeps a long backup running
   while the screen is off. Step 2.5
   ([backup-format.md](../architecture/backup-format.md#open-questions),
   questions 2 and 3).
4. The data inventory: what data each app stores, and where. Step 2.6
   ([README.md](README.md)).
5. The checks of reminders on a GrapheneOS phone: after a restart, in a
   second profile and in Private Space
   ([notifications.md](../architecture/notifications.md#open),
   question 4).

The first app that stores files:

6. How an app shows files whose keys were given up
   ([crypto-design.md](crypto-design.md#open-questions), question 13).
7. One snapshot of records and files in a backup
   ([backup-format.md](../architecture/backup-format.md#open-questions),
   question 4).

Step 3.0, the handover between apps:

8. The handover interface, its signature permission, and what happens
   when the asking app already has keys. Whether a keeper can check the
   words for another app
   ([crypto-design.md](crypto-design.md#open-questions), questions 1
   and 2).

Phase 5, sync:

9. The protocol: formats, cursors, conflicts, a hostile server, replay,
   rollback and reordering, lost and revoked devices, and what the
   server can still learn
   ([ADR 0009](../adr/0009-sync-protocol-and-server.md),
   [PROMPTS.md](../development/PROMPTS.md)).
10. The courier interface between the data apps and the Sync app
    ([ADR 0005](../adr/0005-no-network-permission-in-data-apps.md)).
11. A new recovery key, repair once a keyset holds keys of two recovery
    keys, and backups made with an older key
    ([crypto-design.md](crypto-design.md#open-questions), questions 6
    and 14;
    [backup-format.md](../architecture/backup-format.md#open-questions),
    question 9).
12. The sync signing key
    ([crypto-design.md](crypto-design.md#open-questions), question 7).
13. The largest sealed record, and file ciphertext stored unchecked
    until it is opened
    ([crypto-design.md](crypto-design.md#open-questions), questions 8
    and 9).
14. Ties, purged deletion markers and old backups, and one encoding for
    records in backups and in sync
    ([backup-format.md](../architecture/backup-format.md#open-questions),
    questions 6 to 8; [data.md](../architecture/data.md#open)).
15. A notification that is not a reminder, for example in the Sync app
    ([notifications.md](../architecture/notifications.md#open),
    question 3).
16. The QR code for the words, decided again in Phase 5
    ([crypto-design.md](crypto-design.md#the-qr-code)).

Other:

17. An opt-in mode that keeps reminder times and a generic title
    readable before the first unlock. Deferred, not rejected
    ([ADR 0010](../adr/0010-exact-alarms-and-reminder-storage.md),
    point 5).
18. The rehearsal of restoring and rotating the signing key, and the
    decision record a rotation needs
    ([ADR 0013](../adr/0013-signing-key-custody-and-rotation.md)).
19. Whether the emulator jobs become required checks, and their
    unpinned images
    ([ADR 0028](../adr/0028-instrumented-tests-own-runner-and-shell-steps.md)).
20. The path of any signing configuration inside the Gradle project
    ([CODEOWNERS](../../.github/CODEOWNERS)).
21. Code scanning for Kotlin
    ([plan section 17](../plan/PLAN.md#17-to-confirm-in-phase-0)).

### Found while writing this page

Nothing decides these yet. This page proposes no answer. The owner
decides a step for each of them at the Phase 1 gate
([PROMPTS.md](../development/PROMPTS.md#phase-1-gate-you)).

1. No build check makes sure that every app turns Android's own backup
   and device transfer off (STORAGE-2).
2. No build check refuses a WebView or code loaded at runtime (hard
   rule 1; PLATFORM-2, CODE-4).
3. Logging of user content is tested only in `core/crypto`
   (STORAGE-2).
4. Nothing scans the dependencies for known vulnerabilities (CODE-3).
5. There is no way to make users update (CODE-2).
6. The Sync app's TLS settings, and whether it pins the server
   (NETWORK-1 and NETWORK-2, Phase 5).
7. Protection against overlays, and marking views as sensitive for
   accessibility services (PLATFORM-3, CODE-1).
8. There is no privacy policy page (PRIVACY-3).
9. How the owner's GitHub and Cloudflare accounts are protected, for
   example by a second factor. It is not documented.
10. The domain's registrar lock, DNSSEC and CAA records. They are not
    documented.
11. What to do if the signing key is stolen.
12. Whether the recovery words alone can add a device to the sync
    server (Phase 5).
