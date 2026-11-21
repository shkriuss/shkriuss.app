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
  that already has keys. A second Claude session reviewed the record on
  pull request 87. On its findings the owner decided the same day that
  the suite defines no permission of its own (points 6 to 8). The record
  is not agreed yet.

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
  keys from a keeper, never the recovery key, through a
  signature-protected screen. The keys travel with no further
  encryption. The keeper checks the caller's signing certificate itself.
  This record says how, and replaces "signature-protected".
- Open until now: how an app that is not a keeper checks the paper copy
  before its app lock is turned on, if a keeper can do it for it
  (crypto-design.md, open question 1), and what a handover does in an
  app that already has keys or has its app lock on (open question 2).
- 0035, point 3, left a fourth choice in the first-need dialog to this
  step.
- 0037: in a rotation, the old key keeps only the right to update
  installed apps. Its permission right is off. How the handover behaves
  during a rotation was left open.
- Every app of the suite is signed with one key
  ([0013](0013-signing-key-custody-and-rotation.md)). Each preview is
  signed with a throwaway key.
- Android facts the design rests on:
  1. `Activity.getCallingPackage()` names the app that receives the
     result of an activity started for a result. Android sets it. The
     caller cannot choose it.
  2. Any app may start an exported activity, or call an exported content
     provider, that no permission protects.
  3. From Android 11, an app sees another app only if its manifest asks
     for it, for example with `<queries>` for an intent action. An app
     that starts an activity of another app for a result, or calls its
     content provider, becomes visible to it.
- Android facts that rule out a permission defined by several apps,
  read in Android 15's source:
  1. An update that defines a permission is checked against the app that
     owns that permission now. Android takes the update only if the
     update's lineage gives the owner's key the permission right. 0037
     turns that right off for the old key. So after a rotation, the
     first rotated update of every app that defines the permission fails
     (`INSTALL_FAILED_DUPLICATE_PERMISSION`), the owner's own update too,
     and so does every later update.
  2. When the app that owns a permission is uninstalled, Android drops
     the permission and its grants. It does not give it to another app
     that defines it. Until such an app is installed or updated, the
     name is free: any app may define it, is granted it, and then makes
     every update of the suite's apps fail.

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
   name of the app that keeps the words. Or why not (point 16).
5. The keeper's handover screen is a security screen: no screenshots,
   other apps' windows hidden, taps under them dropped. It names the
   asking app, with its name from Android, and the short name of the
   recovery key. It says that the asking app gets its own keys
   only, never the words, and cannot show them.
   - **Allow** opens the system prompt of the Recovery guard. So the
     hardware enforces the user's consent. One prompt is open at a
     time: **Allow** does nothing while a prompt is open. **Do not
     allow** closes the screen.
   - A keeper that does not keep the key now says so, with **Close**.
   - A caller that fails the checks of point 9 gets no screen, only a
     cancelled result.
   - The keeper's own app lock is not asked for. The screen shows no
     data of the keeper, and the Recovery guard needs the prompt anyway.

### No permission of our own

6. The suite defines no permission for the handover. The owner decided
   this on the review's findings (Context, the last facts): a
   permission that every data app defines breaks every update after a
   signing-key rotation, and is dropped, and its name freed, when the
   first app that defined it is uninstalled. This replaces
   "signature-protected" in 0007, point 12.
7. Each data app exports two parts: its handover screen and its status
   provider (point 13). `core/security`'s manifest brings both, and the
   `<queries>` of point 12. Sync and Catalog remove all three. Nothing
   is defined, so the apps can be installed, updated and uninstalled in
   any order.
8. Any app may start the handover screen or call the status provider.
   The keeper's own check of point 9 is the only gate, and it runs
   first:
   - the handover screen checks the caller before it reads anything else
     from the request, and before it shows anything. A refused caller
     gets a cancelled result that says `REFUSED`, and no screen. The
     screen closes at once;
   - the status provider checks the caller before it answers. A refused
     caller gets no answer.

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
    `<queries>`. So the suite's apps see each other.
13. Each data app has a status provider, `<application ID>.keeper`,
    exported. It answers one call, and only to a caller that passes
    point 9: whether the app keeps the recovery key now, and the key ID
    of its keys. The answer is live: a keeper whose Recovery guard went
    with the screen lock answers "no".
14. The asking app lists the apps with the handover action, keeps those
    that pass point 9, and asks each one's provider. Which keepers each
    choice lists:
    - "The recovery key is kept in Water", with **Open Water**, and "keep
      it here too" (point 18): only keepers of the app's own key ID;
    - the "Get the keys" choices: the keepers of the app's own key ID
      when it is known, and every keeper when it is not: no recovery key
      yet, a setup that stopped, or a damaged `record`. Storing refuses
      keys of another recovery key anyway (point 17).

### What is handed over

