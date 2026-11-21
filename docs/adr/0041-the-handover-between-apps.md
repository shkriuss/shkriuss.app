# 0041 The handover between apps

- Status: Proposed
- Date: 2026-11-21, the day it was proposed
- Source: the step "3.0 Handover"
  ([PROMPTS.md](../development/PROMPTS.md#30-handover)). ADR 0007,
  point 12, had decided the outline: a keeper sets up a second app
  through a signature-protected screen, after the system prompt, with
  derived keys only, and checks the caller's certificate itself. Claude
  proposed the points below in the planning session of that step. The
  owner answered its four questions on 2026-11-21: preview builds, the
  check of the words for another app, how keepers are found, and an app
  that already has keys. The record is not agreed yet.

## Context

- The recovery key is the account. Each app derives its own `record`,
  `backup` and `file-key` keysets from it
  ([crypto-design.md](../security/crypto-design.md#deriving-keys)).
- A keeper is an app that keeps the recovery key on the phone, under its
  Recovery guard, which needs the system prompt for every use
  ([0007](0007-recovery-key-instead-of-passwords.md), point 10).
- Until now every app is set up by typing the 24 words. So every app is
  a keeper, and no app knows of the others: an app cannot say "The
  recovery key is kept in Water", and never asks "keep it here too".
- 0007, point 12: a second app on the same phone gets its own derived
  keys from a keeper, never the recovery key. The keys travel with no
  further encryption. The keeper checks the caller's signing certificate
  itself. This record says how.
- Open until now: how an app that is not a keeper checks the paper copy
  before its app lock is turned on, if a keeper can do it for it
  (crypto-design.md, open question 1), and what a handover does in an
  app that already has keys or has its app lock on (open question 2).
- 0035, point 3, left a fourth choice in the first-need dialog to this
  step.
- 0037: an app signed only with the old key gets no signature permission
  after a rotation. How the handover behaves during a rotation was left
  open.
- Every app of the suite is signed with one key
  ([0013](0013-signing-key-custody-and-rotation.md)). Each preview is
  signed with a throwaway key.
- Android facts the design rests on:
  1. `Activity.getCallingPackage()` names the app that receives the
     result of an activity started for a result. Android sets it. The
     caller cannot choose it.
  2. A permission with protection level `signature` is granted only to
     apps signed with the same key as the app that defines it. An app
     may define a permission that another app with the same key defined
     already. An app with another key that defines the same name cannot
     be installed.
  3. From Android 11, an app sees another app only if its manifest asks
     for it, for example with `<queries>` for an intent action. An app
     that starts an activity of another app for a result, or calls its
     content provider, becomes visible to it.

## Decision

### Who takes part

1. A keeper hands over. An app that does not keep the recovery key
   asks. Only data apps take part: never Sync or Catalog, and never an
   app asking itself.
2. The keeper takes the asking app's name only from Android: the calling
   package of its handover screen. The request carries no app name. So
   an app can only ever get its own keys.

### What the user sees

3. In the asking app, wherever it offers to enter the words today, and
   only when a keeper is on the phone:
   - the security screen offers **Get the keys from Water**: one button
     for each keeper, which also names its key's short name when the
     keepers keep different keys;
   - the first-need dialog of 0035 gets the fourth choice **Get the keys
     from Water** in its "set up" and "restore" forms;
   - a setup that stopped, a damaged key file, and keys lost with the
     screen lock offer it next to the words.
4. The asking app's own screen opens the keeper's handover screen, then
   shows the outcome: the app has its keys, with the short name, and the
   name of the app that keeps the words. Or why not.
5. The keeper's handover screen is a security screen: no screenshots,
   other apps' windows hidden, taps under them dropped. It names the
   asking app, with its name from Android, and the short name of the
   recovery key. It says that the asking app gets its own keys
   only, never the words, and cannot show them.
   - **Allow** opens the system prompt of the Recovery guard. So the
     hardware enforces the user's consent. **Do not allow** closes it.
   - A keeper that does not keep the key now says so, with **Close**.
   - A caller that fails the checks of point 9 gets no screen, only a
     cancelled result.
   - The keeper's own app lock is not asked for. The screen shows no
     data of the keeper, and the Recovery guard needs the prompt anyway.

### The signature permission

6. One permission of the suite's own: `app.shkriuss.permission.HANDOVER`,
   protection level `signature`. It is for the handover only. The courier
   interface of sync gets its own.
7. Every data app defines it and requests it. `core/security`'s manifest
   brings both. So the apps can be installed in any order: the first one
   defines it, and each later one, signed with the same key, is accepted
   and granted it. Catalog removes it.
8. It protects the two exported parts of the handover: the keeper's
   handover screen and its status provider (point 13). Android refuses
   them to any app without it.

### The keeper checks the caller itself

9. Before the keeper shows anything, and again just before it returns
   the keys, it checks the calling package:
   - it is not the keeper itself, it is `app.shkriuss.<name>`, with
     `.preview` exactly when the keeper is a preview, and `<name>` holds
     data keys;
   - its signing information has exactly one signer, and that
     certificate's bytes are the same as the keeper's own current
     certificate.
10. The exact current certificate is compared, not the lineage. During a
    rotation, an app on the new key and an app on the old key refuse
    each other until both are updated. An app signed with an old key, or
    with a lineage from an old key to another, never passes.
11. The asking app checks the keeper in the same way before it opens it
    and when the keys come back. Otherwise an app that took a keeper's
    package name on a phone without that keeper could hand over keys it
    knows.

### How an app finds the keepers

12. The handover screen of every data app has an intent filter for the
    action `app.shkriuss.action.HANDOVER`, with no category, so it cannot
    be started without naming it. `core/security` asks for that action in
    `<queries>`. So the suite's apps see each other, and only them.
13. Each data app has a status provider, `<application ID>.keeper`,
    exported and protected by the permission. It answers one call:
    whether the app keeps the recovery key now, and the key ID of its
    keys. It checks its caller as in point 9. The answer is live: a
    keeper whose Recovery guard went with the screen lock answers "no".
14. The asking app lists the apps with the handover action, keeps those
    that pass point 9, and asks each one's provider. It uses the answer
    for the "Get the keys" choices, for "The recovery key is kept in
    Water" with **Open Water** (only keepers of its own key ID), and for
    "keep it here too" (point 18).

### What is handed over

15. After the prompt, the keeper derives the asking app's `record`,
    `backup` and `file-key` keysets from its kept recovery key, inside
    `core/crypto`, and drops the recovery key at once. The screen code
    never holds it.
16. The keysets go back in the result of the handover screen, as version
    1 of a small format that only `core/crypto` writes and reads:
    - the result: the version, the three keysets as Tink's binary
      keysets, and a flag "words checked" for point 19;
    - the request: its version and what it asks for, the keys or the
      check of the words. It names no app;
    - a keeper that gives no keys says why: it keeps no key now, or the
      request is newer than it knows. Nothing, if the user said no.

    The asking app takes the keys only if they are of version 1, each
    keyset has its type and parameters, and all three have the same key
    IDs and the same primary. The exact names go into crypto-design.md,
    and a change to them is a format change.
17. The asking app stores them as it stores the keysets that entered
    words derive: the same checks against what it stores already, the
    same order and the same answers. So a handover sets up a new app,
    finishes a setup that stopped, repairs a damaged keyset file, brings
    back keys lost with the screen lock, and never replaces keys of
    another recovery key. An app lock that is on stays on. After an app
    lock was reset, the files open again and the app lock is off, as
    after the words. Two things differ: nothing is kept, and
    starting over stays an action with words. The app is not a keeper
    afterwards.

### Keepers learn of each other

18. When the words are created or entered in an app, and a keeper of the
    same key ID is on the phone, the app asks whether to keep the key
    here too, before the prompt. With none, it keeps the key without
    asking, as before.

### The paper copy before the app lock

19. In an app that is not a keeper, the screen that turns the app lock on
    offers **Check the words in Water** when a keeper of its key ID is on
    the phone. Water's handover screen then shows the prompt, asks four
    words at random positions against the kept key, and hands over the
    keys marked "words checked". The asking app takes that as the proof
    only if the `record` keyset that comes back is exactly its own. The
    check stores nothing. With no such keeper, the app asks for all 24
    words, as before.

### Every way another app could try to get keys

| Attempt | How it fails |
|---|---|
| An app not signed with the suite's key opens the handover screen or calls the status provider. | Android refuses: it lacks the signature permission (point 8). |
| It defines the handover permission first, before the suite's apps are installed. | The suite's apps then fail to install: Android refuses a second definition from another key. No keys exist to take. |
| Android's check is bypassed somehow. | The keeper's own certificate check (point 9) refuses the caller. |
| An app makes a suite app start the handover on its behalf, so that the result goes to it (a forwarded result). | The keeper checks the app that gets the result, which Android names, not the app that started the screen. |
| An app claims to be another app in the request. | The request carries no app name. The keeper reads none (point 2). |
| A suite app asks for the keys of another app of the suite. | It gets only the keys of its own name, the one Android reports (point 2). |
| Sync, Catalog, or the keeper itself asks. | Refused by name (point 1). |
| A preview asks a real keeper, or a real app asks a preview. | Another permission name, another certificate, and the build-kind check of point 9. |
| An app signed with an old signing key, or with a lineage from an old key to another key. | The exact current certificate is compared, never the lineage (point 10). A thief who holds the current key is the case of [0038](0038-a-stolen-signing-key.md). |
| A fake keeper: an app that took a keeper's package name on a phone without that keeper, and hands over keys it knows. | The asking app checks the keeper's certificate before it opens it and when the keys come back (point 11). |
| A fake or lying status provider. | Only apps that pass the check of point 9 are asked. A wrong answer at most offers a keeper that then refuses. |
| An app draws over the keeper's screen to make the user tap **Allow**. | Other apps' windows are hidden while the screen shows, and a tap under another app's window is dropped. The system prompt follows, which no app can draw. |
| An app starts the handover screen without asking for a result. | Android then names no caller. Refused (point 2). |
| An app reads the keys on their way. | Only Android carries them (point 20). A compromised Android is out of scope. |
| A malicious library inside an app of the suite asks for keys. | It can ask only for that app's own keys, which it reaches anyway once the app is set up. It needs the user's **Allow** and the prompt. |
| An app takes a screenshot of the keeper's screen, or sees it in the recent apps. | The screen blocks both, as every security screen does. It shows no words anyway, only the two apps' names and the short name of the key. |
| A crafted request or answer: wrong types, unknown values, a version of the future. | Both sides read only the values they know, inside a catch, and refuse anything else. A higher version is answered with "update both apps". |

### No further encryption

20. The keys travel with no further encryption. Both of the owner's
    points are confirmed:
    - They travel in one call through Android, from the keeper's process
      to the app that Android names as the receiver of the result. Only
      Android sees them. A compromised Android is out of scope.
    - To encrypt them for the receiver, the keeper would need a key it
      knows to be the receiver's. Android's name of the receiver, with
      the certificate check of point 9, is that knowledge already. An
      extra layer would be a construction of our own, and would protect
      only against Android itself.
    - The keys are never in a broadcast, a file, the clipboard, a
      notification, saved state or a log. The asking screen takes the
      result through a callback that stays registered for as long as
      the screen exists. So the result is handed to it at once, and
      AndroidX never holds it back as a pending result, which would go
      into the screen's saved state.
    - The keeper's own certificate check is the real gate. The
      permission stops other apps sooner.

### Preview builds

21. Previews use their own permission name,
    `app.shkriuss.permission.HANDOVER_PREVIEW`. So a preview installs
    next to the real app, and the two never take part together.
22. The preview workflow signs every preview of one run with one
    throwaway key. So two previews of the same run take part with each
    other, and the owner can try the handover on a phone. Previews of an
    older run must be uninstalled first: they hold another key under the
    same preview name.
23. As before, a preview makes the same keys as the real app from the
    same words. Testers make a new test key in a preview, and never type
    real words into it.

## Options rejected

- **Handing over the recovery key itself.** Rejected in 0007: every app
  would then hold the root.
- **Encrypting the keys on their way.** See point 20.
- **One permission per app.** An asking app would have to name the
  permission of every keeper, also of apps that do not exist yet. And
  when the keeper is installed after the asking app, Android does not
  surely grant the asking app a permission that did not exist at its
  own install.
- **Finding keepers by turning a screen on and off.** A keeper would
  show its handover screen only while it keeps the key. It needs no
  provider, but it gives no key ID, and an app stays listed after the
  screen lock is removed until it runs again.
- **Comparing the certificate lineage**, for example with
  `PackageManager.hasSigningCertificate`. During a rotation it would let
  an app on the old key in.
- **No handover in preview builds.** The owner then could try the
  handover on a phone only in released apps. The owner chose previews
  of one run.
- **All 24 words in every app that is not a keeper**, before its app
  lock. The user would type the words once in every app set up by a
  handover. The owner chose the four words in a keeper.
- **A handover only for an app with no keys.** After the screen lock is
  removed, the user would have to type the words in every such app to
  open its files. The owner chose the same reach as the words.
- **A module of its own for the handover.** Its screens are security
  screens, and its other parts serve only them. It lives in
  `core/security` and `core/crypto`.

## Consequences

- The suite declares one permission of its own. The APK rules check
  must allow Water and Reminders to declare and request it, with
  protection level signature only, and every later data app the same.
  The check is owner-only, so the owner asks for that change.
- The build must name the permission per build type, real or preview.
  The application convention plugin is owner-only too.
- The preview workflow must sign every preview of one run with one
  throwaway key. It is owner-only too, and so is fingerprints.md, which
  says that each preview has its own key.
- Each data app exports two parts besides its launcher: the handover
  screen and the status provider. Both need the permission, and both
  check the caller's certificate themselves. permissions.md,
  threat-model.md and data-inventory.md must say so.
- The approved specifications of Water and Reminders say that only the
  launcher screen is exported, list five permissions, and say that the
  handover comes later
  ([Water](../apps/water/spec.md#permissions),
  [Reminders](../apps/reminders/spec.md)). The build changes both
  apps, so those specifications change with it, and the owner approves
  the change.
- An app set up by a handover cannot show the words. Its security screen
  names the app that keeps them.
- When the last keeper on a phone loses its copy, no app can hand over
  until the words are entered in some app again.
- An asking app depends on a keeper of the same build kind and the same
  current key. During a rotation, update every app before a handover.
- Android's behaviour when the first app that defined the permission is
  uninstalled is read in Android's reference, not checked on an
  emulator: the other apps that define it keep it. If Android behaved
  otherwise, the handover would fail closed until an app is updated.
- 0007 point 12, 0035 point 3 and 0037's open point on the handover are
  decided here. Once the record is agreed, those records note it, and
  [crypto-design.md](../security/crypto-design.md#setting-up-a-second-app-on-the-same-phone),
  with its open questions 1 and 2, and
  [security-screens.md](../architecture/security-screens.md) get the
  detail.
