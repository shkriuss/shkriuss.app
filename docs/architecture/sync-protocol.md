# Sync protocol

How the apps keep their records and files the same on several devices,
through a server that the user runs and that is never trusted. Every
byte that leaves a phone for sync, every call, and every rule a device
follows.

- Status: designed, not built. The points the owner decided are in
  [Decided by the owner](#decided-by-the-owner).
- The code will be `backend/` (the server), `android/core/sync-client`
  (what each data app does), `android/app/sync` (the Sync app), and new
  parts of `android/core/crypto` and `android/core/security`. All of
  it must follow this page exactly. If this page is wrong or unclear,
  the fix is a change to this page first, agreed with the owner.
- Decisions: [ADR 0009](../adr/0009-sync-protocol-and-server.md) (the
  protocol and the server) and
  [ADR 0005](../adr/0005-no-network-permission-in-data-apps.md) (the
  Sync app and the courier interface). The keys are in
  [crypto-design.md](../security/crypto-design.md#sync-keys). The
  record fields are in [data.md](data.md). The bytes of a record are
  those of a backup ([backup-format.md](backup-format.md#record)).
- A change to any byte layout, call, limit or rule on this page is a
  format change: a new version number, readers for every older
  version, and a decision record ("Changing formats" in
  [CLAUDE.md](../../CLAUDE.md)).

The page ends with what the tests must cover, every
[assumption](#assumptions), the
[attacks that were considered](#attacks-considered) and every
[open question](#open-questions).

## At a glance

| Part | Choice |
|---|---|
| Server | One Cloudflare Worker in the user's own account. D1 holds sealed records, R2 holds file chunks. One server, one account. |
| What the server stores | Ciphertext, public keys, numbers and names of apps. Nothing that opens data. |
| Who talks to it | Only the Sync app. Data apps have no network permission. |
| Between a data app and the Sync app | The courier interface: a content provider in each data app, which checks the caller's signing certificate itself |
| A record on its way | One sealed record (blob kind 1). Its plaintext is the record entry of a backup. |
| A file on its way | Its stored stream (blob kind 2), in chunks of 4 MiB, never encrypted again |
| Who may join | A device with a statement signed by the account key, which comes from the recovery key, and a one-time code |
| Every request | Signed by the device's own key, which cannot leave the phone |
| Order on the server | One counter for each app. A device fetches what is above its cursor. |
| Conflicts | Decided on the device. The later `updatedAt` wins. The same `updatedAt` follows one fixed order. |
| Deletion markers | Kept. Never purged in this version. |
| A hostile server | Cannot read, change or forge. It can hold back and refuse. |
| Format versions | The plaintext of a sealed record: 1. The courier interface: 1. The server interface: 1. |

## Rules

1. The server is never trusted. Whoever runs it, Cloudflare included,
   may read, keep, change, hold back or replay everything it stores.
   No rule on this page rests on the server being honest. An honest
   server only makes sync work.
2. The server stores only ciphertext and what
   [What the server stores](#what-the-server-stores) lists.
3. Only the Sync app uses the network. It never holds a key that opens
   data, the recovery words, or plaintext.
4. A data app decides everything about its records: what to send, what
   to take, and which version wins. It trusts neither the server nor
   the order in which records arrive.
5. A device never throws away its own data because of something a
   server said. The devices are the source. The server is a copy.
6. No cryptography of its own. Every blob is one of
   [crypto-design.md](../security/crypto-design.md#blob-layouts). The
   two signatures of this page are in
   [crypto-design.md](../security/crypto-design.md#sync-keys).
7. Every call can be sent twice without harm. The second time leaves
   the server as the first did, though the answer can differ. The one
   exception is a new device code, which replaces the one before.
8. Numbers that take more than one byte are big-endian. Times are
   milliseconds since 1970-01-01T00:00:00Z, as signed 64-bit numbers.
   An ID is 16 bytes. Hex is lower case.
9. A reader that meets a version, a type or an answer it does not know
   stops with a clear message. It never guesses.
10. Nothing on this page is logged: no record ID, no app content, no
    address of a server (hard rule 10).

## Words used on this page

- **Data app.** An app of the suite that holds records, for example
  Water.
- **Sync app.** `app.shkriuss.sync`, the only app with the network
  permission.
- **Server.** The Worker with its D1 database and its R2 bucket, in
  the user's own Cloudflare account.
- **Account.** Everything that one recovery key opens. One server
  holds one account.
- **Device.** One Sync app on one phone or tablet, with its own device
  key.
- **Sealed record.** Blob kind 1 of crypto-design.md: one record,
  encrypted with the app's `record` key.
- **Stream.** Blob kind 2: one file, encrypted once with its own file
  key.
- **Number.** The sequence number the server gives a record when it
  stores it. Each app has its own count.
- **Head.** The highest number the server has given for an app.
- **Cursor.** The number up to which a data app has taken in what the
  server holds.
- **Known.** The highest number the server ever told a data app for
  its records.
- **App name.** As in crypto-design.md: the part of the application ID
  after `app.shkriuss.`, 1 to 32 lower-case letters `a` to `z`. A
  preview has its app's name.
- **Epoch.** 16 random bytes that name one life of the server's
  database. A new epoch means that numbers start to mean something
  else.
- **Key ID.** The four public bytes that name a recovery key
  ([crypto-design.md](../security/crypto-design.md#the-recovery-key-and-its-key-id)).
- **Keeper.** A data app that keeps the recovery key on the phone.

## The parts

```text
 data app                Sync app                    server
 (no network)            (network, no data keys)     (never trusted)

 records, files   <-->   the courier interface
 seals and opens         carries blobs       <-->    D1: sealed records
 decides conflicts       signs each request          R2: file chunks
                         with the device key         checks signatures
```

| Part | Holds | Never holds |
|---|---|---|
| Data app | Its records and files. Its `record`, `backup` and `file-key` keysets. Its cursor. | A network permission |
| Sync app | The device key. The name key. The server's address. | A key that opens data. The recovery words. Plaintext of any record or file. |
| Server | Sealed records, file chunks, the public keys of the account and its devices | Any private key. Anything that opens a blob. |

1. A data app works fully without the Sync app, and the Sync app
   without any one data app.
2. Sync is turned on in each data app on each device. An app that has
   it off gives the Sync app nothing and takes nothing.
3. A data app that syncs needs the keys that come from the recovery
   key. It gets them as it does for a backup: the dialog of
   [ADR 0035](../adr/0035-recovery-key-when-first-needed.md), with its
   own short reason.
4. One server holds one account. A second recovery key needs a second
   server. A [new recovery key](#a-new-recovery-key) replaces the old
   one on the same server.

## Keys and identity

The exact parameters are in
[crypto-design.md](../security/crypto-design.md#sync-keys). This page
says what each key is for.

| Key | Where it lives | What it does |
|---|---|---|
| Device key | The Sync app's Android Keystore. It cannot leave the phone. | Signs every request of this device. |
| Account key | Nowhere. It is made from the recovery key for one signature, inside a data app, and dropped. | Signs the two statements below. |
| Name key | The Sync app, as its `record` keyset | Seals and opens the names of devices. Nothing else. |

### The device key

1. ECDSA with the curve P-256 and SHA-256, made inside the Android
   Keystore, in StrongBox where the phone has it. It needs no prompt
   and works while the phone is locked, as the Background key does.
2. The Sync app makes a new device key each time it starts to join a
   server. A key belongs to one server. When the device leaves or is
   removed, the key is deleted.
3. On the wire the public key is 65 bytes: `04`, then X and Y, 32
   bytes each. A signature is 64 bytes: r, then s.
4. The **device ID** is the first 16 bytes of the SHA-256 of those 65
   bytes. So a device ID cannot be given to another key.

### The account key

1. An Ed25519 key pair. Its private part is 32 bytes made from the
   recovery key with the label `shkriuss.app/v1/sync/account`. So it
   is the same on every device, with no coordination.
2. It is made only inside `core/crypto`, in a data app that has the
   recovery key in hand: a keeper, after the system prompt of its
   Recovery guard, or an app where the user just entered all 24 words.
   It signs one statement and is dropped. It is never stored and never
   leaves that app.
3. The server keeps the public half, 32 bytes, and the key ID of the
   recovery key it comes from: the **current key ID**.
4. Whoever has the words can make this key. The words alone still do
   not add a device ([Joining](#joining)).

### The name key

1. A `record` keyset for the app name `sync`, label
   `shkriuss.app/v1/sync/record`. The Sync app stores it under its own
   Background key, as a data app stores its `record` keyset.
2. It seals one thing: the name of a device, as a sealed record whose
   record ID is the device ID. The plaintext is the byte `01` and then
   the name in UTF-8, 1 to 40 characters and at most 160 bytes.
3. A device's first name is its model, for example "Pixel 9 Pro". The
   user can change it in the Sync app.
4. The key opens no record of any data app. Each app's keys come from
   its own label.

### The statements

A statement is a short run of bytes that the account key signs. The
signature is 64 bytes.

| Offset | Size | Content |
|---|---|---|
| 0 | 7 | `53 48 4B 53 59 4E 43`, the ASCII letters `SHKSYNC` |
| 7 | 1 | Version of this layout: `01` |
| 8 | 1 | Type: `01` join, `02` new account key |
| 9 | 16 | The server ID |
| 25 | 4 | The key ID of the recovery key that signs |
| 29 | 8 | When the statement was made |
| 37 | 1 | A, the length of the server's address, 9 to 255 |
| 38 | A | The server's address, ASCII, lower case, for example `https://sync.example.workers.dev` |
| 38 + A | ... | The body |

The body of a **join** statement:

| Size | Content |
|---|---|
| 65 | The device's public key |

The body of a **new account key** statement:

| Size | Content |
|---|---|
| 32 | The new account public key |
| 4 | The key ID of the new recovery key |

1. The server's address is `https://`, the host name and, if it is not
   443, a colon and the port. Nothing after it. It is what the user
   typed into the Sync app, in lower case.
2. A statement names one server by its ID and its address. It is
   worth nothing at another server.
3. A join statement is good for 10 minutes from its time. A new
   account key statement has no end.
4. The same letters `SHKSYNC`, the version and a type byte also start
   what a device key signs ([Signed requests](#signed-requests)). The
   type byte keeps the three apart: the account key signs only types
   `01` and `02`, a device key only type `10`.

### How the Sync app gets its statement and its name key

The Sync app never sees the words.

1. It asks a keeper: it opens the keeper's handover screen
   ([ADR 0041](../adr/0041-the-handover-between-apps.md)) in a new
   mode, `SIGN_DEVICE`, of handover format version 2. The request
   carries the server's ID and address and the device's public key.
2. The keeper checks the caller as for every handover, with one
   change: for this mode, and only for it, the caller must be the Sync
   app.
3. The keeper's screen says: "Add this phone to your sync server at
   sync.example.workers.dev?" It names the Sync app and the short name
   of the recovery key. **Allow** opens the system prompt of the
   Recovery guard.
4. Inside the prompt step, `core/crypto` makes the account key, signs
   the join statement with the time of that moment, derives the name
   key, and drops the recovery key.
5. The keeper returns the statement, its signature, the account
   public key and the name key. The Sync app checks the keeper as a
   data app does (ADR 0041, point 11).
6. On a phone with no screen lock no app is a keeper. A data app then
   asks for all 24 words on its own screen, and does steps 4 and 5.
7. The Sync app never asks for, and a keeper never gives it, a
   `record`, `backup` or `file-key` keyset of a data app. A request of
   the Sync app in any other mode is refused.
8. A keeper signs with the account key of its current recovery key.
   If the server answers `0A` and names an older key that the keeper
   also holds, the Sync app asks again, and the keeper signs with
   that one. That happens only between the making of a
   [new recovery key](#a-new-recovery-key) and the moment the server
   takes it.

The exact names of the request and the result go into
[crypto-design.md](../security/crypto-design.md#the-handover-format-version-2)
with the code.

### Joining

A device joins with three things: its own device key, a join
statement, and a one-time code. The words alone do not add a device.

The code is one of two kinds.

| Kind | Who makes it | How long | Form |
|---|---|---|---|
| Device code | The server, when a device that is in asks for one. That device shows it. | 10 minutes, one use, void after 5 wrong tries. A new one voids the one before. | 8 characters |
| Setup code | The Sync app of the device that wants to join. The user saves it as the secret `SETUP_CODE` of the Worker, in the Cloudflare dashboard. | Until it is used once, or replaced | 26 characters |

Both use the letters `A` to `Z` without `I` and `O`, and the digits
`2` to `9`. A setup code is for the first device of a new server, and
for a user who has no device left.

The steps, on the device that joins:

1. The user types the server's address. The Sync app asks the server
   for [`info`](#info). It learns the server's ID, and whether an
   account is there.
2. The user picks how to get a code:
   - **From another device.** On a device that is in, the Sync app
     shows a device code. The user types it here.
   - **From the Cloudflare dashboard.** The Sync app makes a setup
     code and shows it. The user saves it as `SETUP_CODE` and comes
     back.
3. The Sync app makes its device key and gets its statement and its
   name key (the section above).
4. It sends [`enrol`](#enrol).
5. The server checks, in this order, and stores nothing before the
   check of the code:
   1. That it is not closed, and that the request's time is within 5
      minutes of its own clock.
   2. The request's own signature, with the device key that the
      statement holds.
   3. The statement: its layout, type `01`, this server's ID, the
      address the request came to, and a time within 10 minutes.
   4. The account key's signature on the statement. On a server with
      no account, the account key is the one the request brings. Else
      it is the stored one, and the statement's key ID must be the
      current key ID.
   5. The device key. If it is a device of this server already, the
      answer is "done" and nothing changes. If it was removed from
      this server, the answer is "removed".
   6. The code. A server with no account takes only a setup code. A
      wrong device code costs one of its tries.
6. The server stores the device. On a server with no account it also
   stores the account public key and the current key ID. The server
   is now in use.
7. A used setup code is remembered by its hash and never taken again.
8. The server keeps that hash in its database, and a database that is
   put back to an earlier time forgets it. So once a device has
   joined with a setup code, the Sync app tells the user to delete
   the secret `SETUP_CODE` in the dashboard.

So a code alone does nothing: the statement is checked first, and only
someone with the words can make one. A statement alone does nothing
either.

### The list of devices

1. Each device of the account can read the list: for each device its
   ID, its public key, its sealed name, when it was added and the day
   it was last seen, both by the server's clock, and whether it was
   removed.
2. The Sync app opens the names with the name key. A name that does
   not open is shown as "A device with a name this phone cannot read".
3. The list comes from the server, so it can be wrong. A device that
   the server added by itself has no statement and no keys, and can
   read nothing.

### Removing a device

1. Any device of the account can remove another, or itself.
2. The server then refuses the removed key, and says "removed" to it.
   The key can never join again.
3. A removed device keeps all its data. Its Sync app says that this
   device was removed, and stops. To sync again it joins as a new
   device.
4. Removing does not take back the keys the device holds. For that,
   see [A lost device](#a-lost-device).
5. Each Sync app remembers the IDs of the devices it has seen as
   removed. If the server's account revision ever goes back, it
   removes them again ([`heads`](#heads), point 4).

## The courier interface

How a data app and the Sync app talk on one phone. The data app hands
out sealed records and streams and takes them in. The Sync app
carries them. This completes
[ADR 0005](../adr/0005-no-network-permission-in-data-apps.md).

### No permission of our own

1. Each data app exports one content provider,
   `<application ID>.courier`. The Sync app exports one too, with the
   same name pattern. No permission protects them, and the suite
   defines none: a permission that several apps define breaks every
   update after a rotation of the signing key, and its name is free
   for any app once the app that owned it is gone
   ([ADR 0041](../adr/0041-the-handover-between-apps.md), points 6 to
   8).
2. So any app may call. The provider's own check is the only gate. It
   runs first, before the provider reads anything else from the call.
   A caller that fails gets no answer.
3. A data app's provider takes a caller only if:
   - Android's name of the calling package is `app.shkriuss.sync`, or
     `app.shkriuss.sync.preview` exactly when the data app is a
     preview, and that package belongs to the calling user ID;
   - its signing information has exactly one signer, and that
     certificate's bytes are the same as the data app's own current
     certificate. The lineage is not compared.
4. The Sync app checks each data app in the same way before it calls
   it, and takes only an app whose name holds data keys. Its own
   provider takes only such an app as a caller.
5. The Sync app finds the data apps as they find keepers: it lists the
   apps with the handover action, keeps those that pass the check, and
   asks each one's courier for `status`. A data app names the Sync
   app's two courier authorities in its `<queries>`.
6. The Sync app takes a data app's name only from Android's package
   name, never from an answer.

### What a data app answers

All calls are `call` on the provider. Version 1 has these.

| Call | The Sync app gives | The data app gives back |
|---|---|---|
| `status` | Nothing | Where the app stands. See below. |
| `compare` | Nothing | Nothing. The app starts a [comparison of everything](#comparing-everything). |
| `export` | Whether it wants ordinary changes or the records of a comparison, and the most records and the most bytes it can carry | One [batch](#a-batch), as a file descriptor, or "nothing to send" |
| `exported` | The batch's token and the server's answer | Nothing |
| `import` | One [page](#a-page) from the server, as a file descriptor | How many records it took, and its new cursor |
| `streams` | Nothing | The streams it wants sent, fetched and deleted, as a file descriptor |
| `readStream` | A file ID | A descriptor to read the stored stream |
| `streamSent` | A file ID, the stream's hash, and how it went: sent, or "the stream on this phone does not fit its hash" | Nothing |
| `writeStream` | A file ID and how many bytes are there | A descriptor to write the rest |
| `finishStream` | A file ID | Stored, or wrong, or not wanted |
| `streamDeleted` | A file ID | Nothing |

1. Batches, pages and streams always pass as file descriptors. What a
   call carries itself stays far under the 1 MB that Android allows.
2. Every call names the version it speaks. A data app that does not
   know the version answers `UPDATE`, and both apps say "Update both
   apps."
3. Every call also carries the server ID, the epoch, the device ID and
   the server's current key ID, as the Sync app last learned them. A
   data app that has stored another server ID, epoch or device ID
   starts a comparison of everything ([The cursor](#the-cursor)).
4. The Sync app runs one thing at a time for each data app. A data
   app gives out one batch at a time: a new `export` voids the token
   of the batch before.
5. A call starts the data app's process if it is not running. No part
   of the data app shows on the screen.
6. All of it works while the data app is locked and while the phone
   is locked, after the first unlock since the phone started: the
   `record` keyset is under the Background key
   ([crypto-design.md](../security/crypto-design.md#what-works-while-an-app-is-locked)).
7. A data app trusts nothing the Sync app gives it. A page is checked
   as if the server had handed it over itself, because it has.
8. The names of the calls' arguments, and the layout of what `status`
   and `streams` give, are fixed on this page when `core/sync-client`
   is built. The server sees none of them.

`status` answers with:

- the version of the courier interface, and the app's data version;
- whether sync is on in this app, and whether the app can sync now.
  It cannot while it has no `record` keyset;
- the epoch, the cursor and Known;
- the key ID of the app's current key;
- whether a [comparison of everything](#comparing-everything) is
  running;
- whether it has ordinary changes to send, records of a comparison to
  send, and streams to move;
- how many records it skipped, by reason
  ([Records that are skipped](#records-that-are-skipped)), and
  whether it has stopped sending.

### A batch

What `export` gives. The Sync app sends it to the server as it is,
without the first 17 bytes.

| Offset | Size | Content |
|---|---|---|
| 0 | 7 | `SHKSYNC` |
| 7 | 1 | Version: `01` |
| 8 | 1 | Type: `20`, a batch |
| 9 | 8 | The token. It means something only to the data app. |
| 17 | 16 | The epoch the cursor belongs to |
| 33 | 8 | The cursor the batch was made at |
| 41 | 8 | Known |
| 49 | 1 | `01` if the batch holds records of a comparison of everything, else `00` |
| 50 | 4 | How many records follow, 1 to 100 |
| 54 | ... | The records |

Each record:

| Size | Content |
|---|---|
| 16 | The record ID |
| 4 | L, the length of the blob, 50 to 524,288 |
| L | The sealed record |

1. The data app reads the cursor, Known and the records in one
   transaction. So the cursor is never newer than the records.
2. The blobs of one batch are together at most the byte limit that
   the Sync app gave. One record alone is always allowed, up to
   524,288 bytes.
3. A record is in a batch at most once.

### A page

What the server answers to a fetch, and what `import` takes, byte for
byte: [Fetch](#fetch) has the layout. The data app takes a page only
if all of this holds:

1. its epoch is the app's own, and its Since is the app's cursor;
2. Through is not below Since;
3. the numbers of its records go up, and each is above Since and not
   above Through.

Any other page is dropped, and nothing is written.

### What the Sync app answers

| Call | A data app gives | The Sync app gives back |
|---|---|---|
| `poke` | Nothing | Nothing. The Sync app asks Android for a run soon. |
| `state` | Nothing | Whether this device has joined a server, when a run for this app last ended well, and what stops sync now, if anything |

A data app pokes after a write that leaves something to send, and
when sync is turned on in it. A poke starts no network call by
itself. A poke that is lost loses nothing
([When the Sync app runs](#when-the-sync-app-runs), point 2).

### Turning sync on in a data app

1. Each data app has **Sync** in its settings. It is off at first.
2. Turning it on needs the app's keys from the recovery key. An app
   with no keys asks for them first.
3. If the Sync app is not installed, or has not joined a server, the
   data app says so and offers to open it.
4. On and off are state of this phone. They are not a record, not in
   a backup and not synced
   ([ADR 0036](../adr/0036-app-settings-as-records.md), point 3).
5. Turning it off stops this app on this device. What is on the
   server and on other devices stays.

### During a rotation of the signing key

The exact current certificate is compared. So an app on the new key
and an app on the old key refuse each other until both are updated
([ADR 0037](../adr/0037-signing-key-rotation.md)). Sync for that data
app waits. The Sync app names the app to update. Nothing is lost: the
changes wait in the data app.

### Preview builds

1. Previews of one run talk to each other, as in the handover: the
   workflow signs them with one key. A preview never talks to a real
   app.
2. A preview of the Sync app joins whatever server the tester types.
   Testers use a server and words made for testing
   ([test-a-pull-request.md](../development/test-a-pull-request.md#safety)).

## The sealed record

One encoding serves a backup and sync. The plaintext of a sealed
record is the record entry of a backup, with five bytes before it and
a stream part after it.

| Size | Content |
|---|---|
| 1 | Version of this layout: `01` |
| 4 | The data version of the app that sealed it, 1 to 2,147,483,647 |
| 39 + T + N, or 8 more | The Record entry of [backup-format.md](backup-format.md#record), from its tag `02` to the end of its content |
| 1 | `00`: the record has no stream. `01`: it has one. |
| 8 | The length of the stream. Only there after `01`. |
| 32 | The SHA-256 of the stream. Only there after `01`. |

1. The data app seals it with `RecordSealer.seal`, under the record's
   ID. The blob is
   [kind 1](../security/crypto-design.md#kind-1-sealed-record): 50
   bytes longer than the plaintext.
2. The record ID is inside the entry and next to the blob. A reader
   opens the blob with the ID that came next to it, and then checks
   that the ID inside is the same.
3. The change number is never in it.
4. A record of a file has `01`, with the length and the hash of the
   file's stored stream as it is on the phone
   ([Files](#files)). A wiped record of a file has `00`.
5. A sealed record is at most 524,288 bytes. Notes' largest is about
   401,000. A record that would be larger is not sent. The app counts
   it and says so in `status`. An app whose records can be larger
   says in its specification what it does about that, before it
   syncs.

Next to the blob, in the clear, travel only: the app's name, the
record ID, and the number the server gave. Not the type, not the
times, not whether the record is deleted.

### What a reader checks

In this order. Each "skipped" is one of
[Records that are skipped](#records-that-are-skipped).

1. The app's `record` keyset can be used now. If not, `import` fails
   as a whole: nothing is written, the cursor stays, and the Sync app
   tries again later.
2. The blob names, in its bytes 6 to 9, the key ID the app syncs
   with. Another key ID: skipped, "another recovery key".
   [A new recovery key](#a-new-recovery-key) has the one exception,
   its last fetch.
3. The blob opens with the app's `record` keyset and the record ID.
   If Tink refuses it: skipped, "damaged".
4. The version byte is `01`. A higher one: skipped, "newer".
5. The data version is not above the app's own. A higher one:
   skipped, "newer".
6. The entry is whole, with nothing left over after the stream part.
   The ID inside is the ID outside. The type is one the app has in
   that data version. The three times are ones a record can hold. The
   content passes every check the app makes on a record of a backup
   of that data version. A stream part is there exactly when the
   record is a file's that is not wiped, and its length is the one
   the record's own size gives. Anything else: skipped, "not valid".
7. A record of a lower data version is read by the app's reader for
   that version, as in a restore. The app then holds it as it holds
   every record of its own version.

## The server interface

Version 1. Every path starts with `/v1/`.

### The connection

Decided by the owner.

1. HTTPS only. The Sync app's manifest forbids cleartext traffic.
2. The Sync app trusts only the certificate authorities built into
   Android. It trusts none that a user added. Its network security
   configuration says so.
3. No pin. The server's certificate comes from Cloudflare and changes
   every few months, and a user's own domain has another one. A pin
   would stop sync for everyone when an authority changes. A false
   certificate gives an attacker only what the server has, and this
   page trusts the server with nothing.
4. The Sync app follows no redirect. It talks only to the address the
   user typed: `https://`, a host name and, if needed, a port.
5. Certificate transparency is checked where Android checks it.
6. The Sync app uses Android's own HTTP client. It adds no HTTP
   library. It sends one fixed `User-Agent`, the same on every phone,
   so that a request does not name the phone's model.
7. A request body and an answer body are bytes, with the layouts of
   this page. Nothing is JSON.

### Signed requests

Every request but `info` is signed with the device key. Three headers
carry it:

| Header | Value |
|---|---|
| `shk-device` | The device ID, 32 hex digits |
| `shk-time` | The device's clock, as a decimal number |
| `shk-signature` | The signature, 128 hex digits |

The bytes that are signed:

| Offset | Size | Content |
|---|---|---|
| 0 | 7 | `SHKSYNC` |
| 7 | 1 | Version: `01` |
| 8 | 1 | Type: `10`, a request |
| 9 | 16 | The server ID |
| 25 | 16 | The device ID |
| 41 | 8 | The time of `shk-time` |
| 49 | 1 | The method: `01` GET, `02` POST |
| 50 | 2 | P, the length of the path and the query |
| 52 | P | The path and the query, exactly as sent, ASCII |
| 52 + P | 32 | The SHA-256 of the signed part of the body |

1. The signed part of the body is the whole body. The one exception
   is [`files/send`](#filessend), where it ends before the chunks.
   With no body it is the SHA-256 of nothing.
2. The server checks, in this order: that it is not closed; that the
   device is one of its own and not removed; that the time is within
   5 minutes of its own clock; and the signature. For the signature
   it puts the bytes above together itself, with the hash that it
   computes from the signed part of the body. No hash is sent.
3. A request that is caught and sent again within those 5 minutes
   does no harm (rule 7).
4. The Worker never hashes a file chunk. The chunk's hash is in the
   signed part, and R2 checks it when it stores the chunk.

### Answers

Every answer of the Worker has HTTP status 200 and a body that starts
with one answer byte.

| Byte | Meaning | Then | What the device does |
|---|---|---|---|
| `00` | Done | What the call says | Goes on |
| `01` | The server does not speak this version | The lowest and the highest version it speaks, 1 byte each | Says "Update the Sync app", or "Update your server", and makes no more requests until one of them changed |
| `02` | Not a device of this server | Nothing | Says so, and makes no more requests. The user joins again. |
| `03` | This device was removed | Nothing | Says so, deletes its device key, and makes no more requests. The user can join again as a new device. |
| `04` | The request does not check: its signature or its layout | Nothing | Tries once more. Then says that sync has a fault, and waits. |
| `05` | The clock | The server's clock, 8 bytes | Says "This phone's clock is off by …", and waits |
| `06` | Closed: this server was closed for all devices | Nothing | Says so, and makes no more requests to this server. No data on the phone changes. |
| `07` | The day's writes are used | `01`: only for a comparison of everything. `02`: for all. | Waits until 00:00 UTC. After `01` it still sends ordinary batches. |
| `08` | The server is full | Nothing | Says so. Sending waits. Fetching goes on while the server can still answer it. |
| `09` | The code is wrong, used or too old | Nothing | Asks for a code again |
| `0A` | The statement is not of this account | The current key ID, 4 bytes | Says which recovery key the server belongs to |
| `0B` | Another epoch | The epoch, 16 bytes | Drops what it was doing. Every app starts a [comparison of everything](#comparing-everything). |
| `0C` | Too much in one request | Nothing | Reads `info` again and asks for less |

An answer with another status, or without a known answer byte, did
not come from the Worker. Cloudflare sends such answers when the
day's requests are used, when a request ran out of CPU time, and when
something is down.

1. The day's requests are used: the Sync app waits until 00:00 UTC.
2. Out of CPU time: the Sync app halves what it puts into one request
   or asks for in one page, down to one record, and tries again. It
   grows again after a day.
3. Anything else: the next periodic run tries again. After three
   failed runs in a row, the Sync app tries only every 4 hours until
   one works. The user can always ask for a run.

How the Sync app tells the first two apart is checked when the server
is built ([Assumptions](#assumptions)).

### `info`

`GET /v1/info`. Not signed. Anyone who knows the address can ask.

| Size | Content |
|---|---|
| 1 | `00` |
| 1 | The lowest version of this interface the server speaks |
| 1 | The highest |
| 16 | The server ID |
| 8 | The server's clock |
| 1 | `00`: no account yet. `01`: in use. `02`: closed. |
| 4 | The most records in one batch or page, 1 to 100 |
| 4 | The most bytes of blobs in one batch or page, 65,536 to 524,288 |
| 4 | The most chunks in one file request, 1 to 256 |

A device obeys the last three inside these bounds, and treats a value
outside them as the nearest bound.

The byte limit only says how many records go together. One record
alone always fits, in a batch and in a page, whatever this limit
says, up to the 524,288 bytes of the format. So a record that the
server once stored can always be fetched, and a record that an app
may seal can always be sent.

### `enrol`

`POST /v1/enrol`. Signed with the device key that the statement
holds.

| Size | Content |
|---|---|
| 1 | The kind of code: `01` device code, `02` setup code |
| 1 | C, the length of the code |
| C | The code, ASCII |
| 2 | S, the length of the statement |
| S | The join statement |
| 64 | The account key's signature of the statement |
| 32 | The account public key |
| 2 | N, the length of the sealed name, 52 to 211 |
| N | The device's sealed name |

The answer is `00` and the epoch, or `03`, `04`, `05`, `06`, `09` or
`0A`. What the server checks, and in which order, is under
[Joining](#joining). A device that is in already gets `00` again,
whatever its code: so an answer that was lost costs no second code.

### `enrol-code`

`POST /v1/enrol-code`, with no body. The answer is `00`, the 8
characters of a new device code, and the time it ends, 8 bytes. The
server keeps the hash of the code, its end, and how many wrong tries
are left.

### `devices`

`GET /v1/devices`. The answer is `00`, a count of 2 bytes, and for
each device:

| Size | Content |
|---|---|
| 16 | The device ID |
| 65 | Its public key |
| 1 | `01`: in. `02`: removed. |
| 8 | When it was added, by the server's clock |
| 8 | The day it was last seen, as the first millisecond of that day, UTC |
| 2 | N |
| N | Its sealed name |

`POST /v1/devices/remove`, with a device ID of 16 bytes, removes that
device. `POST /v1/devices/name`, with N (2 bytes, 52 to 211) and a
sealed name, gives the calling device a new name. Both answer `00`.

### `heads`

`GET /v1/heads`. The check a device makes when it has nothing to
send.

| Size | Content |
|---|---|
| 1 | `00` |
| 16 | The epoch |
| 4 | The current key ID |
| 8 | The account revision |
| 1 | How many apps follow |
| ... | For each app: A (1 byte), the app's name (A bytes), its head (8 bytes), and the highest number the server told this device for it (8 bytes) |

1. The Sync app remembers the head it last saw for each app, so that
   it need not wake a data app whose head did not move and that has
   nothing to do
   ([When the Sync app runs](#when-the-sync-app-runs), point 2).
2. It also compares, for each app, the number the server says it told
   this device with the app's Known. If the server's number is lower,
   the server lost something, even when the head is the app's cursor
   again. The Sync app then fetches for that app, and the fetch makes
   the server start a new epoch ([The epoch](#the-epoch)).
3. An app that the answer does not name has the head 0, and the
   server told this device 0 for it. So an app that the server no
   longer knows is found in the same way.
4. The account revision is a number that goes up by one, in the same
   step, whenever a device joins, is renamed or removed, a setup code
   is used, or the account key changes. Each Sync app remembers the
   highest one it saw. A lower one means that the server was put back
   to an earlier time. The Sync app then reads the list of devices,
   removes again every device it knows was removed
   ([Removing a device](#removing-a-device)), and tells the user:
   "The server was put back to an earlier time. Check the list of
   devices."

### Fetch

`GET /v1/changes?app=<name>&since=<number>&known=<number>&epoch=<32 hex digits>&most=<1 to 100>`.
The numbers are decimal. The answer is a page:

| Size | Content |
|---|---|
| 1 | `00` |
| 16 | The epoch |
| 8 | Since: the number the request gave |
| 8 | Through |
| 1 | `01` if more records wait above Through, else `00` |
| 4 | How many records follow, 0 to 100 |
| ... | The records |

Each record:

| Size | Content |
|---|---|
| 16 | The record ID |
| 8 | Its number |
| 4 | L |
| L | The sealed record |

1. The page holds the app's records whose number is above Since,
   lowest number first, until it holds `most` records or a limit of
   `info` is reached. When a record waits, the page holds at least
   one, also when that record alone is over the byte limit of `info`.
2. Through is the number of the last record of a page that was cut.
   Else it is the app's head.
3. The server reads the records and the head in one step, so no
   record can get a number at or below Through after the page was
   read.
4. If the request's epoch is not the server's, the answer is `0B`
   with the server's epoch. No new epoch is made.
5. If Known is above what the server told this device for this app,
   the server has lost something. It makes a new epoch and answers
   `0B` ([The epoch](#the-epoch)).
6. The server remembers Through as the highest number it told this
   device for this app, if it is higher than before.

### Send

`POST /v1/changes?app=<name>`. The body is a [batch](#a-batch) from
its epoch on:

| Size | Content |
|---|---|
| 16 | The epoch the batch was made under |
| 8 | The cursor the batch was made at |
| 8 | Known |
| 1 | `01` for records of a comparison of everything, else `00` |
| 4 | How many records follow, 1 to 100 |
| ... | The records: ID (16), L (4), the sealed record (L) |

The answer:

| Size | Content |
|---|---|
| 1 | `00` |
| 16 | The epoch |
| 8 | The app's head before this batch |
| 8 | The app's head after it |
| 4 | How many results follow: one for each record, in order |
| ... | For each record: one result byte, and after `00` or `04` its new number (8 bytes) |

| Result | Meaning |
|---|---|
| `00` | Stored, under the number that follows |
| `01` | Not stored: the server's copy changed after the batch's cursor |
| `02` | Not stored: the blob names another key ID than the current one |
| `03` | Not stored: not a sealed record of 50 to 524,288 bytes |
| `04` | Stored, under the number that follows. The chunks of this record's file were deleted before: the stream must be sent again. |

1. If the batch's epoch is not the server's, the answer is `0B` with
   the server's epoch, and no new epoch is made. If Known is above
   what the server told this device for this app, the server makes a
   new epoch and answers `0B`, as for a fetch.
2. The server does all of a batch in one step. It stores a record
   only if it has no copy of it, or its copy's number is at or below
   the batch's cursor.
3. A stored record replaces the server's copy and gets a number above
   the app's head. Numbers go up in the order of the batch. They need
   not follow each other without a gap.
4. The server looks at a blob only this far: its length, its first
   six bytes `53 48 4B 01 01 01`, and its key ID in bytes 6 to 9.
5. A batch of a comparison of everything that would pass 70,000 row
   writes of the day is answered `07` with `01`. A batch that is over
   a limit of `info` is answered `0C`, but never a batch of one
   record.
6. The server remembers the head after the batch as the highest
   number it told this device for this app.
7. A record that is stored over one marked "its chunks were deleted"
   gets the result `04`, and the mark is taken off
   ([`files/delete`](#fileshave-filesfetch-filesdelete)).

### `files/send`

`POST /v1/files/send?app=<name>`.

| Size | Content |
|---|---|
| 2 | How many chunks follow, 1 to 256 |
| 88 each | For each chunk: the file ID (16), the stream's SHA-256 (32), the chunk's number (4), its length (4), its SHA-256 (32) |
| ... | The bytes of the chunks, in the same order |

1. The signed part of the body ends before the bytes of the chunks.
2. The chunks of one request are at most 4,194,304 bytes together.
3. The server stores each chunk as one object in R2, and R2 checks
   the chunk's SHA-256. The object's name is the app's name, the file
   ID as 32 hex digits, the stream's hash as 64 hex digits and the
   chunk's number in decimal, with `/` between them.
4. The answer is `00` and one byte for each chunk: `00` stored, `01`
   the hash did not fit. Storing the same chunk again changes
   nothing.

### `files/have`, `files/fetch`, `files/delete`

`POST /v1/files/have?app=<name>`: a count of 2 bytes, 1 to 256, and
for each stream its file ID (16) and its hash (32). The answer is
`00` and, for each stream, 4 bytes: how many of its chunks the server
has, counted from chunk 0 without a gap.

`POST /v1/files/fetch?app=<name>`: a count of 2 bytes, 1 to 256, and
for each chunk its file ID (16), the stream's hash (32) and the
chunk's number (4). The answer is `00`, then for each chunk one byte,
`00` here or `01` not here, and after `00` its length (4). Then come
the bytes of the chunks that are here, in order. A device asks for at
most 4,194,304 bytes at once. It knows each length before it asks. A
request for more is answered `0C`.

`POST /v1/files/delete?app=<name>`: a count of 2 bytes, 1 to 256, and
for each file its ID (16) and the number under which the device's
batch stored the file's deleted record (8). The answer is `00` and
one byte for each file: `00` deleted, `01` not deleted.

1. The server deletes a file's chunks only if its copy of the record
   with that ID still has that number. If the record changed since,
   another device stored a newer version, and nothing is deleted.
2. Before it deletes the chunks, and in the same step as that check,
   the server marks the record: "its chunks were deleted". A record
   that is later stored over a marked one gets the result `04`
   ([Send](#send)), so that the device that sent it sends the stream
   again.
3. Deleting again changes nothing.

### `account-key`

`POST /v1/account-key`: S (2 bytes), a new account key statement, and
the signature of the account key the server has now (64 bytes).

1. The server checks the statement: its layout, type `02`, its own ID
   and address, the signing key ID, which must be the current one,
   and the signature.
2. It then stores the new account public key and the new key ID as
   the current ones. The devices stay as they are.
3. The answer is `00`. It is also `00` when the statement's new key
   is the current one already. A statement signed by a key that is
   not the current one gets `0A`.

### `account/delete`

`POST /v1/account/delete`, with the server ID (16 bytes) as its body.

1. In one step the server marks itself closed and deletes its
   devices, its codes and the account public key. The answer is `00`.
2. From then on it answers `06` to every request but `info`, without
   checking who asks.
3. It does not delete the records and the chunks one by one. On the
   free plan that would take days of row writes. They go when the
   user deletes the database and the bucket in the Cloudflare
   dashboard
   ([Closing the server](#closing-the-server-and-deleting-everything)).
4. A closed server stays closed. To sync again the user deploys a new
   one.

### What the server stores

| Where | What | Written |
|---|---|---|
| D1, one row | The server ID, the epoch, the state, the account public key, the current key ID, the account revision | When it is first run, on a new epoch, on closing, and whenever a device joins, is renamed or removed, a setup code is used or the account key changes |
| D1, a row for each device | Its ID, public key, sealed name, state, when added, last day seen | On join, rename, remove, and once on each day the device calls |
| D1, a row for each app | The app's head | With every stored batch |
| D1, a row for each device and app | The highest number the server told it | With every page and every stored batch that moves it |
| D1, a row for each record | The app, the record ID, its number, the blob, and the mark "its chunks were deleted". An index on app and number. | With every stored record: two row writes. One more when a file's chunks are deleted. |
| D1, a few rows | The device code's hash, the hashes of used setup codes, the row writes of the day | When a code is made or used, with every stored batch |
| R2 | One object for each chunk | When a chunk is sent |

1. The server keeps one blob for each record: the last one stored.
   It keeps no older version.
2. No table has a hidden row ID, and only the records have an index.
   So a stored record costs two row writes, and every other write on
   this page costs one. A test asserts the row writes of each call.
3. D1's read copies in other regions stay off. A copy that lags would
   show a head below a device's cursor.
4. The server logs nothing about a request: no ID, no name, no
   address.

## Numbers, cursors and the epoch

### Numbers

1. The server gives every stored record the next number of its app.
   Numbers only go up. A record that is stored again gets a new, higher
   number and moves to the end of the order.
2. A number says in which order the server stored things. It says
   nothing about which version is newer. Only `updatedAt` inside the
   sealed record does.
3. A device never trusts a number. A wrong number can make a device
   fetch too much or too little, which is what a server that holds
   records back does anyway
   ([Attacks considered](#attacks-considered)).

### The cursor

1. Each data app keeps its cursor in its own database, together with
   the server ID, the epoch and the device ID it belongs to
   ([What a data app keeps for sync](#what-a-data-app-keeps-for-sync)).
   Next to it the app keeps **Known**: the highest number the server
   ever told it, as the Through of a page or as the head after a
   batch. Known is never below the cursor.
2. The cursor moves forward in two ways only:
   - `import` sets it to the page's Through, in the same write
     transaction that takes the page's records;
   - `exported` sets it to the head after the batch, if the head
     before the batch was the cursor. Then nothing but this batch
     lies between.
3. It moves back only to the
   [first skipped number](#records-that-are-skipped), and to 0.
4. If the server ID, the epoch or the device ID is not the stored
   one, the cursor and Known are 0 and the app
   [compares everything](#comparing-everything). So a device that
   joined again starts from 0.
5. The Sync app fetches for an app whenever the app's head is not its
   cursor. A head above the cursor means there is something to fetch.
   A head below the cursor means the server lost something, and the
   fetch makes the server say so. It also fetches when `heads` shows
   that the server told this device less than the app's Known
   ([`heads`](#heads), point 2).

### The epoch

1. The server makes its ID and its first epoch when its database is
   first used.
2. Every fetch and every batch carries Known. If Known is above the
   highest number the server remembers having told that device for
   that app, the server lost something. That happens when the user
   puts the database back to an earlier time. The server then makes a
   new epoch, forgets what it told every device, and answers `0B`.
3. A device learns of a new epoch from `heads` or from `0B`. Each of
   its data apps then compares everything. So whatever the server
   lost is sent again by a device that has it.
4. Putting the database back also brings back what changed since: a
   device that was removed is in again, a used setup code is good
   again, and the account key is the older one. No record's number
   moves by that. So the server also keeps an account revision
   ([`heads`](#heads), point 4). A device that knows a higher one
   removes the removed devices again and tells the user. A device
   whose keeper holds both recovery keys sends the new account key
   statement again ([A new recovery key](#a-new-recovery-key)).
5. The user can also ask for a comparison of everything in the Sync
   app, on any device, at any time.
6. A server that changes its epoch again and again only makes the
   devices work.

## Sending and fetching

### What a data app keeps for sync

One small table in the data app's own database. It is not a record,
it is never in a backup, and it is never synced.

| What | For |
|---|---|
| The server ID, the epoch, the device ID | What the rest belongs to |
| The cursor, and Known | Fetching, and the proof that a server lost something |
| The key ID the app syncs with | [A new recovery key](#a-new-recovery-key) |
| The send mark | The change number up to which every local change was looked at |
| Just taken | Each record that `takeFromSync` wrote, with the change number it got, until the send mark has passed it |
| To send | The IDs of records that must go to the server. Each is marked "ordinary" or "comparison". |
| Skipped | The lowest number of a record that was skipped and may open later, the counts by reason, and the IDs of records whose damaged version was answered |
| Comparison | Its state: none, fetching or sending. While it fetches: the IDs it has seen on the server. |
| Streams | For each file: its stream's hash, whether the server is known to have it, whether it is to be deleted there and the number its deleted record was stored under, and how many bytes of a fetch are here |
| Stopped | Why the app sends nothing now, if so |

It is in the same database as the records, so that a cursor and the
records it stands for can never be apart
([data.md](data.md#the-change-number), point 8).

### Sending

`export` works in one transaction of the app's database:

1. It reads the changes above the send mark, lowest change number
   first (`changedSince`). A record that is in **Just taken** with
   exactly that change number came from sync, and is passed over.
   The ID of every other record goes into **To send** as "ordinary".
   The send mark moves past each change that was dealt with.
2. It goes on until **To send** holds enough for one batch of the
   kind the Sync app asked for, or no change is left.
3. It builds the batch from **To send**: "ordinary" records, or
   "comparison" records, as asked, up to the limits the Sync app
   gave. A record stays in **To send** until the server has stored
   it.
4. It leaves out a record that is held back. Held back are:
   - in an app that wipes, a deleted record that is not wiped yet
     ([Conflict rules](#conflict-rules), point 9);
   - a file's record whose stream the server is not known to have
     ([Files](#files));
   - a file's record whose wrapped key does not name the key ID the
     app syncs with;
   - every file's record while a file key is sealed by a key that
     exists only on this phone
     ([crypto-design.md](../security/crypto-design.md#the-file-key-keyset-without-a-recovery-key),
     point 5).
5. A record whose blob would be over the 524,288 bytes of the format
   is taken out of **To send**, and counted.
6. While the app has stopped sending, `export` gives nothing.
7. The token names this batch. The next `export` voids it.

The batch's records, its cursor and Known come from that one
transaction.

`exported` then, in one transaction, for the batch its token names:

1. takes each stored record out of **To send**, and keeps the number
   of a file's deleted record. After a result `04` the file's stream
   counts as not known to be on the server;
2. leaves each record that was refused with `01` in **To send**. If
   it is a file's record, its stream counts as not known to be on the
   server;
3. takes each record that was refused with `03` out of **To send**,
   and counts it;
4. after a `02`, stops the app: "needs the new recovery key";
5. sets Known to the head after the batch, and moves the cursor if it
   may ([The cursor](#the-cursor), point 2).

After a batch with a refusal `01`, the Sync app fetches to the head
before it asks that app for the next batch. The fetch brings the
version that was in the way, and the merge decides.

A record that changes while its batch is on the way has a change
number above the send mark. The next `export` finds it and puts it
into **To send** again.

If the Sync app stops between a batch and its `exported`, the records
are still in **To send**. They go again and are refused with `01`,
and the fetch that follows finds them "the same".

### Fetching

1. The Sync app fetches for an app when the app's head is not its
   cursor, after a refusal, and in a comparison of everything.
2. It hands each page to `import`. The data app checks the page
   ([A page](#a-page)). Then, in one write transaction, it puts every
   record through [What a reader checks](#what-a-reader-checks) and
   [`takeFromSync`](#conflict-rules), and sets the cursor and Known
   to Through. A failure rolls the whole page back.
3. It goes on while a page says that more wait.
4. After the last page the app sets its alarms again, as after a
   restore, and lists the streams it wants. It changes no record
   then ([Conflict rules](#conflict-rules), point 10).

### Comparing everything

The way to make the server and a device agree from nothing. It runs:

- when sync is first turned on in an app on a device;
- when the server ID, the epoch or the device ID changed;
- after the app took [new keys](#a-new-recovery-key);
- when the user asks for it in the Sync app (`compare`).

The steps:

1. The cursor and Known are 0. The comparison is "fetching". The seen
   IDs are empty. Every stream counts as not known to be on the
   server.
2. Fetch every page. For each record whose server copy the app took,
   or found the same as its own, the app adds the ID to the seen IDs.
3. The page that says that no more wait ends the fetching. In the
   same transaction that takes it, every stored record whose ID is
   not seen goes into **To send** as "comparison": the server does
   not have it, or has a version that loses, or one that this app
   does not take. The comparison is now "sending", and the seen IDs
   are dropped.
4. The Sync app asks for batches of "comparison" records after the
   ordinary ones. The server may stop such batches for the day, so
   that ordinary changes still get through
   ([The free plan](#the-free-plan)).
5. `streams` lists every stream the app has. The Sync app asks the
   server which of them it has, and sends the others
   ([Sending a file](#sending-a-file)).
6. When no "comparison" record is left in **To send**, the comparison
   is over.

A comparison can stop at any step and go on later: all of its state
is in the table above. Local changes made while it runs are
"ordinary" and go out first. A record of a comparison that the user
changes becomes "ordinary".

## Conflict rules

Conflicts are decided on the device, record by record, by a new
`RecordWriter` function, `takeFromSync`
([ADR 0027](../adr/0027-record-fields-and-stamping.md) gives sync its
own). It gets a record that passed
[What a reader checks](#what-a-reader-checks).

| Answer | When | What is written |
|---|---|---|
| Taken | No record with this ID is stored, or the one that came wins | The record that came. It gets a new change number, which goes into **Just taken**. The ID leaves **To send**. |
| The same | The stored record and the one that came are the same | Nothing. The ID leaves **To send**. |
| The stored one wins | The stored record wins | Nothing to the record. The ID goes into **To send** as "ordinary". If the stored record is a file's and not deleted, and the one that came is deleted, the file's stream counts as not known to be on the server. |

Which record wins:

1. The one with the later `updatedAt`.
2. With the same `updatedAt`, the first of these that tells them
   apart:
   1. A record that is not deleted wins over a deleted one. Decided
      by the owner: nothing the user typed is lost.
   2. Of two deleted records, the wiped one wins
      ([ADR 0042](../adr/0042-wiping-the-content-of-deleted-records.md)).
      Each app says what its wiped form is.
   3. Of two records with a wrapped file key, the one whose wrapped
      key names the key ID the app syncs with wins. The key ID is in
      the clear in bytes 6 to 9 of the wrapped key, so this works
      while the app is locked.
   4. The one whose plaintext is larger wins: the two plaintexts of
      [The sealed record](#the-sealed-record), as this app writes
      them in its own data version, compared byte by byte as unsigned
      numbers. If one is the start of the other, the longer one is
      larger.
3. This order belongs to version `01` of the plaintext. A change to
   it is a format change.

Rules that keep every device ending the same:

4. A write that keeps `updatedAt` must make a record that wins step 2
   over the one it replaced. A wipe does (step 2.2). Sealing a file
   key again under the current key does (step 2.3). No other write
   keeps `updatedAt`.
5. The record keeps its `id`, `createdAt`, `updatedAt` and
   `deletedAt` as they came. The clock and the ID source are not
   used. It gets the next change number of this database only when it
   is written.
6. Taking the same records twice writes nothing the second time. The
   order in which records arrive does not change the end.
7. A record that came from sync is not sent back: **Just taken**
   makes `export` pass it over. This only saves work. Without it the
   exchange would still end, because "the same" writes nothing.
8. A tie with a record that came sealed in a lower data version than
   the app's own: the winner goes into **To send**, and so goes out
   sealed in the app's own version. Devices on two versions of an app
   then end the same once both are updated.
9. An app that wipes sends a deleted record only in its wiped form. A
   deleted record that is not wiped yet is held back. Otherwise
   another device could wipe it while **Undo** is still open on the
   first device, and **Undo** would bring back an empty record. Today
   only Notes wipes.
10. An app writes to a record only for the user's own action on that
    record, or to wipe it, or to seal its file key again. It never
    deletes or changes a record because another record is deleted or
    missing. Such a write would carry the time of now, win on every
    device, and could destroy a record that another device just
    added. Notes' sweep marks the files of a deleted note as deleted.
    That has to change before Notes syncs
    ([Open questions](#open-questions), question 4).
11. Records may arrive in any order, and one may never arrive. A
    record can name another record that is not here, for example a
    file whose note has not come yet. Each app says in its
    specification what it shows then, before it syncs.
12. A device whose clock is more than 5 minutes off cannot sync
    ([Answers](#answers), `05`). So the clocks that stamp `updatedAt`
    are close when devices sync, and "later" is close to true. A
    record that was stamped with a wrong clock keeps its stamp. The
    next edit on a device that has that version still wins over it,
    because `updatedAt` only moves forward
    ([data.md](data.md#writing-records)).
13. These rules are about two versions of one record. Where an app
    must pick one of two different records with the same `updatedAt`,
    for example the settings record in use
    ([ADR 0036](../adr/0036-app-settings-as-records.md), point 2), the
    one with the larger `id` counts, as Water's specification says.
    Every device picks the same.

What follows for the user: the last edit of a record wins as a whole.
Two devices that edit the same note at the same time keep one of the
two texts.

### Records that are skipped

A record that does not pass
[What a reader checks](#what-a-reader-checks) is never written. The
cursor still moves past it.

| Reason | What the app does | When it looks again |
|---|---|---|
| Another recovery key: the blob names a key ID that is not the one the app syncs with | Counts it. If the app syncs with the server's current key and stores this record, the ID goes into **To send**. Else nothing is sent in answer. | When the app has taken new keys |
| Damaged: the key is right and Tink refuses the blob | Counts it. If the app stores this record, the ID goes into **To send**, and the app notes the ID. It does not answer a damaged version of that record again until a version of it opens. | When a new version comes |
| Newer: a higher version byte or data version | Counts it. The app stops sending, so that an older app cannot write over a field it does not know. | When the app was updated |
| Not valid: it opens, but breaks a limit or a layout | Counts it. | When a new version comes |

1. The app remembers the lowest number among the records it skipped
   for "another recovery key" and "newer". When it has taken new
   keys, or was updated, it sets its cursor back to just below that
   number and fetches again.
2. `status` gives the counts. The Sync app and the data app's own
   **Sync** setting say what to do: "Enter the new recovery key in
   Water", "Update Water".
3. No count and no message holds a record ID or any content.

## Files

1. A file is encrypted once, into its stream
   ([crypto-design.md](../security/crypto-design.md#file-keys)). The
   same bytes are on the phone, on the server and on every other
   device. Nothing encrypts a stream again, and the Sync app holds no
   key for it.
2. The file's key travels only inside the file's sealed record, as a
   wrapped file key.
3. The stream's length and its SHA-256 are inside the same sealed
   record ([The sealed record](#the-sealed-record)). The data app
   computes the hash from the stored stream when it first needs it,
   and keeps it.

### Chunks

1. A stream is cut into chunks of 4,194,304 bytes. The last chunk is
   what is left, at least one byte. Chunk 0 starts at byte 0 of the
   stream.
2. A chunk is named by the app, the file ID, the stream's hash and
   its number ([`files/send`](#filessend)). A stream with other bytes
   has another hash and so other names. Chunks are never changed.
3. One request carries one or more chunks, at most 4,194,304 bytes
   together. So one chunk of a large file fills a request, and many
   small files share one.

### Sending a file

1. `streams` lists the streams the app wants sent: the streams of
   file records that are not deleted, that are on the phone, and that
   the server is not known to have.
2. For those the Sync app asks the server which chunks it has
   ([`files/have`](#fileshave-filesfetch-filesdelete)). It reads each
   stream through `readStream`, cuts it, and sends the chunks the
   server lacks.
3. Before it sends any chunk of a stream, the Sync app hashes what
   `readStream` gives. If the SHA-256 is not the one that `streams`
   named, the stored file changed after its hash was taken. The Sync
   app then sends nothing of that stream and says so in `streamSent`.
   The data app counts the stream as not on this phone, and wants it
   fetched ([Fetching a file](#fetching-a-file)). So damaged bytes
   never go to the server under the name of the good stream.
4. When every chunk of a stream is on the server, the Sync app calls
   `streamSent`. Only then does the file's record go into a batch.
   So an honest server never has a record whose file is missing.
5. A send that stops goes on at the first chunk that is not stored.
6. The app forgets that the server has a stream when a comparison of
   everything starts, when the file's record was refused, and when
   the file's record, not deleted, won over a deleted one
   ([Conflict rules](#conflict-rules)). It then lists the stream
   again. Another device may have asked the server to delete it.

### Fetching a file

1. After a page, the app wants the stream of each file record that is
   not deleted and whose stream is not on the phone. `streams` lists
   them, each with its length, its hash and how many bytes are here.
2. The Sync app fetches the missing chunks and writes them through
   `writeStream`, in order. A fetch that stops goes on where the
   bytes end.
3. `finishStream`: the data app checks the length and the SHA-256 of
   the whole stream. If both fit, it moves the stream in, as after a
   restore. If not, it deletes the bytes, counts it, and wants the
   stream again, at most once a day.
4. The Sync app fetches only what a data app lists, never more bytes
   than the listed length, and keeps nothing that a data app did not
   take. So a server cannot fill a phone with bytes that no record
   names. This answers
   [crypto-design.md](../security/crypto-design.md#open-questions),
   question 9.
5. Until its stream is here, a file's record is on the phone without
   its file. Notes shows "Not on this phone"
   ([Notes' spec](../apps/notes/spec.md#files-that-cannot-be-opened)).
6. The stream is still checked segment by segment when the file is
   opened, as every stream is.

### Removing a file

1. A device asks the server to delete a file's chunks only when its
   own batch stored the file's deleted record there, wiped where the
   app wipes. The app then lists the file in `streams` as "to
   delete", with the number that record got. The Sync app calls
   `files/delete`, and then `streamDeleted`.
2. The server deletes the chunks only while that deleted record is
   still its copy. So a deletion that lost against a newer version of
   the file's record deletes no chunks, however late the request
   comes.
3. If another device brings the file back after the chunks were
   deleted, its batch gets the result `04`, and that device sends the
   stream again.
4. Every other device removes its own copy of the stream when it
   takes the deleted record.
5. A server that keeps the chunks keeps bytes it cannot open.

## Deletion markers

Decided by the owner: a deletion marker is never purged in this
version. Not on a device, and not on the server.

1. A deleted record stays as a row with `deletedAt` set, and goes to
   the server and to every device like any other record. In an app
   that wipes, its content is gone and the row is small.
2. Why never: the marker is the only proof that a record was deleted.
   Without it, any older copy brings the record back: a device that
   was offline for a year, a backup made before the deletion, or a
   server that replays what it kept.
3. What it costs: one row on each device and one on the server for
   each deleted record, for good. Reminders and Tasks do not wipe, so
   the titles of their deleted items stay in those rows.
4. [backup-format.md](backup-format.md#the-restore-rule) stays right:
   an old backup cannot bring a deleted record back, because the
   marker is newer.
5. A later version may purge. It would need at least: a proof from
   every device of the account that it has taken the marker; a rule
   for a device that comes back after the purge; and a rule for
   backups made before it. Each is a format change with its own
   decision record. `@PurgesDeletedRecords` in `core/data` stays
   unused until then.

## The free plan

The design keeps to the limits of Cloudflare's free plan
([ADR 0009](../adr/0009-sync-protocol-and-server.md) says when they
were read).

| Limit | What uses it |
|---|---|
| 100,000 requests a day | Every check, page, batch and file request is one |
| 10 ms of CPU time for a request | One signature check, one hash of a body of at most about 526,000 bytes, and reading one batch |
| 100,000 row writes a day in D1 | Two for each stored record, three for each batch, one for each page that is fetched |
| 5,000,000 row reads a day in D1 | A few for each request, and one or two for each record sent or fetched |
| 500 MB in one D1 database | The latest sealed version of every record |
| 10 GB in R2 | The chunks of every file |
| 1,000,000 writes a month in R2 | One for each chunk sent |
| 10,000,000 reads a month in R2 | One for each chunk fetched or asked for |

What that means:

1. **A quiet day.** A device that has nothing to send makes one
   request, `heads`, at each run. It costs a few row reads and no
   write. Three devices that run every 15 minutes make 288 requests a
   day.
2. **An ordinary change** is one batch: one request and five row
   writes for one record. Each other device then fetches one page,
   which costs one row write.
3. **A full batch** of 100 records costs 203 row writes. So a day
   holds about 49,000 stored records.
4. **A comparison of everything** is held to 70,000 row writes a day,
   about 34,000 records, so that ordinary changes still get through.
   The server counts the row writes it makes in a day. Notes at its
   limits has 105,000 records. Its first sync takes a little over
   three days and goes on by itself.
5. **Files.** 1 GB of files is at least 239 requests. 100,000 small
   files go 256 to a request, so about 400 requests and 100,000
   writes in R2.
6. **When a limit is reached**, the server says so
   ([Answers](#answers), `07` and `08`), or Cloudflare does. The
   device waits. Nothing is lost: the changes wait in the data apps.
7. **Size.** 500 MB holds, for example, 1,200 notes of the largest
   size, or millions of small records. The server answers "full"
   when D1 refuses a write. What the user can do then is in the
   self-hosting guide.
8. **CPU time** cannot be shown in a local test. It is measured on a
   deployed Worker on the free plan when the server is built. The
   limits that `info` names are set by that measurement. They may
   only be lower than the numbers on this page, and they only say how
   many records go together. One request must always take one record
   of 524,288 bytes. If the measurement shows that it cannot, the
   largest sealed record on this page changes before any server is
   used.
9. Anyone who knows the server's address can use up its requests of
   a day with requests that fail. The data is safe, and sync goes on
   the next day. The self-hosting guide says how to turn on
   Cloudflare's own rate limit.

## When the Sync app runs

1. WorkManager runs it every 15 minutes while the phone has a
   network, soon after a data app poked it, and when the user asks.
2. A run asks for `heads`. Then it serves every data app that needs
   it:
   - an app whose head is not its cursor, or whose Known is above
     what `heads` says the server told this device;
   - an app that poked;
   - an app whose last `status` said that it has something to send,
     to fetch or to compare.

   It asks every data app for its `status` at least once a day. So a
   poke that was lost, or work that a full day stopped, is found
   again.
3. In a run, for every app in turn: the fetch and the ordinary
   batches first, then streams, then the batches of a comparison of
   everything. So a reminder does not wait behind a first upload.
4. It works while the apps are locked and while the phone is locked,
   after the first unlock since the phone started.
5. Android ends a run after some minutes. Everything on this page
   can stop and go on, so the next run continues.
6. Android decides when background work really runs. A phone that
   sleeps, or a Sync app that is rarely opened, can be hours behind.
   A reminder made on a tablet reaches a phone at the phone's next
   run, not at once.
7. The Sync app keeps only state of this phone: its device key, the
   name key, the server's ID and address, the heads and the account
   revision it saw, the IDs of the devices it saw as removed, and how
   far each transfer got. Android's own backup is off, as in every
   app.

The Sync app's screens, its settings, which networks it uses for
files, and what it shows during a long transfer are for its
specification ([Open questions](#open-questions)).

## A lost device

1. On another device, the user opens the list of devices in the Sync
   app and removes the lost one. From then on an honest server takes
   nothing from it and gives it nothing.
2. With no device left, the user sets up a new phone: the words in
   one data app, the Sync app, and a setup code saved in the
   Cloudflare dashboard. Then they remove the lost device.
3. Removing does not take back keys. The lost phone still holds the
   keys of its apps, behind its screen lock. If someone can unlock
   it, or may get its keys in another way, the user makes a new
   recovery key.
4. A removed device keeps its data and works as before, without
   sync.

## A new recovery key

[crypto-design.md](../security/crypto-design.md#a-new-recovery-key)
fixes what happens to the keys in one app: the new key becomes the
primary, the old one stays in every keyset, and file keys are sealed
again row by row. This section fixes the rest: the server, the other
apps and the other devices. The screens are not designed
([Open questions](#open-questions)).

Three key IDs matter to a data app:

- **P**, the primary key ID of its `record` keyset;
- **S**, the key ID it syncs with, in its table for sync;
- **C**, the server's current key ID, which the Sync app passes on
  with every call.

On an ordinary day all three are the same. Two rules hold always:

- an app sends only while P, S and C are the same;
- S only ever changes to P, and only while C is P.

### On the device where it is made

1. The user makes a new recovery key in a keeper, as the first one
   was made: shown, written down, confirmed. The keeper's keysets now
   hold both keys, and P is the new key ID.
2. The Sync app asks the keeper, in a new mode of the handover, for
   two things: a "new account key" statement, signed with the old
   account key, and the name key for both recovery keys. The keeper
   shows what it is asked, and the system prompt runs.
3. The Sync app sends [`account-key`](#account-key). The server's
   current key ID is now the new one. From here on only the new words
   can add a device, and the server takes no more blobs of the old
   key.
4. Until the server has taken the statement, the keeper sends
   nothing: P is not C. It still fetches, and takes what is sealed
   with S.
5. Any device whose keeper holds both recovery keys can make that
   statement and send it. So the device where the key was made need
   not be the one that sends it, and can send it again if the server
   was put back to an earlier time.

### In every data app, on every device

An app learns C from the Sync app. What it does depends on the keys
it holds.

1. **C is a key the app does not hold.** It says "Enter the new
   recovery key", and stops sending. It still fetches, and takes what
   is sealed with S. It gets the new keys in one of two ways:
   - on the phone where the new key is kept, by the handover. The
     app takes handed-over keysets of another primary only if they
     also hold its own current key: the same ID and the same key;
   - on any other device, by the user typing the new 24 words in one
     data app there. The other apps of that phone then use the
     handover.

   The new key never travels through the server, in any form.
2. **P is the new key, and C is still S.** The server has not taken
   the statement yet. The app sends nothing and waits.
3. **P is the new key, and C is P.** The app does, in this order:
   1. One last fetch, up to the head that `heads` named when the
      fetch began and no further. It takes records sealed with S or
      with P. So nothing that was stored before the change is lost.
   2. It sets S to P. From now on a record sealed with another key
      is skipped as "another recovery key", and the app's own
      version of it goes into **To send**.
   3. It seals its file keys again under the new key. A file's
      record is held back until its wrapped key names S.
   4. It [compares everything](#comparing-everything). Every record
      the server holds under the old key is "not seen", so the app
      seals and sends it again. A device that has only the new words
      can then open all of it.
4. **C is an older key that the app holds, and not S.** The app does
   not follow. It sends nothing, and says that the server names an
   older recovery key. An honest server does this only after its
   database was put back. A device whose keeper holds both keys then
   sends the statement again.
5. An app that kept the old words is no longer a keeper: it keeps
   only the current recovery key of its `record`
   ([crypto-design.md](../security/crypto-design.md#creating-it),
   point 5). It is a keeper again when the new words are entered
   there.
6. The Sync app of each device gets the new name key from a keeper
   on its phone and seals its own name again. The key ID of a sealed
   name is in the clear, so every Sync app can show which devices
   have the new key already.

### What the rules give

1. A device that is behind cannot write over newer records: the
   server refuses blobs of the old key, and an app that syncs with
   the new key takes none.
2. A lost device that holds only old keys cannot read what is sealed
   from now on. It cannot feed records to an app that syncs with the
   new key, even with the server's help.
3. Nothing is lost on a device that is behind. Its changes wait, and
   go out sealed with the new key once it has it.
4. Two devices that each make a new key: the server takes the first
   statement. The other device gets `0A` and says "Another new
   recovery key was made on another device. Enter its words here."
   Its own new key stays in its keysets as an older key and is not
   used.
5. Old keys stay in every keyset. Nothing drops one by itself. A
   backup made before the change opens with the old key, in an app
   that still holds it.

### What they do not give

1. A new recovery key cannot take back what the old key could
   already open.
2. Until an app syncs with the new key, it trusts the old one. A
   record sealed with the old key that reaches it in that time is
   taken. That is also true for a forged record, made by someone who
   holds the old key and has the server's help. When the app later
   compares everything, it seals such a record with the new key and
   sends it, like every other record it has. So the user enters the
   new words on every device soon, and the Sync app shows which
   devices still wait.
3. A server that hides from a device that there is a new key keeps
   that device sealing with the old key, until the user enters the
   new words there.
4. If the server never took the statement, and no device is left
   whose keeper holds both keys, the server stays on the old key. The
   user then moves to a new server
   ([Moving to another server](#moving-to-another-server)).
5. Repairing a damaged keyset file once it holds keys of two recovery
   keys ([crypto-design.md](../security/crypto-design.md#open-questions),
   question 14) is part of the screens of this flow, and open with
   them.

## Deleting everything, and moving

### Closing the server and deleting everything

1. In the Sync app the user chooses to close the server. The Sync app
   calls [`account/delete`](#accountdelete).
2. The server is then closed, and its devices, its codes and the
   account key are gone. Every other device learns it at its next
   run, says so, and makes no more requests. Without that mark the
   other devices would see an empty server and send everything again.
3. Nothing on any phone is deleted.
4. The user then deletes the Worker, the database and the bucket in
   the Cloudflare dashboard. That is what removes the records and the
   chunks. It also works alone, without step 1: the devices then
   cannot reach the server, and say so.
5. A hostile server keeps what it wants. Deleting is a request.

### Moving to another server

1. The user deploys a new server and joins it with one device, with
   a setup code. The other devices join with device codes.
2. Every data app sees another server ID and compares everything. The
   new server fills from the devices.
3. The old server is closed and deleted as above.

## What the server can still learn

Whoever runs the server, and Cloudflare, see this for certain:

| What | Why |
|---|---|
| Which apps of the suite the user syncs | The app's name travels in the clear |
| How many records each app has, and how large each sealed record is | One row for each record. A sealed record is its plaintext plus 50 bytes. |
| The ID of every record and file | Random 16 bytes. They say nothing by themselves, but they tie the versions of one record together. |
| How often and when each record changes, and which device sent it | Every stored batch. The time of storing is close to the time of the change. |
| Which records belong to files, and how large each file is | A file's chunks carry the file ID. A stream is the file plus 45 bytes, plus 16 for each segment. |
| That a record was deleted, most of the time | In an app that wipes, the sealed record gets small. In the others it gets 8 bytes longer. |
| The key ID | Four bytes at the start of every sealed record. They tie all of a user's data together. |
| Each device's public key, when it joined, the days it was seen | The list of devices |
| The length of each device's name | The name is sealed |
| The network address and the time of every request | As any web server |

What it is not told: any content; the type of a record, though it can
tell a file's record by its chunks and may guess a type from a size;
the times inside a record; the name of any file or device; the
recovery key; any private key.

1. The Sync app sends the same `User-Agent` from every phone. Android
   would otherwise name the phone's model in it, which is also a
   device's first name.
2. Anyone who knows the address can ask for `info`. They learn that
   a sync server is there, its ID, and whether it is in use.
3. Someone who only watches the network sees that the Sync app talks
   to the server, when, and how much. Hiding sizes and timing is out
   of scope
   ([threat-model.md](../security/threat-model.md#out-of-scope)).

## Versions

| What has a version | Where | Now | A reader that meets a higher one |
|---|---|---|---|
| The plaintext of a sealed record, with the order for ties | Its first byte | 1 | Skips the record as "newer", and stops sending |
| An app's data | Bytes 1 to 4 of the plaintext | Each app's own | The same |
| The courier interface | Every call | 1 | Answers `UPDATE`: "Update both apps." |
| The server interface, with the server's tables | The path, `/v1/` | 1 | Answers `01`: "Update the Sync app" or "Update your server" |
| A statement and a signed request | Byte 7 | 1 | Refuses it |
| The handover | Its request | 2 | Answers `UPDATE` |
| The blobs | [crypto-design.md](../security/crypto-design.md#the-header) | 1 | "Made by a newer version of the app" |

1. Decided by the owner: nothing forces a user to update the Sync
   app, and the Sync app never asks shkriuss.app for anything. The
   only checks are the ones in this table, between the user's own
   apps and the user's own server. A user learns of updates through
   Obtainium, as for every app.
2. A server keeps speaking every older version of its interface that
   a released Sync app speaks. A new server version moves its tables
   forward when it is deployed.
3. A change to anything in this table is a format change, with a
   decision record.

## What the tests must cover

The server:

1. Every call, every answer byte, and every refusal of a body that is
   cut, too long or of a wrong layout.
2. The order of the checks of a signed request.
3. Send: a record is stored only if the server's copy is at or below
   the batch's cursor; a batch is one step; the results are in order;
   a blob of another key ID is refused.
4. Fetch: Through is read with the page. A test writes between two
   reads and finds no gap.
5. What the server told a device, and the new epoch when a fetch or a
   batch shows that a device knows more. A request with an older
   epoch gets the server's epoch and makes no new one. A database put
   back and filled again to the same head is still found, through
   `heads`.
6. `files/delete`: chunks go only while the deleted record is still
   the server's copy, and a record stored over it gets `04`.
7. The account revision goes up with every change of the account, in
   the same step. An app that the database no longer knows is
   answered as head 0. One record of 524,288 bytes always fits in a
   batch and in a page, whatever `info` says.
8. The codes: one use, the end, the wrong tries, a setup code that
   was used.
9. The order of the checks of `enrol`: nothing is stored before the
   check of the code, and a device that is in already gets `00`.
10. The row writes of each call, asserted from D1's own count.
11. Every call sent twice does no harm (rule 7).
12. A closed server.
13. The test vectors of
    [crypto-design.md](../security/crypto-design.md#sync-keys): a
    statement, a signed request, both signatures.

`core/sync-client`:

1. Property tests: several devices, many random edits, deletions,
   wipes and file keys sealed again, with pages delivered in any
   order, twice, or late. Every device ends with the same records.
2. Every step of the order for ties, each against each.
3. A stop between any two writes, then going on: nothing is lost and
   nothing is sent twice for good.
4. The send rules: **Just taken**, **To send**, every reason to
   hold a record back, each refusal, the cursor's two moves, and a
   stop between a batch and its `exported`.
5. A comparison of everything: against an empty server, a full one,
   one that lost records, and after new keys. It ends, also when it
   was stopped at each step. Ordinary changes go out before it.
6. Every reason to skip, the first skipped number, and stopping.
7. Hostile pages: a wrong epoch, a wrong start, an ID inside that is
   not the ID outside, a record that is too large, a page that is
   cut.
8. Streams: a wrong hash, a wrong length, a fetch that stops and
   goes on, a file that came back before and after another device
   asked the server to delete its chunks, and a stored stream that no
   longer fits its hash, which is not sent.
9. A new recovery key: the three key IDs in every combination. S
   never moves to an older key.

The courier interface and the Sync app, on the emulators:

1. The caller check: a stranger, another certificate, a lineage, a
   preview with a real app, Catalog, a data app calling a data app.
2. A data app that is not running, was never opened, or was
   force-stopped. A locked phone.
3. The connection: cleartext is refused, a certificate authority that
   the user added is refused, a redirect is not followed.
4. The manifest: what the Sync app exports and which permissions it
   asks for.
5. Waiting, halving, and the message for a wrong clock.

## Assumptions

Things this page takes as true. Each is checked when its part is
built. If one is wrong, the fix is a change to this page first.

1. A call to a data app's content provider starts the app's process,
   also when the app was never opened or was force-stopped.
2. Tink 1.24.0 makes an Ed25519 key pair from 32 given bytes and
   signs as RFC 8032 says. The Worker's Web Crypto checks such a
   signature.
3. The Android Keystore makes a P-256 key in StrongBox. Its signature
   converts to the 64 bytes that the Worker's Web Crypto checks.
4. `core/crypto` seals a record under any 16 bytes written as a UUID,
   so that a device ID can stand where a record ID stands.
5. D1 runs a batch of statements as one step, reads a head and a page
   in one such step, and counts row writes as
   [What the server stores](#what-the-server-stores) says.
6. R2 checks the SHA-256 that comes with a chunk and refuses a chunk
   that does not fit.
7. One request with one record of 524,288 bytes stays under 10 ms of
   CPU time. How many records go together beyond that is what `info`
   names.
8. The Sync app can tell Cloudflare's answer for "the day's requests
   are used" from its answer for "out of CPU time".
9. Android's own HTTP client can do what
   [The connection](#the-connection) asks.
10. Android checks certificate transparency for the Sync app on
    Android 17 by itself, and on Android 16 when the network security
    configuration asks for it. Android 15 has no such check.
11. The SHA-256 of the largest file an app allows is quick enough to
    compute once on a phone.
12. The server's clock is right.
13. Every record of today's four apps fits into 524,288 bytes when
    sealed.
14. One request to the Worker may make 256 calls to R2. If it may
    make fewer, `info` names a lower number of chunks.
15. A D1 database that is full still takes the small update that a
    fetch makes.
16. Android's own HTTP client lets the Sync app set its `User-Agent`.

## Decided by the owner

| Question | Decision |
|---|---|
| A way to make users update the Sync app ([threat-model.md](../security/threat-model.md#found-while-writing-this-page), point 5) | No forced update. The Sync app checks versions only with the user's own server, and never contacts shkriuss.app ([Versions](#versions)). |
| The Sync app's TLS settings, and a pin (point 6) | HTTPS only, no cleartext, only the certificate authorities built into Android, none added by the user, no redirect, no pin ([The connection](#the-connection)). |
| Whether the recovery words alone can add a device (point 12) | No. A new device needs the words and a one-time code: from a device that is in, or saved in the Cloudflare dashboard ([Joining](#joining)). |
| When deletion markers may be purged | Never in this version ([Deletion markers](#deletion-markers)). |
| The QR code | Words only, still. Nothing draws or scans a QR code. The server's address and the code are typed. |
| Which settings stay on one device ([ADR 0036](../adr/0036-app-settings-as-records.md), point 5) | None. Every record syncs, Water's settings record too. Every device that has the app reminds. Marks, snoozes and Done on a notification stay on one device. To silence one device, the user turns off that app's notifications there. |
| How the list of devices names a device | A name that the server stores sealed. The Sync app holds one key for it, made from the recovery key, which opens nothing else ([The name key](#the-name-key)). |
| A deletion and an edit with the same `updatedAt` | The edit wins, on every device ([Conflict rules](#conflict-rules)). |
| A hostile server that shows a new device a record that was deleted since | Kept as a known limit of this version. Nothing proves to a new device that it was shown everything ([Attacks considered](#attacks-considered), [Open questions](#open-questions), question 5). |

## Attacks considered

Each line says how the attempt fails. A line marked **Does not fail**
says so plainly, with what limits the harm.

Someone on the network:

| Attempt | How it fails |
|---|---|
| Reads the traffic. | HTTPS. Inside it is only ciphertext. |
| Has a false certificate for the server's name. | They see and can do what the server can, and no more: the lines for the server below apply. |
| Catches a request and sends it again. | Within 5 minutes it does no harm (rule 7). After that the time is refused. |
| Sends the Sync app to another host, or to cleartext. | No redirect is followed, and cleartext is off. |

The server, or whoever took over the Cloudflare account:

| Attempt | How it fails |
|---|---|
| Reads a record or a file. | It has no key. |
| Changes a blob. | Tink refuses it. The record is skipped, and a device that has it sends its own again. |
| Hands out a blob under another record's ID, or another app's. | The record ID is bound to the blob and is inside it. Each app has its own key. |
| Hands out other bytes for a file, or a part of them. | The length and the hash are inside the file's sealed record. The file ID is bound to the stream. |
| Hands out an older version of a record. | On a device that has a newer one, it loses by `updatedAt`. |
| Hands out a record that was deleted since. | On a device that holds the marker, the marker is newer. Markers are never purged. |
| Changes the order, or sends a record many times. | The end does not depend on the order. The same record twice writes nothing. |
| Holds records back, or shows a device an older state. | **Does not fail.** It cannot be told from "the other device is offline". Nothing on a device is lost. When the server shows everything again, the devices end the same. |
| Shows a new device an older state, with a record that was deleted since. | **Does not fully fail.** A new device has no marker. If the user edits that record there, the edit is newer than the marker and wins everywhere. |
| Tells each device another story. | Each device's end depends only on the records it took. While the stories differ, records are held back, as above. |
| Lies about numbers, heads or epochs. | A device checks the numbers of a page against its cursor. A cursor that a lie pushed above every head is found at the next run, and ends in a comparison of everything. Beyond that a device fetches too much or too little: holding back, or work. |
| Says "stored" and stores nothing, or stores what it should refuse. | Holding back. No rule of a device rests on the server's checks. |
| Adds a device of its own. | That device has no keys. It reads nothing, and seals nothing that a device takes. |
| Lets a removed device stay. | Together they have what the removed device had. A new recovery key limits it to that. |
| Keeps what it was asked to delete: old versions, chunks, everything. | **Does not fail.** It keeps ciphertext. With the words, it opens what it kept. |
| Fills a phone's storage. | A device fetches only streams that a sealed record names, up to the named length, and keeps a stream only if its hash fits. A wrong stream is deleted and fetched again at most once a day. Pages and records have limits. |
| Says "closed", "removed" or "your clock is wrong" when it is not so. | Sync stops and says why. No data on the phone changes. After "removed" the device has to join again. |
| Names a recovery key that no device has. | Every app says that the server names a recovery key this phone does not know, and sends nothing. No data changes. The words are only ever typed into a data app's own screen. |
| Hides from one device that a new recovery key was made. | **Does not fully fail.** That device goes on sealing with the old key until the user enters the new words there. A device with the new key shows which devices still wait. |
| Makes a join statement, or hands a device code to a stranger. | It has no account key, and a code alone does nothing. |
| Sends an old "new account key" statement again. | It counts only when the key that signed it is the current one. |
| Learns who syncs what and when. | **Does not fail.** See [What the server can still learn](#what-the-server-can-still-learn). |

A stranger on the internet:

| Attempt | How it fails |
|---|---|
| Asks for `info`. | **Does not fail.** They learn that a sync server is there, its ID, and whether it is in use. |
| Finds the address and joins. | Needs a statement, so the words, and a code. |
| Claims a new, empty server before the user does. | Needs the setup code, which is in the user's own dashboard. |
| Guesses a device code. | The statement is checked first. Then 5 tries in 10 minutes. |
| Floods the server. | **Does not fail.** The day's requests are used and sync waits a day. The data is safe. Cloudflare's rate limit helps. |

Someone who has the 24 words:

| Attempt | How it fails |
|---|---|
| Joins with the words alone. | No code. |
| Makes a new account key and locks the user out. | `account-key` must come from a device that is in. |
| Has the words and what the server stores. | **Does not fail.** The words open everything. They are the account ([threat-model.md](../security/threat-model.md#what-the-24-words-open)). |
| Has the words and sees a device code while it is good. | **Does not fail.** They join. The new device shows in every list of devices. |

Someone who has a device:

| Attempt | How it fails |
|---|---|
| A lost phone that is locked. | Android's encryption. The user removes the device. |
| A lost phone that is unlocked. | Out of scope. Removing it and a new recovery key limit what comes after. |
| A removed device with old keys and the server's help reads new data. | New data is sealed with the new key. |
| The same feeds records to other devices. | An app that syncs with the new key takes none. An app that still waits for the new words takes them, and later sends them on: **does not fully fail** ([What they do not give](#what-they-do-not-give)). |
| A device that is behind writes old records over new ones. | The server refuses a batch made at an older cursor for a record that changed, and blobs of an old key. A device sends its own again. |

Another app on the phone:

| Attempt | How it fails |
|---|---|
| Calls a courier provider. | The certificate check runs first. No answer. |
| Takes the Sync app's package name on a phone without it. | Both sides compare the exact current certificate. |
| Is signed with an old signing key, or a lineage. | The same. |
| A preview talks to a real app. | Another certificate, and the build-kind check. |

A Sync app that was taken over, for example by a harmful library:

| Attempt | How it fails |
|---|---|
| Reads data. | It holds ciphertext and the name key. It learns the names of devices. |
| Feeds data apps bad pages. | A page is checked as if it came from a hostile server. |
| Asks a keeper to sign an attacker's device. | The keeper's own screen names the server and asks the user, and the system prompt follows. If the user allows it: **does not fully fail**, the attacker's device is in. It gets ciphertext, and can close the server or remove devices. |
| Closes the server, or removes every device. | Nothing on a phone is lost. The user joins again, or deploys a new server, and the devices fill it. |

A data app that was taken over:

| Attempt | How it fails |
|---|---|
| Seals harmful records. | **Does not fail** for that app: it has that app's key, as before sync. It reaches no other app's key and no network. |

Old versions, clocks and accidents:

| Case | What happens |
|---|---|
| An older app writes over a field that a newer one added. | It stops sending when it meets a newer data version. |
| A clock that is wrong. | More than 5 minutes: no sync. A wrong stamp does not last: the next edit on a device that has that version wins over it. |
| A device comes back after a year. | It takes what came since. Its edits compete by `updatedAt`. What was deleted stays deleted. |
| An old backup is restored on a device that syncs. | The restore rule: the newest edit wins. Markers are there. What the restore wrote is sent like any change. |
| The user puts the database back to an earlier day. | The first device that knows more than the server makes it start a new epoch, and every app compares everything. A device that was removed since is in again until a device that knows of the removal sees the lower account revision. It then removes that device again and tells the user. |
| Two devices make a new recovery key. | The server takes the first. |
| A stop between any two steps. | Each step is one transaction, or can be done twice. |

## Open questions

Not decided here. Each says what decides it.

1. **The Sync app's specification.** Its screens and settings, which
   networks carry files, what a long transfer shows, and its
   notification
   ([notifications.md](notifications.md#open), question 3). Needed
   before the Sync app is built.
2. **The screens of a new recovery key**, with repair once a keyset
   holds two keys
   ([crypto-design.md](../security/crypto-design.md#open-questions),
   question 14) and what users do after a harmful update
   ([ADR 0038](../adr/0038-a-stolen-signing-key.md)). Building that
   flow is a piece of work of its own.
3. **For the owner, when each part is built:**
   - the table that is not a record in each data app's database
     ([data.md](data.md#rules-for-daos), point 5);
   - the Sync app in the allow list of permissions, with `INTERNET`
     and what WorkManager needs, each with its decision record;
   - one measurement of CPU time on a deployed Worker on the free
     plan, which takes a Cloudflare account.
4. **Each app's own sync points**, in its specification before it
   syncs:
   - what it shows for a record whose parent is missing;
   - for Notes, a sweep that no longer marks the files of a deleted
     note as deleted ([Conflict rules](#conflict-rules), point 10),
     and what then happens to a file whose note stays deleted.

   That a reminder comes on every device, and that Done on one does
   not clear the notification on another, is known and accepted for
   this version.
5. **A proof that nothing is held back.** This version has none.
6. **Purging deletion markers**, in a later version
   ([Deletion markers](#deletion-markers), point 5).
7. **A hash for each chunk.** Today a wrong stream is found at its
   end. Fine for 25 MB. To decide before Drive and Photos. Chunks
   that are wrong on the server are found only by a device that
   fetches them, and nothing replaces them in this version.
8. **Records that do not fit D1.** 500 MB on the free plan, and
   524,288 bytes for a record. Larger records could go to R2.
9. **Chunks without a record.** A device that sent a stream and was
   lost before it sent the record leaves chunks that nothing names.
   Nothing removes them in this version.
10. **Faster delivery.** A change reaches another device at that
    device's next run. A push from the server would need more than
    one Worker ([ADR 0009](../adr/0009-sync-protocol-and-server.md),
    "Options rejected").
11. **Cloudflare Access as an extra lock**
    ([ADR 0007](../adr/0007-recovery-key-instead-of-passwords.md),
    "Consequences"). The Sync app of this version cannot send its
    token.
12. **Hiding which apps sync.** The app's name is in the clear.
