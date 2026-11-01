# 0017. Limits on what the servers keep, and clean-up of unused copies

Status: Accepted (2026-10-23). Changes [ADR 0009](0009-push-notifications.md)
(notifications), [ADR 0010](0010-account-and-sync.md) (account and sync),
[ADR 0014](0014-syncing-photos.md) (photos in sync) and
[ADR 0016](0016-online-photo-library.md) (the online library). Audit
finding B-1. Changed by [ADR 0019](0019-no-pull-request-previews.md): there
are no pull request previews, so each namespace has one limit, the real
site's, and the 4.5 GB is for the real sites alone. Without previews the
limits add up to about 3.1 GB, so about eight more apps with sync and
notifications fit (160 MB each) before the limits need lowering, not two
(audit 3 J-6). Changed by audit 4 (J-6): sync's message when a copy is
refused stays plain, but no longer because of Calendar's size budget, which
no longer applies (see "What people see"). Changed by audit 5: device links
are rows in one object (B-2), a library made up through a move is cleaned up
too (B-1), files count their rows (B-3), what the 13-month clean-up undoes
for a replaced key (A-1), and the daily row writes (B-4); and its body no
longer describes pull request previews (J-4). Changed by audit 6: what the
13-month clean-up of a replaced-key note means for the person's own old
passkeys and recovery key (A-3), a test notification keeps nothing for a
device without a schedule, and the online libraries' lists have a limit of
their own, kept by `LibraryGate`, instead of a guess outside every meter.
So the limits add up to about 3.3 GB, and about seven more apps with sync
and notifications fit, not eight. And what caps the device links, with the
old per-link objects that may be left over, is said right (see "Device
links").

## Context

- Every app's server keeps things in **Durable Objects**: online copies,
  notification schedules, passkey locks, notes about replaced keys, online
  libraries. On Cloudflare's free plan they share **5 GB, in all**.
- Each object is named by a token the device makes. That's what keeps the
  servers from knowing who anyone is, but it also means **the server can't
  tell a real token from a made-up one**. Each limit was per token, so
  nothing limited the total.
- Unlike the daily request allowance (and the daily row writes, which run
  out first: [ADR 0010](0010-account-and-sync.md), "Free quota"),
  **storage doesn't reset at midnight**.
  Once it's full, every write fails in every app (sync, notifications,
  linking a device), and the owner can't tell junk from real data: it's all
  named by hashes, on purpose.
- Cloudflare keeps even a tiny object in at least 12 KB (measured on the
  live account), so many tiny objects add up too.
- The rate limit at Cloudflare (deployment.md, 30 requests per 10 seconds
  for `/api/`) slows things down, but can't stop a patient script.

## Decision

### Each namespace has a total, kept by a meter

- One object in each namespace, named `meter`, adds up what the others hold.
  Before an object stores more, it asks the meter for room (`reserve`); before
  it deletes everything, it gives its room back (`release`). Code:
  `packages/server/src/meter.ts`.
- **Each object counts 16 KB besides its data**, so tiny objects are
  counted too.
- An object asks for a quarter more than it needs, so most changes don't
  have to ask again. Shrinking is never refused.
- When there's no room, the request gets **507** and nothing is kept. Copies
  already online keep syncing as long as they stay about the same size.
- The meter keeps only a hash of each object's id and how much room it has.
- The Worker tells each object its limit (the table below). Pull request
  previews, which had a small limit of their own against the same 5 GB,
  are gone (ADR 0019).

### The limits

| What                                        | Each site           | Where              |
| ------------------------------------------- | ------------------- | ------------------ |
| An app's online copies (each app with sync) | 120 MB              | `packages/sync`    |
| Repairs' copies with their photos           | 1 GB                | `packages/sync`    |
| An app's notification schedules (each app)  | 40 MB               | `packages/push`    |
| Passkey locks; replaced-key notes           | 40 MB each          | `packages/account` |
| Online libraries (Photos)                   | 32 MB (about 2,000) | `packages/library` |
| Their lists of photos (Photos)              | 320 MB              | `packages/library` |

