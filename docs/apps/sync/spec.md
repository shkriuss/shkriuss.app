# Sync: specification

What Sync does, screen by screen, what it keeps on the phone, which
networks it uses, and what happens when something goes wrong. Sync is
the networked app of [sync-protocol.md](../../architecture/sync-protocol.md),
[ADR 0005](../../adr/0005-no-network-permission-in-data-apps.md) and
[ADR 0009](../../adr/0009-sync-protocol-and-server.md). They fix joining,
the list of devices, every call and when Sync runs. This page says only
what they leave to it. If this page is wrong or silent, the fix is a
change to this page first, agreed with the owner.

- Package `app.shkriuss.sync`. App name in keys: `sync`. Modules
  `android/feature/sync` (screens, the run, the server client, the
  courier calls and Sync's own courier provider) and `android/app/sync`
  (the only manifest with `INTERNET`).
- The page ends with what the owner [decided](#decided-by-the-owner),
  every [assumption](#assumptions) and what is still [open](#open).

## What Sync is for

Sync keeps the apps of shkriuss.app the same on your phones and tablets,
through a server that you run in your own Cloudflare account. It carries
only what that server cannot read, and holds no data of its own.

## At a glance

| Part | Choice |
|---|---|
| Screens | Apps, Devices and Settings. Before the phone has joined, the join steps. |
| Stored | No records. State of this phone: a preferences file, the device key, the name key. |
| Backup | None. No record types, no data version. |
| Networks | Records on any network. File chunks only on an unmetered network, unless **Files on mobile data** is on. Off at first. A file's own record waits with its file. |
| Runs | WorkManager: every 15 minutes with a network, soon after a poke, and on **Sync now** |
| Long transfers | Shown on Apps while a run goes. They go on over as many runs as they need. |
| Notifications, reminders, app lock | None. Sync never holds the recovery key. |
| Permissions | `INTERNET`, and three that WorkManager needs. All granted at install. |

## As in Water

| Part | What differs in Sync |
|---|---|
| [Navigation](../water/spec.md#navigation) | The activity is `SyncActivity`. The destinations are **Apps** (the start), **Devices** and **Settings**: a bar under 600dp, a rail from 600dp. Back from Devices or Settings goes to Apps. Nothing is inside `AppLockGate`. Before the phone has joined, the [join steps](#the-join-steps) take the whole screen, with no destinations. |
| [Settings screen](../water/spec.md#settings-screen) | The same layout and dialogs. The sections are [Network, Server and About](#settings). |
| [Licences](../water/spec.md#licences) | Sync's own list, from [third-party.md](../../development/third-party.md). |
| [Every screen](../water/spec.md#every-screen) | Nothing. Every screen, step and dialog is one column in the design system's margins at every width, with screenshot tests in the four standard configurations. |

## Words used on this page

- **Data app**, **server**, **device**, **head**, **cursor**, **epoch**
  and **keeper**: as in
  [sync-protocol.md](../../architecture/sync-protocol.md#words-used-on-this-page).
- **Joined.** The server took this phone's `enrol`, and Sync holds the
  device key and the name key. **Run.** One piece of WorkManager's work
  in which Sync serves the data apps.
- **Unmetered network.** One that Android does not mark as metered,
  usually Wi-Fi. **Mobile data**: every metered network.
- **Problem.** Something that stops sync on this phone until time or
  the user puts it right ([Problems](#problems)).

## Screens

### The join steps

Sync opens here until the phone has joined. Each step has a top bar and
Back to the step before. Back from the first leaves the app. Back to
step 1 cancels the join: one write sets `stage` 0 and drops the values
of the join and `setupCode`, then the device key and the name key are
deleted. A join left at `stage` 1 for a day is cancelled in the same
way at the next start of Sync. A join at `stage` 2 never is: the next
start first asks `heads` ([Stopped between two writes](#stopped-between-two-writes)).

The secret in the Worker outlives a cancel. So from the moment a setup
code first shows, `deleteSetupCode` holds that server's address, and no
cancel, no one-day rule and no other server takes it out. For each
address a line shows with **Done**: on step 1 before the phone joins,
and on Apps after it. "Delete the secret SETUP_CODE of the Worker at
sync.example.workers.dev in the Cloudflare dashboard, so that no one can
use it." Only its **Done** takes the address out.

1. **Sync.** "Sync keeps your apps the same on your phones and tablets,
   through a server in your own Cloudflare account. The server gets only
   what it cannot read. Set up the server first: the self-hosting guide
   says how." The button **Join a server**.
2. **Server address.** One field, "Server address", hint
   `sync.example.workers.dev`, which asks the keyboard not to learn.
   **Next** checks the address ([Limits](#limits-and-defaults)), then
   asks for [`info`](../../architecture/sync-protocol.md#info), with
   "Asking the server":

   | What happens | What the step says |
   |---|---|
   | No connection, no such host, a failed handshake | "Could not reach the server. Check the address and that the phone is online." |
   | A certificate Android does not trust | "The server's certificate is not one this phone trusts." |
   | A redirect, another HTTP status, a broken layout | "This address does not answer as a sync server." |
   | No version 1 | "Update the Sync app." when its lowest is above 1, else "Update your server." |
   | Closed (`02`) | "This server was closed. Deploy a new server to sync again." |
   | Its clock more than 5 minutes from the phone's | "This phone's clock is off by 7 minutes. Set the time in Android's settings, then try again." |
   | No account (`00`) or in use (`01`) | Step 3 |

3. **How to add this phone.** Two rows: **A code from another device**,
   "On a device that has joined, open Sync, then Devices, then Add a
   device."; and **A setup code in the Cloudflare dashboard**, "For the
   first device, or when none of your devices has joined." A server with
   no account has only the second, under "This server has no devices
   yet."
4. **Code from another device.** One field, "Code". **Next** goes to
   step 6. A wrong one: "Enter the 8 characters of the code."
5. **Setup code.** Sync makes a code and stores it before it shows it:
   large, with a gap after each group of four that is not a character.
   "Save this code as a secret of your Worker, named SETUP_CODE, with no
   spaces. Then come back here." **Copy** puts it on the clipboard,
   marked sensitive. **Continue** goes to step 6. The screen blocks
   screenshots and the recent-apps preview.
6. **Allow it in an app with your recovery key.** "An app that keeps
   your recovery key signs that this phone may join. Sync never sees
   your words." Sync makes the device key here, if this join has none.
   One button for each keeper, as
   [security-screens.md](../../architecture/security-screens.md#the-handover-between-apps)
   lists them: **Continue in Water**, with "Key b19d376f" under it. With
   no keeper: "No app on this phone keeps your recovery key. Enter the
   words in one of your apps.", and **Enter the words in Water** for each
   data app that has its keys from a recovery key. That app takes only
   the 24 words of its own key: "These words are for another recovery
   key." With no such data app: "Install an app of shkriuss.app and set
   up its recovery key first."

   A button opens that app's handover screen in the mode "Sign a device"
   ([crypto-design.md](../../security/crypto-design.md#the-handover-format-version-2)).
   The statement and the name key go on to step 7. A "no" stays here.
   `REFUSED`: "Sync cannot use Water: one of the two is signed otherwise
   or not up to date. Update both apps." `UPDATE`: "Update both apps,
   Water and Sync." `NOT_KEEPER`: "Water does not keep the recovery key
   now.", and the buttons are listed again. `OTHER_KEY`, after a request
   that named an older key: the line of `0A` for any other key at step
   7.
7. **Joining.** "Joining the server", while Sync sends
   [`enrol`](../../architecture/sync-protocol.md#enrol):

   | Answer | What follows |
   |---|---|
   | `00` | Joined. If this join showed a setup code, used or not, step 8, else Apps. |
   | `09` | "The code is wrong, used or too old." A device code goes back to step 4, empty. A setup code stays at step 5: "Check the secret SETUP_CODE in the dashboard: this code, with no spaces." |
   | `0A`, naming an older key that the keeper holds | Sync asks the keeper again ([point 8](../../architecture/sync-protocol.md#how-the-sync-app-gets-its-statement-and-its-name-key)). |
   | `0A`, any other key | "This server belongs to another recovery key, with the short name 1a2b3c4d. Join with an app that keeps that key, or deploy a new server." |
   | `05`, `01` | The lines of step 2 |
   | `06` | The join is cancelled, and step 2 says the server was closed. No more requests go to it. |
   | `03` | The key was removed: Sync deletes it, and the join goes back to step 6 with a new key. |
   | `04` twice | "The server refused this phone. Try again later." |
   | No answer | "Could not reach the server." **Try again** sends the same `enrol`, or goes back to step 6 when the statement is older than 10 minutes. |

8. **Delete the setup code.** "This phone has joined. Now delete the
   secret SETUP_CODE of your Worker in the Cloudflare dashboard, so that
   no one can use it again." **Done** takes this server's address out of
   `deleteSetupCode` and goes to Apps. Back goes to Apps and keeps the
   line there.

### Apps

1. Top bar: "Sync". The device line: "Synced today at 14:05." (from
   `syncedAt`), "Not synced yet.", or "Syncing" while a run goes. A
   [problem](#problems) takes its place, with its button.
2. **Sync now**. While a run goes it reads "Syncing" and does nothing.
3. A line to delete the setup code for each address in
   `deleteSetupCode`.
4. Section **Apps**: a row for each data app that passes the courier
   check ([sync-protocol.md](../../architecture/sync-protocol.md#no-permission-of-our-own)),
   by name in the phone's language order, ties by package name. An app
   `app.shkriuss.<name>` with a handover screen that fails only the
   comparison of certificates gets a row too, and is never called.
   When Apps comes to the front, Sync asks each data app that a run is
   not serving for its `status`, a call on the phone with no network,
   and the rows show what it gives.
5. Under the name, the first line that applies:

   | When | Line |
   |---|---|
   | It fails only the certificate check, or answered `UPDATE` | "Update both apps, Water and Sync." |
   | No answer, and its last `status` said sync is on | "Open Water once, so that it can sync again." |
   | No answer, and no `status` said so | "Water did not answer." |
   | Sync is off in it | "Sync is off in Water." |
   | It cannot sync now | "Water cannot use its keys now. Open Water." |
   | `status` byte 58 is `01`, `02`, `03` or `04` | "Update Water.", "Enter the new recovery key in Water.", "Water waits for the server to take its new recovery key.", "The server names an older recovery key than Water's." |
   | A run serves it now | "Fetching changes", "Sending changes", "Comparing everything", or "Sending files: 120 MB of 1.2 GB" and "Fetching files: 20 MB of 75 MB" with a `ShkProgressBar` of the share |
   | Its streams wait for an unmetered network | "Files wait for Wi-Fi." |
   | A comparison waits for the next day (`07 01`) | "Comparing everything. It goes on at 04:00." |
   | A comparison runs | "Comparing everything." |
   | It has changes or files to move | "Has changes to send." or "Has files to move." |
   | Otherwise | "Up to date." |

   A second line from the counts of
   [`status`](../../architecture/sync-protocol.md#what-status-gives),
   each part only when above 0: "12 records skipped" (the four reasons
   of skipping), "3 records not sent" (too large, or refused with `03`)
   and "1 file did not match" (fetched streams), joined by " · ".
6. A tap opens a dialog with the app's name, its lines, "Last synced
   today at 14:05." or "Not synced yet.", and **Compare everything**,
   **Open Water** and **Close**. **Compare everything** shows only while
   sync is on there, it can sync and no comparison runs. It asks
   "Compare everything in Water?", "Water checks each of its records
   against the server and sends what the server lacks. This can take a
   day or more.", with **Compare** and **Cancel**. **Compare** calls
   `compare`, then asks for a run.
7. With no data app: `ShkEmptyState`, "Install an app of shkriuss.app
   and turn on Sync in its settings."

A long transfer: the file step of a run takes the total from the
lengths in `streams`, and what is done from `files/have` for sending and
from `streams` for fetching. The row moves after each chunk request.
When Android ends the run, the row says "Has files to move.", and the
next run goes on. None of it is stored: how far a transfer got, which
the protocol counts as state of this phone, is what `files/have` and the
data app's `streams` say at the next run.

### Devices

1. Top bar: "Devices". Sync reads
   [`devices`](../../architecture/sync-protocol.md#devices) when the
   screen comes to the front, unless the screen shows a list read less
   than a minute ago. `ShkLoadingState` until a list is there. After a
   failed read, a list the screen shows stays, with "Could not read the
   list of devices."
2. Only devices that are in: this phone first, then the others by name
   in the phone's language order, ties by when added, then device ID.
   A row: the name, or "A device with a name this phone cannot read",
   and under it "This phone · Added 16 Nov 2026" or "Added 2 Oct 2026 ·
   Last seen 14 Nov".
3. A floating button, **Add a device**, asks "Show a code to add a
   device?", "Anyone who has your recovery words and sees this code in
   the next 10 minutes can add a device.", with **Show the code** and
   **Cancel**. **Show the code** calls `enrol-code`. A dialog, "Add a
   device", shows the code in two groups of four: "On the new device,
   open Sync, tap Join a server, and type this code. It works once,
   until 14:15." **Done** closes it. After its end: "This code has
   ended.", with **New code**. The dialog blocks screenshots. When
   `enrol-code` gets no answer: "Could not get a code. Try again.", with
   **Try again** and **Cancel**. Any other answer closes the dialog, and
   Apps shows its [problem](#problems).
4. A tap on a row: a dialog with the row's text. For this phone,
   **Rename** and **Leave the server**. For another, **Remove**, which
   asks "Remove Pixel 6a?", "It can no longer sync with this server.
   What is on it stays on it. If it is lost, read A lost device in the
   self-hosting guide.", with **Remove** and **Cancel**.
5. **Rename**: one field, **Name**, with **Save** and **Cancel**. "Enter
   a name." or "A name has at most 40 characters." **Save** seals the
   name and sends `devices/name`.
6. **Leave the server** asks "Leave the server?", "This phone stops
   syncing. Its apps keep everything. To sync again, it joins as a new
   device.", with **Leave** and **Cancel**. **Leave** sends
   `devices/remove` with this phone's ID, then forgets the server. If
   the server cannot be reached: "Could not reach the server. Leave
   anyway? The server keeps this phone in its list until another device
   removes it.", with **Leave anyway** and **Cancel**.

### Settings

| Section | Item | Shows | Opens |
|---|---|---|---|
| Network | Files on mobile data | A switch, off at first. Under it: "Off: files, and the changes that add or change a file, move only on Wi-Fi and other networks that are not metered. Other changes always go on any network." | Nothing |
| Server | Server | `sync.example.workers.dev` | Nothing |
| Server | Close the server | | "Close the server?", "Every device stops syncing with it, for good. Nothing on any phone is deleted. To sync again, you deploy a new server.", with **Close the server** and **Cancel** |
| About | Version, Licences | As in Water | As in Water |

Sync sets `closing` before it sends `account/delete`. The answer `00`,
or a later `06` while `closing` is set, ends the close: "The server is
closed. Now delete the Worker, its database and its bucket in the
Cloudflare dashboard. That removes your data from the server.", with
**OK**. `closing` stays until **OK**, so the dialog shows again at the
next start until it is read.

The buttons of the two code screens, and **Remove**, **Leave**,
**Leave anyway** and **Close the server**, ignore a tap that comes
through another app's window (`filterTouchesWhenObscured`).

## Problems

The device line on Apps shows the first that applies, as the protocol's
[answers](../../architecture/sync-protocol.md#answers) ask.

| Cause | The line | Button | Until |
|---|---|---|---|
| Closed (`06`) | "This server was closed. Nothing on this phone changed." | **Join another server** | The phone joins again |
| Removed (`03`). The device key is deleted. | "This phone was removed from the server. Its apps keep everything." | **Join again** | The same |
| Not a device (`02`) | "The server does not know this phone." | **Join again** | The same |
| The device key or the name key is gone, or Sync's state cannot be read | "Sync lost this phone's keys for the server. Join again, then remove the old entry of this phone on another device." | **Join again** | The same |
| Version (`01`): the server's lowest version is above 1 (`stop` 4), or its highest below 1 (`stop` 6) | "Update the Sync app." or "Update your server." | **Try again**, for the server | Sync is updated, or `info` names version 1 |
| The clock (`05`) | "This phone's clock is off by 7 minutes. Set the time in Android's settings." | **Try again** | A request passes. Each run tries once. |
| A fault (`04` twice, an answer that breaks its layout or a limit, except `info`'s three limits, or more removed devices than Sync keeps). `fault` is set. | "Sync has a fault: the server refused a request." | **Try again** | A request passes, which clears `fault`. The next run tries. |
| The day's limit (`07 02`, or Cloudflare's) | "The server's limit for today is used. Sync goes on at 04:00." | | 00:00 UTC |
| Full (`08`) | "The server is full. Changes wait on this phone. The self-hosting guide says what to do." | **Try again** | A batch is stored. Fetching goes on. Sending is tried once a day and on **Try again**. |
| Three failed runs in a row | "Could not reach the server since 14:05. Sync tries every 4 hours." | **Try again** | A run works |
| Put back ([`heads`](../../architecture/sync-protocol.md#heads), point 5) | "The server was put back to an earlier time. Check the list of devices." | **Devices** | Devices shows a list read after the put-back was found |

1. Another epoch (`0B`) is no problem: every data app compares
   everything, and its row says so. After `0C`, Sync reads `info` again
   and asks for less. A lack of CPU time halves the request.
2. **Join again** and **Join another server** write `stage` 0 and drop
   the server's values first, then delete the device key and the name
   key, and open the join steps. **Join again** fills in the address.

A data app shows Sync's [`state`](../../architecture/sync-protocol.md#what-the-sync-app-answers)
in its own **Sync** row: whether this phone has joined, when a run
last ended well for that app, and what stops sync now. That is one of:
nothing; not joined (also closed, removed, a lost key); update Sync;
update the server; the clock; a fault; the day's limit, with its end;
full; cannot reach the server; and, for that app's files, waits for an
unmetered network. Each data app's specification words them.

## When Sync runs

[sync-protocol.md](../../architecture/sync-protocol.md#when-the-sync-app-runs)
fixes what a run does, in which order. Here is the rest.

1. One periodic work, every 15 minutes, with a connected network. It is
   made when the phone joins, and asked for again at every start of
   Sync while `stage` is 3, which changes nothing when it exists. It is
   cancelled when the phone leaves or stops.
2. One one-time work, for a poke and for **Sync now**, with a connected
   network. A new request while one waits keeps the one that waits.
3. One run at a time. The run clears `poked.<app>` when it starts on
   that app, before `status`. A poke that comes later marks the app
   again, and the run serves it again before it ends.
4. Only `files/send` and `files/fetch` wait for an unmetered network,
   unless **Files on mobile data** is on. Sync checks before each. If
   the network turns metered during a run, the run moves no more chunks
   and does the rest. A file's record waits with its file: the data app
   holds it back until its stream is on the server
   ([Sending](../../architecture/sync-protocol.md#sending), point 4).
5. After `07 02` and Cloudflare's day limit, no request until 00:00
   UTC. After `07 01`, only batches of a comparison wait until then;
   ordinary batches still go.
   After three failed runs, one every 4 hours. **Sync now** skips the
   4-hour wait, not 00:00 UTC, and follows **Files on mobile data**.
6. `info` is read when the phone joins, after `0C`, in the first run of
   a day, and at `stop` 4 or 6 at every start of Sync (also the first
   after an update) and on **Try again**. When it names version 1, the
   stop ends and the periodic work is asked for again. A run that finds
   `limits` missing reads `info` first. A request uses its three
   limits, halved after each lack of CPU time, down to one record.
7. In the first run of a day, also the `status` of every data app and
   the list of devices.
8. Nothing runs before the first unlock since the phone started, or
   after a force stop until the user opens Sync. No battery condition:
   Android decides when work really runs.

## Data

### On this phone only

| What | Where | Limits |
|---|---|---|
| The device key | Sync's Android Keystore, alias `shk.device.<number>` ([crypto-design.md](../../security/crypto-design.md#the-device-key)) | At most one. From join step 6 until the phone leaves, is removed, or starts another join. |
| The name key | `shk-keys/record`, wrapped by Sync's Background key ([The name key](../../security/crypto-design.md#the-name-key)) | From the keeper's answer on |
| WorkManager's database | `androidx.work.workdb`, in Sync's private storage | The two works, their conditions and fixed tags. No ID, name or address. |
| State | One preferences file, `app.shkriuss.sync`, in Sync's private storage | The table below |

| Key | What it holds | Limits |
|---|---|---|
| `stage` | 0 not joined, 1 joining, 2 `enrol` sent, 3 joined, 4 stopped | 0 to 4 |
| `stop` | 1 not a device, 2 removed, 3 closed, 4 update Sync, 5 the key is gone, 6 update the server | 1 to 6, exactly when `stage` is 4 |
| `closing` | **Close the server** was sent, and the dialog of a close was not yet read | True or false |
| `joinedAt` | When the join began, at step 2 | A time, from `stage` 1 until the join ends |
| `address` | The server's address | As [Limits](#limits-and-defaults), from `stage` 1 on |
| `serverId`, `epoch` | The server ID from `info`; the epoch from `enrol` or `heads` | 32 hex digits. From `stage` 1 and 3 on. |
| `keyId` | The server's current key ID | 8 hex digits, from `stage` 3 on |
| `revision` | The account revision last seen | 0 to 9,223,372,036,854,775,807 |
| `limits` | The three limits of the last `info` | Records 1 to 100, bytes 65,536 to 524,288, file items 1 to 256. Stored as the nearest bound. |
| `halved`, `halvedAt` | How often requests were halved for CPU time, and when | 0 to 7. A time. |
| `deviceAlias`, `deviceId` | The alias's number, and the device ID | 1 to 2,147,483,647. 32 hex digits: always the first 16 bytes of the SHA-256 of the public key under that alias. |
| `name` | This phone's name, as last sealed | 1 to 40 code points, at most 160 bytes in UTF-8, one line, no space at either end |
| `codeKind` | 1 a device code, 2 a setup code, as chosen at step 3 | 1 or 2, from step 3 until the join ends. A device code itself is never stored. |
| `setupCode` | The setup code of this join | 26 characters of the code alphabet. From join step 5 until the join ends or is cancelled. |
| `deleteSetupCode` | The addresses of the servers whose Workers hold a setup code this phone showed, each until its **Done** | 0 to 8 addresses, each as `address` and each once. One is added when a setup code first shows for it. Neither a value of the join nor of the server: a cancel, the one-day rule, another server, Leave and Join again leave them. With 8 waiting, step 5 makes no code: "Delete the setup codes that Sync lists first." |
| `removed` | IDs of devices seen as removed | 0 to 10,000 IDs, each once, never this phone's. None is ever dropped. |
| `filesOnMobile` | The setting | True or false. False at first. |
| `head.<app>`, `good.<app>` | The head `heads` last named, and when a run last ended well | `<app>` an app name. 0 to 9,223,372,036,854,775,807. A time. |
| `on.<app>`, `work.<app>`, `poked.<app>` | Its last `status`: sync on, work to do. A poke waits. | True or false |
| `infoAt`, `statusAt`, `devicesAt` | When each was last read | Times |
| `failedRuns`, `retryAt` | Failed runs in a row; the end of the 4-hour wait | 0 to 3. At most 4 hours after it was written. |
| `dayWait`, `dayWaitUntil` | 1 only comparisons wait, 2 every request waits; until when | 1 or 2. 00:00 UTC, at most 24 hours after it was written. |
| `full`, `fullAt` | The server said full; when sending was last tried | True or false. A time. |
| `clockOff` | The offset of the last `05`, while it holds | A signed 64-bit number of milliseconds |
| `putBack` | The put-back line waits | True or false |
| `fault` | The fault problem holds | True or false |
| `syncedAt` | When a run last ended well, for the device line | A time |

1. A time is milliseconds since 1970 UTC, 0 to 253,402,300,799,999, as
   the [record times](../../architecture/data.md#record-fields). One
   step of Sync is one write of the file.
2. A value that cannot be read, or is outside its limits, counts as
   missing: 0, false or "never" for an app, off for the setting. At
   `stage` 3, and at `stage` 4 with `stop` 4 or 6, a missing `address`,
   `serverId`, `epoch`, `deviceAlias` or `deviceId`, a device key that
   is gone, one whose public key does not give `deviceId`, or a name key
   that is gone or cannot be opened, counts as lost keys: `stop` 5. A
   removed or closed phone needs no key.
3. Never stored: the recovery words, a key that opens data, plaintext,
   a record ID. Batches, pages and chunks pass through memory and
   pipes, never Sync's storage. Android's backup is off.

## Limits and defaults

| What | Limit or default |
|---|---|
| Server address | 9 to 255 ASCII characters: `https://`, a host name, and `:` and a port from 1 to 65,535 if not 443. Lower case. A host name in other letters is turned into its ASCII form (IDNA, as Android's `IDN.toASCII` does) before the checks, and that form is shown and stored. Spaces at either end, one `/` at the end and `:443` are dropped. Sync adds a missing `https://`. A path, query, user part, `http://` or IP address: "Enter only the address, such as sync.example.workers.dev." |
| Device code | 8 characters, `A` to `Z` without `I` and `O`, and `2` to `9`. Spaces and hyphens dropped, lower case taken as upper. It ends 10 minutes after it was made. |
| Setup code | 26 characters of the same letters and digits |
| Device name | 1 to 40 code points, one line, no space at either end. At first Android's model name, cut to 40 code points, or "Android device". |
| The list of devices | At most 1,000. A longer answer is a fault. |
| Removed devices remembered | Every one, up to 10,000. A server that shows more counts as a fault, so no removed device is ever forgotten. |
| Records and bytes in one request | `info`'s limits, halved for each lack of CPU time, down to one record. One halving is undone a day later. |
| Retries | After three failed runs, every 4 hours |
| Files on mobile data | Off |

### Units

1. Sizes are bytes, shown as Android shows sizes, in steps of 1,000.
2. Times in the phone's zone and format: "today at 14:05", "yesterday at
   09:10", "on Mon 16 Nov", with the year only when it is not this year.
3. Added: the server's time, as a date. Last seen: the server's UTC
   day, shown as that date, with no time.
4. A clock that is off: whole minutes, rounded up, below 2 hours; whole
   hours below 2 days; then days. With plurals.
5. 00:00 UTC in the phone's time: "at 04:00" in Tbilisi.

## Reminders

None. Sync's own code sets no alarm and shows no notification, and it
does not use `core/notify`.

## When things go wrong

### Every stored value has limits

Every value of [Data](#data) has its limits in its table, also the
rules that join two values. Sync never writes one outside them. Sync
has no backup and so no restore, and Android's backup is off: nothing
brings a value in. What the server and the data apps give is checked
against the same limits and the protocol's layouts, and refused: an
answer of the server as a fault, a page by the data app. The one
exception: a limit of `info` outside its bounds counts as the nearest
bound ([`info`](../../architecture/sync-protocol.md#info)).

### Stopped between two writes

Sync writes to its preferences file, the Keystore, its keyset file, the
server and the data apps. The server and the data apps take every call
twice without harm ([rule 7](../../architecture/sync-protocol.md#rules)),
so after a stop Sync does the step again.

| Action | Writes, in order | If Sync stops in between |
|---|---|---|
| Server address | `stage` 1, `joinedAt`, `address`, `serverId`, `limits` | The join opens at step 2, filled in. Another server ID drops the old key and setup code. |
| Cancel a join | `stage` 0 and the join's values gone, `deleteSetupCode` kept; then the device key and the name key | At the next start, a `stage` 0 with a device key or name key left deletes them. |
| Setup code | `setupCode` and `deleteSetupCode` in one write, before it shows | The same code shows again. |
| The device key | `deviceAlias`, then the key, then `deviceId` | An alias with no key: the key is made then. An alias with a key and no `deviceId`: the ID is worked out from the key's public key then. |
| The keeper's answer | The name key; `stage` 2 and `name`; `enrol` | Before `stage` 2: a setup code goes back to step 6, a device code to step 4, to be typed again. At `stage` 2 Sync asks `heads` with that key. `00`: the writes of "`enrol` gives `00`", with the epoch and key ID of `heads`. `02`: back to the same step as before `stage` 2. `03`: the key is deleted, back to step 6. `05`: the clock line of step 2, and the join stays at `stage` 2. `06`: the join is cancelled, and step 2 says the server was closed; no more requests go to it. |
| `enrol` gives `00` | `stage` 3, `epoch`, `keyId`, `setupCode` gone; the periodic work | As `stage` 2 above. At `stage` 3, the next start asks for the periodic work again. |
| Rename | `devices/name`; `name`, `revision` | The next list takes the name from the server. |
| Remove a device | The ID into `removed`, before the request; `devices/remove`; `revision` | The ID is kept either way. If the request did not reach the server, the next read of the list finds the device in and removes it again. |
| Leave | `devices/remove` of this phone; `stage` 0 and the server's values gone; then the keys | Before `stage` 0, the next request gets `03`. After it, the next start deletes the keys that no state names. |
| Close | `closing`; `account/delete`; `stage` 4, `stop` 3; the dialog of a close; `closing` gone at **OK** | The next request gets `06`. With `closing` set, that ends the close, and the dialog shows until **OK**. |
| A run, for one app | `poked` cleared; the protocol's steps; `head`, `good`, `on`, `work` of the app; at the end of a run that worked, `syncedAt` | The next run serves it again. |
| The list of devices | `devices/remove` for each removed ID that is in again; `removed`, `revision`, `devicesAt`, `putBack` | The next read does it again. |

### A write fails

| What fails | What follows |
|---|---|
| The preferences file, or the name key | The step does not go on. A join step says "Sync could not save. Try again." A run ends, and the next one tries. |
| Making the device key | "Sync could not make a key for this phone. Try again." StrongBox first, then without ([Hardware keys](../../security/crypto-design.md#hardware-keys)). |
| A courier call fails or gets no answer | That app is left for this run ([sync-protocol.md](../../architecture/sync-protocol.md#what-a-data-app-answers), point 5). Its row says so. |
| A data app refuses a page | Nothing is written there, its cursor stays, and the next run fetches again. |
| A request to the server | [Problems](#problems). Rename, Remove and Close say "Could not reach the server. Try again." Rename and Close change nothing. A Remove keeps the ID in `removed`, so the next read of the list removes that device. **Show the code** as in [Devices](#devices), point 3. |
| Asking WorkManager for a run | "Could not start a run. Try again." under **Sync now** |

### A press twice or late

| Press | What follows |
|---|---|
| **Sync now** twice | One run. The button does nothing while a run goes. |
| **Next**, **Continue**, a keeper's button, **Save** of Rename, twice | One call at a time. The button does nothing while its call goes. |
| **Show the code** or **New code** twice | One request at a time. A new code voids the one before; the dialog shows the last. |
| A device code typed after its end, or used | `09`: "The code is wrong, used or too old." |
| The keeper's answer after Android ended Sync | The step's saved state holds only which app was asked, and the answer reaches the new screen, as `KeeperCall` does. A setup-code join goes on to step 7. A device-code join, whose code is never stored, goes back to step 4. |
| **Try again** at step 7, 10 minutes after the keeper signed | Back to step 6. |
| **Remove** twice, or on a device removed meanwhile | One remove: the dialog closes at the first press, and the server answers `00` for a removed device too. |
| **Leave** or **Close the server** twice | The dialog closes at the first press. Both calls can be sent twice. |
| **Compare** twice | One `compare`. While a comparison runs, the button is not shown. |
| A poke during a run | The run serves that app again before it ends. |

### The clock or the time zone changes

| Change | What follows |
|---|---|
| The phone's clock more than 5 minutes off | While joining, step 2 says so from `info`, before any key is made. Later, `05` and its problem. |
| The clock set during a run | Each signed request carries the clock of its own moment. |
| Another time zone | Stored times are UTC and stay. Shown times move. The waits still end at 00:00 UTC. |
| A stored time later than now | It counts as long ago, so the daily reads run. "Synced" shows it as it is. |
| A wait that ends further away than it can | A day wait more than 24 hours ahead, or a retry more than 4 hours ahead, is over. |
| The end of a device code | The server's clock decides. The dialog shows the end in the phone's time. |
| Midnight while Apps shows | "today" and "yesterday" move. |

## The recovery key

Sync never holds it and never asks for the words
([ADR 0005](../../adr/0005-no-network-permission-in-data-apps.md),
"Options rejected"). Its statement and name key come from a keeper, or
from a data app where the user enters all 24 words
([sync-protocol.md](../../architecture/sync-protocol.md#how-the-sync-app-gets-its-statement-and-its-name-key)).
It has no recovery key screens and no app lock.

## Backup contents

None. Sync holds no records, so it writes and reads no backup, and has
no record types and no data version. The one thing it seals, a device's
name, has its own layout, version `01`
([The name key](../../architecture/sync-protocol.md#the-name-key)). A
new phone joins as a new device.

## Permissions

| Permission | From | Why |
|---|---|---|
| `android.permission.INTERNET` | `app/sync` | To talk to the user's own server. Only Sync has it (hard rule 4). |
| `android.permission.ACCESS_NETWORK_STATE` | WorkManager | To wait for a network, and to tell a metered one before each chunk request |
| `android.permission.WAKE_LOCK` | WorkManager | To keep the phone awake while a run works |
| `android.permission.RECEIVE_BOOT_COMPLETED` | WorkManager | To keep the periodic work after a restart |

1. Android grants all four at install. Sync asks for none. No
   notifications, alarms, foreground service, system prompt, storage
   or camera.
2. Removed in the manifest: `FOREGROUND_SERVICE` and WorkManager's
   `SystemForegroundService`; WorkManager's `DiagnosticsReceiver` and
   the receiver of `androidx.profileinstaller`, both open to callers
   with `android.permission.DUMP`; `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`
   and the emoji font loader of `androidx.emoji2`, as in every app; the
   eight screens, the status provider and the two
   permissions of `core/security`. Kept: its `<queries>` for the
   handover ([permissions.md](../../security/permissions.md#the-handover-between-apps),
   point 8).
3. Exported: `SyncActivity`; Sync's courier provider,
   `app.shkriuss.sync.courier`, with no permission, which checks the
   caller before anything else; and WorkManager's `SystemJobService`,
   which only Android can reach (`BIND_JOB_SERVICE`). WorkManager's
   receivers are not exported.
4. Android backup and device transfer are off. The network security
   configuration forbids cleartext, trusts only the authorities built
   into Android and asks for certificate transparency. No redirect. One
   fixed `User-Agent`, `shkriuss-sync/1`
   ([The connection](../../architecture/sync-protocol.md#the-connection)).
5. The four are Sync's allow list in the APK rules check, with the
   decision record of WorkManager.

## TalkBack

As in Water, and:

1. The device line is one item. A change of it is read once, politely,
   not at each step of a transfer.
2. A row is one item: "Water, sending files, 120 megabytes of 1.2
   gigabytes, 12 records skipped", or "Pixel 9 Pro, this phone, added
   16 November 2026". Its action: "Show details".
3. A code is read one character at a time: "A, B, C, D, 2, 3, 4, 5".
   The gaps are not read. **Copy** says "Copy the setup code".
4. The title of each join step, the section Apps and the sections of
   Settings are headings. A field's error is read when it shows.

## Changes to shared modules

| Module | Change |
|---|---|
| `core/crypto` | The device key, the name key and a sealed name ([Sync keys](../../security/crypto-design.md#sync-keys)). Random setup codes. The cleanup at start ([Hardware keys](../../security/crypto-design.md#hardware-keys), rule 8) leaves every `shk.device.*` key alone. At each start, after it, Sync calls `deleteOtherDeviceKeys` with the number `deviceAlias` holds, which deletes every other device key. |
| `core/security` | Handover format version 2, mode "Sign a device", with Sync the only caller that passes for it. The asking side (`SuiteApps`, `keepers`, `KeeperCall`) works for Sync. |
| `core/sync-client` | Each data app's courier provider, and its calls to `poke` and `state`, when that app syncs |
| `core/design`, `core/notify` | Nothing |

## Out of scope for version 1

- Any notification: progress, a problem, a new device. Foreground work.
- A new recovery key: the mode "A new account key",
  [`account-key`](../../architecture/sync-protocol.md#account-key),
  sealing the name again, and which devices have the new key.
- Several servers at once. Moving is Leave, then Join.
- Settings for the interval, for charging only, to pause, or per app.
- Cloudflare Access, a QR code, an app lock, a system prompt.
- A repair of the name key without joining again. Links that open the
  dashboard or the guide. Widgets, tiles, shortcuts, Wear OS, Georgian.

## Decided by the owner

The app: the networked app of the protocol, with its screens, settings,
networks, long transfers and notification. The owner asked this page to
say, for every value and action, its limits and what happens when Sync
stops between two writes, a write fails, a press comes twice or late,
and the clock or the time zone changes
([When things go wrong](#when-things-go-wrong)). And six answers:

1. Records go on any network. File chunks only on an unmetered network,
   unless **Files on mobile data** is on. It is off at first. So a
   file's own record waits with its file, as the protocol holds it back
   until its stream is on the server.
2. No notification in version 1. A long transfer and a problem show on
   Apps and in each data app's **Sync** row. No `POST_NOTIFICATIONS`, no
   foreground service, and `core/notify` stays as it is
   ([notifications.md](../../architecture/notifications.md#open),
   point 3).
3. No system prompt before showing a device code, removing, leaving or
   closing: one dialog each. No `USE_BIOMETRIC` and no app lock.
4. The setup code is stored in Sync's private storage from the moment
   it shows until the join ends or is cancelled.
5. No `HIDE_OVERLAY_WINDOWS`. The code screens and the buttons that
   remove, leave or close ignore a tap through another app's window.
6. A data app that does not keep the recovery key signs a join only
   with the 24 words of its own keys, and Sync offers only the data
   apps that have keys.

The rest is in
[sync-protocol.md](../../architecture/sync-protocol.md#decided-by-the-owner).

## Assumptions

Choices this page made without a decision by the owner on that point.

1. Three destinations, Apps first, and the join steps before them.
2. The state in one preferences file, as Tasks keeps its phone-only
   values ([ADR 0032](../../adr/0032-app-lock-settings-in-android-preferences.md)).
3. **Copy** for the setup code, marked sensitive. Code screens block
   screenshots.
4. **Compare everything** per app, after a question.
5. The counts of `status` as three sums: skipped, not sent, files that
   did not match. What to do comes from `status` byte 58.
6. Removed devices are not listed. Last seen is the server's UTC date.
7. The address rules: `/` and `:443` dropped, no IP address.
8. At most 1,000 devices from a list and 10,000 removed IDs.
9. The first name, and "Android device".
10. The `User-Agent` `shkriuss-sync/1`.
11. **Leave anyway** when the server cannot be reached.
12. A full server: sending tried once a day and on **Try again**.
13. WorkManager's `DiagnosticsReceiver` removed, as Water removes the
    receiver of `androidx.profileinstaller`.
14. A join left at `stage` 1 for a day is cancelled at the next start,
    so no setup code stays on the phone. The line to delete it from the
    Worker stays until **Done**, for at most 8 servers.
15. The words of every screen, step and dialog.

## Open

1. **The layout of `state`** and the names of every courier call's
   arguments: fixed on
   [sync-protocol.md](../../architecture/sync-protocol.md#what-a-data-app-answers)
   when the courier providers are built.
2. **WorkManager's decision record**, with the dependency change: its
   version, the Room 2 it brings beside Room 3, a
   `Configuration.Provider` in place of its global instance (no service
   locators), whether **Sync now** can be expedited work, its own use
   of Android's alarms to notice a force stop, and what it adds to the
   manifest. Then the owner's sentence for the allow list.
3. **`status` byte 54** is `01` while every record in **To send** is
   held back, so Sync would wake that app at every run. The protocol
   page says so, or `status` counts only what `export` would give now.
   Decided with the courier provider.
4. **A new recovery key**: its screens and Sync's two steps
   ([sync-protocol.md](../../architecture/sync-protocol.md#open-questions),
   question 2).
5. **A lost or damaged name key**: version 1 joins again.
6. **A notification when sync stops**, later, with a part of
   `core/notify` that shows one without alarms.
7. **How often Android runs Sync** when it is rarely opened, on
   GrapheneOS. Seen on phones.
8. **Cloudflare's two answers**, for the day's requests and for CPU
   time, told apart on the first deployed server, and **a data app that
   was force-stopped or never opened**
   ([sync-protocol.md](../../architecture/sync-protocol.md#assumptions),
   points 8 and 1).
9. **The pages for users**: permissions.md, data-inventory.md, a user
   guide for Sync and the self-hosting guide, when the app is built.
