# 0005 No network permission in data apps, separate Sync app

- Status: Accepted. Point 14's WorkManager superseded by
  [0045](0045-sync-runs-through-jobscheduler.md): the Sync app runs
  through Android's JobScheduler.
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 2 (decision 4), 3, 4, 7, 10
  and 16, and the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4).
  Completed on 2026-11-26 in Phase 5, step 1
  ([PROMPTS.md](../development/PROMPTS.md)), with the owner's decisions
  in the planning session of that step. The detail is in
  [sync-protocol.md](../architecture/sync-protocol.md#the-courier-interface).

## Context

- Every app works fully with no account and no network (section 1).
- Sync is optional.
- The threat model defends against other apps on the device, network
  attackers, and a compromised or curious sync server (section 10).
- A permission that several apps define breaks every update after a
  rotation of the signing key, and its name is free for any app once
  the app that owned it is uninstalled
  ([0041](0041-the-handover-between-apps.md), Context and points 6 to
  8). The APK rules check lets no app define a permission
  ([permissions.md](../security/permissions.md#rules)).

## Decision

1. Data apps have no network permission. They never declare
   `android.permission.INTERNET`.
2. A separate Sync app, `app/sync`, does all networking. It is the only app
   with the network permission.
3. Courier model: each data app exposes an interface that only an app
   signed with the suite's certificate can use. It hands out encrypted
   change-sets and encrypted file streams. The Sync app moves ciphertext
   only.
4. WorkManager is used in the Sync app only (section 3).

Point 3 first read "a signature-protected interface". The points from
here on were decided when the record was completed.

### The courier interface

5. Each data app exports one content provider,
   `<application ID>.courier`. The Sync app exports one too. The suite
   defines no permission for them. Each provider checks its caller
   itself, before anything else, as the handover does
   ([0041](0041-the-handover-between-apps.md), points 8 to 10): the
   package name that Android gives, exactly one signer, and the same
   current certificate as its own. A caller that fails gets no answer.
6. The Sync app calls and the data app answers. The data app hands out
   batches of sealed records and its stored file streams, and takes in
   pages of sealed records and streams. They pass as file descriptors.
7. A data app can ask the Sync app for a run, and read whether sync
   works. It can do nothing else there.
8. The Sync app learns from a data app only: its name, record IDs,
   sealed blobs, file IDs, the lengths and hashes of streams, and
   where the app stands: its versions, its cursor, its key ID and
   counts.
9. Sync is turned on in each data app on each device. That is state of
   one phone ([0036](0036-app-settings-as-records.md), point 3).
10. A data app decides everything about its records: what it sends,
    what it takes, and which version wins. It checks what the Sync app
    gives it as if a hostile server had handed it over.
11. The interface has a version. A side that meets a newer one says
    "Update both apps."

### The Sync app

12. The Sync app holds two keys: its device key, which signs its
    requests, and a key that opens the names of devices
    ([0009](0009-sync-protocol-and-server.md), points 14 and 18). It
    never holds the recovery words, a key that opens a record or a
    file, or plaintext.
13. Its connection: HTTPS only, the certificate authorities built into
    Android, no pin, and no HTTP library
    ([0009](0009-sync-protocol-and-server.md), point 28).
14. It runs through WorkManager: every 15 minutes while there is a
    network, when a data app asks, and when the user asks. It works
    while the apps and the phone are locked.

## Options rejected

- **The network permission in every data app.** Every app could then reach
  the network. With no permission declared, anyone can check on any Android
  that a data app cannot connect. Only one small app needs a network audit.
  The cost is accepted: more work, and sync needs a second app.
- **A permission of the suite's own for the courier interface.** After
  a rotation of the signing key, the first update of every app that
  defines it would fail. When the app that owns it is uninstalled, any
  app may take its name ([0041](0041-the-handover-between-apps.md)).
- **The words typed into the Sync app.** The one app with a network
  would hold the root of the account, if only for a moment.
- **A bound service.** A provider needs no connection that must be kept
  and can be lost, and the handover already uses one with the same
  check.

## Consequences

- Each data app works fully without the Sync app.
- The Sync app never sees plaintext.
- The courier interface works only between apps signed with the same
  certificate. The whole suite has one signing key. See
  [0013](0013-signing-key-custody-and-rotation.md).
- On GrapheneOS, revoking the network permission changes nothing for data
  apps, because they declare none (section 16).
- The protocol and the server are in
  [0009](0009-sync-protocol-and-server.md).
- During a rotation of the signing key, an app on the new key and an
  app on the old key refuse each other until both are updated. Sync
  for that data app waits, and nothing is lost. This answers the open
  point of [0037](0037-signing-key-rotation.md) for the courier
  interface.
- Each data app gets one more exported part. Requests from other apps
  reach it, so it reads nothing before its check, and its tests send it
  hostile calls. permissions.md, data-inventory.md and threat-model.md
  say so when it is built.
- The Sync app needs `INTERNET` and what WorkManager needs. Each
  permission gets its place in the allow list of the APK rules check
  when the Sync app is built, with the owner's sentence.
- The Sync app's own specification, its screens and settings
  ([sync-protocol.md](../architecture/sync-protocol.md#open-questions),
  question 1), is [docs/apps/sync/spec.md](../apps/sync/spec.md).