All together that's about 3.3 GB, so a full namespace never stops the
others. The per-account
limits stay as they were
(a copy is at most about 1.4 MB, an account's photos at most 800 MB).

**The online libraries' lists** (each photo's row, with its sealed
details, and each note of a deleted photo) aren't counted by the
libraries' meter, which counts each library as 16 KB: only someone with
the storage code can add to a list, so a stranger can't fill this room and
stop the owner's photos going up. The library's `LibraryGate` counts them
instead, with the 1 TB of files, and refuses uploads once all of the app's
lists take 320 MB, about 400,000 photos
([ADR 0016](0016-online-photo-library.md)). Until audit 6 nothing counted
them, and the budget assumed 400 bytes a photo for the owner's library
alone, while a photo's sealed details may be 4,000 characters.

**Device links** (the hub's "Show a code") are the one thing a stranger can
make the servers keep that no meter counts. They're all rows in one object:
a few hundred bytes each (about 1 KB at most), deleted 10 minutes after
they're made by that object's alarm, or by whatever request comes next if
Cloudflare dropped the alarm (it gives up on an alarm after a few tries
once the day's free writes are used up, which a script making links uses
up itself). What caps them is the day's free row writes: each link costs
4 (its two rows, and deleting them), so about 25,000 links use up a day's
writes ([ADR 0010](0010-account-and-sync.md), "Free quota"). Nothing
makes a script spread them over the day, so all of those may be there at
once: about 30 MB at most, in that one object, until they're deleted
(after 00:00 UTC, if the day's writes ran out first). That's still small
next to the 5 GB, and it never lasts (audit 4 B-1). Until audit 6 this
said "about 700 at a time, under a megabyte", which counted neither the
deletes nor a script making them all at once.

Until audit 5 (B-2) each link was an object of its own, 12 KB that only its
own alarm deleted: with the alarm dropped, it stayed for good. The Worker
now only reaches the one object, so any such object made before then whose
alarm Cloudflare had already given up on can't be reached any more, and
stays. If there are any, the Cloudflare dashboard's storage for the hub's
`AccountLink` namespace shows how much (12 KB each).

**Files kept with a copy** (Repairs' photos) count their bytes plus their
id twice and 64 bytes more, for the row that holds each file and its entry
in the index of files. Without that, the smallest files the checks allow
(29 bytes, with 80-character ids) took six times the room the meter saw
(audit 5 B-3). The limits in the table are unchanged; fewer tiny files fit.

Each new app with sync, notifications or an online library adds its own
limits, so a unit test
(`tests/unit/free-plan.test.ts`) adds them all up from `apps.json`, the
libraries' lists included, and fails above 4.5 GB (audit J-2). There's
room for about seven more apps with sync and notifications (the status
note above says how that changed); past that, the limits per app need
lowering first.

### Unused copies are deleted

- **An online copy nobody has synced with, or even asked about, for 396 days
  (about 13 months) is deleted**, files and all, with the note left when one
  is deleted. Notification schedules already work that way (ADR 0009).
- Each copy sets an alarm when it's used, at most once a day. An alarm that
  fails (R2 or the meter not answering for a while) runs again a minute
  later, then later each time, up to a day apart, so a clean-up or a
  deletion never stops for good (`runAlarm` in `@shkriuss/server`, audit
  B-2). If Cloudflare itself doesn't run an alarm (when the day's free
  requests are used up, it may give up after its own few retries; its
  documentation doesn't say), the object's next request sets it again: a
  copy's at its next sync a day or more after the last, a notification
  schedule's at its next upload (audit 3 B-4).
- A device that comes back later finds no copy, as on a first sync, and
  puts its own data online again. So only copies nobody uses go for good.
- **A note that a key was replaced** is deleted the same way, 13 months
  after a device last asked about it. The device that replaced the key
  forgets the old key after the same 13 months, counted from when it noted
  it, so no app is handed a key whose notes may be gone (audit 5 A-1).
- **An online library that was never unlocked** (with the storage code) is
  deleted 30 days after it was last used. It can't hold photos before it's
  unlocked, so nothing is lost: a device still using it makes it again.
  Unlocked libraries stay. What's left of one after "Delete the online
  copy" is deleted 13 months after a device last used it, and its room is
  given back (audit 3 D-2); one that gets photos again stays. That holds
  whichever request made the library, a move to a new account key included
  (until audit 5 B-1, a library made up through `POST /api/library/move`
  had no clean-up, so strangers could fill the libraries' room for good).
- A token that only asks (a copy that doesn't exist, a file, a replaced-key
  check) keeps nothing at all, and nor does a test notification from a
  device without a schedule (until audit 6 it kept a row and a wake-up
  that no meter counted, deleted only by that wake-up).

### What people see

- Sync: "Couldn't sync just now. It will try again later." The changes
  stay on the device. (It has no message of its own: with the limits
  above, it should never happen.)
- Photos in Repairs: the message that was already there for no room.
- Replacing the account key when there's no room to note the old one: the
  key is replaced all the same (the apps move their copies to the new key
  when sync is turned on again), and the Account page says that devices with
  the old key won't sign out by themselves.
- Adding a passkey or notifications: the usual "couldn't, try again later".
- A new online library: Photos says the online library is full, and photos
  stay on the device.

## Consequences

**Good**

- Strangers can't fill the storage every app shares. The most they can do
  is use up one app's room for a while: its new copies or schedules wait,
  while the owner's own copy keeps syncing and every other app works.
- Junk copies, replaced-key notes, schedules and libraries go away by
  themselves, so those namespaces recover even when full. (Passkey locks
  don't: see below.)
- Copies nobody uses no longer stay on the server for good, which is better
  for privacy too.

**Costs and limits**

- **Someone determined can still use up one app's room**, and keep it used
  by touching their junk now and then. Then new people can't turn on sync in
  that app until the junk is gone. Telling junk from real copies would need
  accounts the server knows about, which ADR 0010 chose not to have.
- **Passkey locks aren't deleted when unused**: a lock is needed only when
  someone signs in with that passkey, which can be years later, so the server
  can't tell an unused one from junk. About 2,500 made-up locks fill that
  namespace until the limit is raised or the owner clears it. Existing
  passkeys keep working and the recovery key always works; only adding a new
  passkey waits.
- **Raising a limit** is a change to the numbers in the code (and, for much
  more, the Workers paid plan). If the apps get many more users, the limits
  need raising.
- **A device away for over 13 months** finds its old online copy gone, and
  starts a new one from its own data. Edits only that copy had are lost; any
  device that synced in the meantime kept the copy.
- **A lost device away for over 13 months** is no longer signed out by
  itself: the note is gone. What the clean-up undoes, exactly: the old key
  can sign in to the hub on that device again, and an app's old online copy
  that nobody (not even the lost device) has used for 13 months is deleted
  with its "moved" note, so the old key can start a copy under that app's
  old token again. What it can't undo: the person's own devices never read
  such a copy (unless one signs in with the old key again: next point).
  The device that replaced the key forgets it after 13 months, and each
  app remembers the old keys it's done with (their copy moved, by
  it or by another device, or deleted) and never fetches them again
  (audit 5 A-1; before, the replacing device handed every app the old key
  at each "Turn on sync" for ever, and a copy started with it after the
  clean-up was merged into the person's data). One narrow case is left: an
  app in which nobody turned sync on again for over 13 months after the
  key was replaced, and whose old copy nobody used meanwhile, brings along
  whatever copy the old key started in between, if sync is turned on in it
  while the hub still hands the old key over.
- **The person's own old passkey, or old recovery key, after 13 months.**
  Only the note stops them signing in, and once a lost device has signed
  out nobody asks about it (the device that replaced the key never does),
  so it goes 13 months after the replacement, or after the last try with
  the old key. Then a passkey the person didn't remove (locks are never
  deleted, above) or an old recovery key file signs a device in to the old
  key again, and apps turned on there sync with it, where whoever kept the
  old key can read them. The Account page tells the person to remove old
  passkeys when they replace the key, and signed in this way it shows the
  old account code. Keeping the note for good would let strangers fill its
  room for good, and keeping it alive from the person's device would work
  only while that device stays signed in and opens the Account page at
  least once a year, so it stays as it is (audit 6 A-3).
- Each copy keeps a little more (when it was last used, and its room), and a
  copy that grows past its room makes one more request, to the meter.
- Copies and objects from before this change aren't counted until they next
  store something.

## Alternatives

- **Only the rate limit at Cloudflare.** A slow script still fills 5 GB in
  time.
- **Accounts the server knows about, or an invite code for online
  features** (like Photos' storage code). That would tell real users from
  strangers, but it means a list of accounts, or that nobody but the owner's
  invitees could sync. It can be added later if needed.
- **Deleting the least recently used objects when full.** A script could
  then push out real copies just by making new ones.
- **One limit per day for new objects.** Easy to use up every day, which
  would stop new devices from linking or syncing at all.
