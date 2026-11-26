# 0009 Sync protocol and server

- Status: Accepted
- Date: 2026-11-10
- Source: [plan](../plan/PLAN.md) sections 1, 5, 6, 7, 10, 13 and 16, and
  the owner's review of
  [pull request 4](https://github.com/shkriuss/shkriuss.app/pull/4).
  Completed on 2026-11-26 in Phase 5, step 1
  ([PROMPTS.md](../development/PROMPTS.md)), with the owner's eight
  decisions in the planning session of that step. The detail is in
  [sync-protocol.md](../architecture/sync-protocol.md).

## Context

- Sync is optional. Every app works fully without it (section 1).
- The Sync app moves ciphertext only. See
  [0005](0005-no-network-permission-in-data-apps.md).
- The threat model defends against a compromised or curious sync server,
  and against takeover of the Cloudflare account (section 10). Traffic
  analysis of sync timing and sizes is out of scope.
- The Cloudflare free plan sets these limits: 10 ms CPU per request,
  100,000 requests a day, and 100,000 D1 row writes a day.
- Read on Cloudflare's documentation on 2026-11-26, also for the free
  plan: 5,000,000 D1 row reads a day; a D1 query fails once a daily
  limit is reached, until 00:00 UTC; a write to a table with an index
  counts as one more row; a value or a row in D1 is at most 2,000,000
  bytes; a D1 database is at most 500 MB; a batch of statements counts
  as one query of the 50 that one request may make. R2 gives 10 GB,
  1,000,000 writing and 10,000,000 reading operations a month, and
  checks a SHA-256 that comes with an upload. A request body is at most
  100 MB. The Worker's Web Crypto checks ECDSA and Ed25519 signatures.
- The apps have no JSON library. Every format so far is bytes in a
  fixed layout.
- A record's `updatedAt` comes from the device's clock and only moves
  forward ([0027](0027-record-fields-and-stamping.md)). A wipe and a
  file key sealed again keep it
  ([0042](0042-wiping-the-content-of-deleted-records.md)).
- A permission that several apps define breaks updates after a
  rotation of the signing key
  ([0041](0041-the-handover-between-apps.md), points 6 to 8).

## Decision

1. The server is one Cloudflare Worker.
   - D1 holds encrypted records with server-assigned sequence numbers. Each
     record is one opaque blob. See [0006](0006-tink-and-key-hierarchy.md).
   - R2 holds encrypted file chunks.
2. Devices pull changes since a cursor and push batches.
3. Conflicts are resolved on the device. The last writer wins per record,
   with deletion markers.
4. The design stays within the free-plan limits above.
5. Each device signs with its own non-exportable key. The server checks it
   (section 6).
6. Each user deploys the backend to their own Cloudflare account from this
   repository.
7. The backend is licensed AGPL-3.0. See [0018](0018-licences.md).

The points from here on were decided when the record was completed.
[sync-protocol.md](../architecture/sync-protocol.md) has every byte and
every rule. The code follows that page exactly.

### The server and its interface

8. One server holds one account: one recovery key at a time.
9. The interface is HTTPS with bodies of bytes in fixed layouts, under
   the path `/v1/`. Every request but one is signed by the device's
   key, over its method, its path, the time, the device, the server
   and the hash of its body. Every call can be sent twice without
   harm.
10. The server keeps one counter for each app. It keeps the latest blob
    of each record, with the number of its last write. A device
    fetches what is above its cursor.
11. A batch carries the cursor it was made at. The server refuses a
    record whose copy changed after that cursor. So it never replaces
    a version with one whose author had not seen it.
12. The server has an epoch. It remembers the highest number it told
    each device, and makes a new epoch when a device knows a higher
    one: the database was put back. On a new epoch every app compares
    everything it has with the server.
13. A sealed record is at most 524,288 bytes. A batch and a page hold at
    most 100 records and 524,288 bytes.

### Keys and joining

14. The device key is ECDSA P-256 in the Sync app's Android Keystore,
    in StrongBox where the phone has it, with no prompt, usable while
    the phone is locked. This decides open question 7 of
    crypto-design.md.
15. The account key is an Ed25519 key pair made from the recovery key,
    with the label `shkriuss.app/v1/sync/account`. It is made for one
    signature inside a data app that has the recovery key in hand,
    after the system prompt, and dropped. It signs two statements: a
    device may join, and a new account key. The server keeps its
    public half. Signatures are a new use of Tink.
16. Decided by the owner: the recovery words alone cannot add a device.
    A device joins with a statement signed by the account key and a
    one-time code. A device that is in shows such a code. With no
    device left, and for the first device of a server, the user saves
    a code as a secret of the Worker in the Cloudflare dashboard.
17. The Sync app never sees the words. It asks a keeper for its
    statement through a new mode of the handover, format version 2.
    This supersedes "never Sync" in points 1 and 7 of
    [0041](0041-the-handover-between-apps.md). The Sync app still
    never gets a key that opens data.
18. Decided by the owner: each device has a name, which the server
    stores sealed. The Sync app holds one keyset for it, the `record`
    keyset of the app name `sync`, which opens nothing else.
19. Any device of the account can remove another. A removed key never
    joins again.

### Records, conflicts and files

20. The plaintext of a sealed record is the record entry of a backup,
    with a version byte and the app's data version before it, and the
    length and SHA-256 of the file's stream after it. One encoding
    serves a backup and sync.
21. The server sees, in the clear, the app's name and the record ID.
    It does not see the type, the times or the deletion marker.
22. Importing has its own `RecordWriter` function, `takeFromSync`. The
    later `updatedAt` wins. With the same `updatedAt`, one fixed order
    decides, so that every device ends the same:
    1. a record that is not deleted wins over a deleted one;
    2. of two deleted records, the wiped one wins;
    3. of two wrapped file keys, the one under the current key wins;
    4. the larger plaintext wins, byte by byte.

    Step 1 was decided by the owner.
23. Decided by the owner: deletion markers are never purged in this
    version, on a device or on the server.
24. A file's stream goes to the server as it is stored, in chunks of
    4,194,304 bytes that are named by the stream's hash. A device
    fetches only a stream that a sealed record names, up to the named
    length, and keeps it only if its hash fits. This decides open
    question 9 of crypto-design.md.
25. Decided by the owner: every record syncs, also an app's settings
    record. No setting becomes per device. Every device that has the
    app reminds.

### A new recovery key, and the rest

26. A new recovery key is announced to the server by a statement that
    the old account key signs. The server then takes no blob of the
    old key. A device gets the new key only by the handover on one
    phone, or by the user typing the new words. An app that has the
    new key makes one last fetch, then takes no record sealed with
    the old one, and seals and sends everything again. Old keys stay
    in the keysets.
27. Decided by the owner: nothing forces a user to update the Sync
    app. Versions are checked only between the user's own apps and
    the user's own server.
28. Decided by the owner: HTTPS only, no cleartext, only the
    certificate authorities built into Android, none added by the
    user, no redirect, no pin.
29. Decided by the owner: no QR code. The words, the server's address
    and the code are typed.

## Options rejected

- **Durable Objects.** More moving parts than one Worker with D1 and R2
  needs. Revisit this for live push.
- **CRDT libraries.** Their cores are native code or JavaScript, which the
  apps cannot ship. One user with a few devices does not need them.
- **Resolving conflicts on the server.** Impossible, because the server
  sees only ciphertext.
- **The words alone add a device.** Whoever finds the paper and knows
  the server's address could read and change all synced data from
  anywhere, with no phone and no Cloudflare account.
- **A check at shkriuss.app for the lowest safe version.** Every Sync
  app would contact the project's domain, and whoever controls that
  domain could stop everyone's sync.
- **A pin.** Cloudflare renews certificates every few months and can
  change its authority. A pin would stop sync for everyone until an app
  update, or teach users to tap Yes. A false certificate gives an
  attacker only what the server has.
- **Purging markers when every device has confirmed.** A server that
  lies, a device that was removed and added again, or an old backup
  could bring deleted records back, and the protocol grows.
- **A log or a list of everything, to prove that nothing is held
  back.** A list of 100,000 records is megabytes on every change, and
  a log costs a row write for each entry. The free plan has neither.
- **The new recovery key sent through the server, sealed with the old
  one.** A lost device holds the old keys.
- **A session token instead of a signature on each request.** A secret
  that can be copied, and one more thing on the server.
- **One counter for all apps.** Every change would wake every data
  app.
- **A deletion wins over an edit with the same `updatedAt`.** The edit
  would be lost for good. A deleted item that shows again can be
  deleted again.
- **A device list with no names, or names in the clear.** Dates alone
  are little help after a loss. A name in the clear is one field on
  the server that is not ciphertext.
- **A switch per device for reminders, or Water's reminder settings
  kept per device.** Android's own notification switch does the first.
  The second is a format change in a released app.
- **A QR code.** It would add the camera permission and a reader to
  the apps. For the words, one photo of the screen would give away the
  account.

## Consequences

- The server stores only ciphertext.
- When two devices change the same record, the last write wins.
- Deleted records stay as deletion markers. Synced records are never
  hard-deleted (section 5).
- A user who wants sync needs a Cloudflare account. The self-hosting guide
  goes in `docs/self-hosting/`.
- A `backend` workflow comes later (section 13).
- A sync format change bumps the format version, keeps readers for every
  older version, adds a decision record, and updates `docs/architecture/`
  ("Changing formats" in [CLAUDE.md](../../CLAUDE.md)).
- Phase 5 ends when three devices stay consistent through offline edits and
  conflicts (section 16).
- A server can hold records back or show an older state. That cannot be
  told from a device that is offline. Nothing on a device is lost by
  it. [sync-protocol.md](../architecture/sync-protocol.md#attacks-considered)
  lists every attack that was considered, and the ones that do not
  fail. One of them: a new device can be shown a record that was
  deleted since. The owner decided to keep that as a known limit of
  this version.
- [crypto-design.md](../security/crypto-design.md#sync-keys) gets the
  device key, the account key, the name key, the statements and the
  signed request. Its lines "signatures are not used", "no keys are
  derived for `sync`" and "the Sync app holds no key from this page"
  change. Test vectors come with the code.
- Each data app needs a small table that is not a record, for its
  cursor and what it has to send. data.md says to ask the owner when
  it is built.
- The 10 ms of CPU time cannot be shown in a local test. The server's
  limits are set by one measurement on a deployed Worker.
- The points that data.md, backup-format.md, 0027, 0036 and 0042 left
  to the sync design are decided here: ties, purging, one encoding,
  which settings sync, and how a wipe is carried.
- Open: the points under "Open questions" in
  [sync-protocol.md](../architecture/sync-protocol.md#open-questions).
  The largest are the Sync app's specification, the screens of a new
  recovery key, and a proof that nothing is held back.