15. For a request for keys: after the prompt, the keeper derives the
    asking app's `record`, `backup` and `file-key` keysets from its kept
    recovery key, inside `core/crypto`, and drops the recovery key at
    once. The screen code never holds it. The check of the words (point
    19) is the one case where the screen holds the kept key.
16. The keysets go back in the result of the handover screen, as version
    1 of a small format that only `core/crypto` writes and reads:
    - the result: the version, the three keysets as Tink's binary
      keysets, and a flag "words checked" for point 19;
    - the request: its version and what it asks for, the keys or the
      check of the words. It names no app.

    The asking app takes the keys only if they are of version 1, each
    keyset has its type and parameters, and all three have the same key
    IDs and the same primary. Every outcome, and what the asking app
    shows:

    | Outcome | The keeper's result | The asking app |
    |---|---|---|
    | The keys | `RESULT_OK` with the keys | Stores them (point 17) and says how it went. |
    | The user taps **Do not allow**, or leaves the keeper's screen | Cancelled, no reason | Closes. Nothing changed. |
    | The prompt is closed or fails after **Allow** | Nothing yet: the keeper's screen stays, with **Allow** and **Do not allow** | Waits. |
    | A wrong word in the check of point 19 | Nothing yet: the keeper asks again | Waits. |
    | The keeper keeps no key now: the guard went with the screen lock, or the kept copy is gone or damaged when the prompt runs | Cancelled, `NOT_KEEPER` | "Water does not keep the recovery key now. Enter the words instead." |
    | The request is newer than the keeper knows | Cancelled, `UPDATE` | "Update both apps." |
    | The caller fails point 9 | Cancelled, `REFUSED` | "Water cannot give this app its keys. Update both apps." |
    | The keys cannot be read: no version 1, or keysets that do not belong together | `RESULT_OK` | "Update both apps." Nothing is stored. |
    | The keeper fails point 11 when the keys come back | Anything | Nothing is read or stored. "Water cannot give this app its keys." |

    The exact names go into crypto-design.md. A change to them, or a new
    outcome, is a format change: a new version.
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
    - The keeper does the check as it does its own, before its own app
      lock ([security-screens.md](../architecture/security-screens.md#turning-it-on),
      point 2). The prompt reads the kept key into the screen. The key,
      and keys not yet handed over, leave memory when the screen stops:
      the phone's screen turns off, or another app comes to the front.
      A turn of the phone does not count. On the way back the prompt
      asks again. A prompt that ends after a stop gives nothing.
    - A wrong word: the screen says so and asks again. It never shows
      the words.
    - A kept copy that cannot be read: the keeper says so and gives
      `NOT_KEEPER`. The asking app then offers all 24 words.
    - The four fields are word fields of the recovery key screens: no
      paste, no copy, no suggestions from the keyboard, no autofill
      ([crypto-design.md](../security/crypto-design.md#screens-that-show-or-take-the-words)).

### Every way another app could try to get keys

| Attempt | How it fails |
|---|---|
| An app not signed with the suite's key opens the handover screen or calls the status provider. | The keeper's own check (point 9) refuses it first: no screen, a cancelled result, no status (point 8). |
| An app starts the handover screen again and again. | The screen closes at once each time and shows nothing. |
| An app defines a permission named like one of ours. | There is none to take. Nothing of the handover rests on a permission. |
| An app makes a suite app start the handover on its behalf, so that the result goes to it (a forwarded result). | The keeper checks the app that gets the result, which Android names, not the app that started the screen. |
| An app claims to be another app in the request. | The request carries no app name. The keeper reads none (point 2). |
| A suite app asks for the keys of another app of the suite. | It gets only the keys of its own name, the one Android reports (point 2). |
| Sync, Catalog, or the keeper itself asks. | Refused by name (point 1). |
| A preview asks a real keeper, or a real app asks a preview. | Another certificate, and the build-kind check of point 9. |
| An app signed with an old signing key, or with a lineage from an old key to another key. | The exact current certificate is compared, never the lineage (point 10). A thief who holds the current key is the case of [0038](0038-a-stolen-signing-key.md). |
| A fake keeper: an app that took a keeper's package name on a phone without that keeper, and hands over keys it knows. | The asking app checks the keeper's certificate before it opens it and when the keys come back (point 11). |
| A fake or lying status provider. | Only apps that pass the check of point 9 are asked. A wrong answer at most offers a keeper that then refuses. |
| An app draws over the keeper's screen to make the user tap **Allow**. | Other apps' windows are hidden while the screen shows, and a tap under another app's window is dropped. The system prompt follows, which no app can draw. |
| An app starts the handover screen without asking for a result. | Android then names no caller. Refused (point 2). |
| An app reads the keys on their way. | Only Android carries them (point 20). A compromised Android is out of scope. |
| A malicious library inside an app of the suite asks for keys. | It can ask only for that app's own keys, which it reaches anyway once the app is set up. It needs the user's **Allow** and the prompt. |
| An app takes a screenshot of the keeper's screen, or sees it in the recent apps. | The screen blocks both, as every security screen does. In a request for keys it shows only the two apps' names and the short name of the key. In the check of point 19 the user types four words into it, as on the keeper's own check. |
| A crafted request or answer: wrong types, unknown values, a version of the future. | Both sides read only the values they know, inside a catch, after the check of point 9 or 11, and refuse anything else. A higher version is answered with `UPDATE`. |

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
    - The keeper's own certificate check is the only gate (points 6 to
      8).

### Preview builds

21. A preview defines nothing, as the real app. So previews of different
    runs install side by side, and next to the real apps. A preview never
    takes part with a real app: another certificate, and the build-kind
    check of point 9.
22. The preview workflow signs every preview that one run builds with one
    throwaway key. One job makes the key, signs every preview APK of the
    run with it, and deletes it. The key never leaves that job: no
    artifact, no cache, no job output. Anyone signed in to GitHub can
    download a run's files, and with the key could sign updates of those
    previews that pass point 9. So two previews of the same run take
    part with each other, and the owner can try the handover on a phone.
    - A run builds only the apps that its pull request touches. A change
      to a core module builds every app. A run that builds one app has
      no pair to try.
    - Previews of different runs refuse each other: another key.
23. As before, a preview makes the same keys as the real app from the
    same words. Testers make a new test key in a preview, and never type
    real words into it.

### The entry in permissions.md

24. permissions.md says, for each data app, under the parts that
    `core/security` brings:
    - no permission for the handover, and why (point 6);
    - `HandoverActivity`, exported, with an intent filter for
      `app.shkriuss.action.HANDOVER` and no category: a keeper's
      handover screen. It checks the caller's certificate first, and
      gives a refused caller a cancelled result and no screen;
    - `KeeperStatusProvider`, authority `<application ID>.keeper`,
      exported: one call, whether the app keeps the recovery key now
      and its short name. No data, no files, no other call. It answers
      only a caller that passes the same check;
    - `<queries>` for `app.shkriuss.action.HANDOVER`: the app sees the
      other apps with a handover screen. No `QUERY_ALL_PACKAGES`;
    - any install order works: nothing is defined;
    - Sync and Catalog remove all three.

## Options rejected

- **Handing over the recovery key itself.** Rejected in 0007: every app
  would then hold the root.
- **Encrypting the keys on their way.** See point 20.
- **A signature permission that every data app defines and requests.**
  First proposed in this record. Rejected on the review's findings
  (Context, the last facts): after a rotation no app that defines it
  can be updated; when the first app that defined it is uninstalled,
  the permission is dropped and any app can take the name and block
  every update of the suite; and every preview of another run would
  block every new preview from installing. The owner chose no
  permission.
- **The same permission, with the old key keeping its permission right
  in a rotation.** It would change 0037, point 3. An app signed with an
  old or stolen key would pass Android's gate, and the case of the
  uninstalled first app would stay. The owner chose no permission.
- **One permission per app.** An asking app would have to name the
  permission of every keeper, also of apps that do not exist yet. And
  when the keeper is installed after the asking app, Android does not
  surely grant the asking app a permission that did not exist at its
  own install. A rotation breaks its updates too.
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

- No app gets a new permission. The APK rules check and the
  application convention plugin need no change for the handover.
- The preview workflow must sign every preview of one run in one job,
  with one throwaway key that never leaves it (point 22). The workflow
  is owner-only, and so is fingerprints.md, which says that each
  preview has its own key. test-a-pull-request.md and ci.md say how
  previews are signed, and change with it.
- Each data app exports two parts besides its launcher: the handover
  screen and the status provider. Both are open to every app, and both
  refuse every caller that fails point 9. Requests from other apps reach
  this code, so it reads nothing before the check, and its tests send it
  hostile requests. permissions.md (point 24), threat-model.md, which
  says today that there is no content provider of our own, and
  data-inventory.md must say so.
- The approved specifications of Water and Reminders say that only the
  launcher screen is exported, and that the handover comes later
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
- The courier interface of sync ([0005](0005-no-network-permission-in-data-apps.md))
  is to be signature-protected. A permission that several apps define
  would meet the same two faults there. The sync design decides it.
- 0007 point 12, 0035 point 3 and 0037's open point on the handover are
  decided here. Once the record is agreed, 0007's status says that this
  record replaces "signature-protected" in point 12, those records note
  the rest, and
  [crypto-design.md](../security/crypto-design.md#setting-up-a-second-app-on-the-same-phone),
  with its open questions 1 and 2, and
  [security-screens.md](../architecture/security-screens.md) get the
  detail.
