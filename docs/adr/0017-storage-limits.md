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
no longer applies (see "What people see").

## Context

- Every app's server keeps things in **Durable Objects**: online copies,
  notification schedules, passkey locks, notes about replaced keys, online
  libraries. On Cloudflare's free plan they share **5 GB, in all**.
- Each object is named by a token the device makes. That's what keeps the
  servers from knowing who anyone is, but it also means **the server can't
  tell a real token from a made-up one**. Each limit was per token, so
  nothing limited the total.
- Unlike the daily request allowance, **storage doesn't reset at midnight**.
  Once it's full, every write fails in every app (sync, notifications,
  linking a device), and the owner can't tell junk from real data: it's all
  named by hashes, on purpose.
- Cloudflare keeps even a tiny object in at least 12 KB (measured on the
  live account), so many tiny objects add up too.
- The rate limit at Cloudflare (deployment.md, 30 requests per 10 seconds
  for `/api/`) slows things down, but doesn't cover PR previews
  (`*.workers.dev`) and can't stop a patient script.

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
- The Worker tells each object its limit for that site: the real sites get
  the full limit, PR previews a small one, as each preview has its own
  storage, which counts against the same 5 GB.

### The limits

| What                                        | Real site, each     | Preview, each | Where              |
| ------------------------------------------- | ------------------- | ------------- | ------------------ |
| An app's online copies (each app with sync) | 120 MB              | 20 MB         | `packages/sync`    |
| Repairs' copies with their photos           | 1 GB                | 80 MB         | `packages/sync`    |
| An app's notification schedules (each app)  | 40 MB               | 8 MB          | `packages/push`    |
| Passkey locks; replaced-key notes           | 40 MB each          | 4 MB each     | `packages/account` |
| Online libraries (Photos)                   | 32 MB (about 2,000) | 4 MB          | `packages/library` |

All together that's about 3 GB on the real sites, so a full namespace never
stops the others, and there's room left for the owner's online library list
and a couple of open previews. The per-account limits stay as they were
(a copy is at most about 1.4 MB, an account's photos at most 800 MB).

**Device links** (the hub's "Show a code") are the one thing a stranger can
make the servers keep that no meter counts: each is small and deleted 10
minutes after it's made, so the free daily requests cap them at about 700
at a time, a few megabytes at most (audit 4 B-1).

Each new app with sync or notifications adds its own limits, so a unit test
(`tests/unit/free-plan.test.ts`) adds them all up from `apps.json`, with two
open previews and the library list, and fails above 4.5 GB (audit J-2).
There's room for about two more apps with both; past that, the limits per
app need lowering first.

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
  after a device last asked about it. By then no device still has the key.
- **An online library that was never unlocked** (with the storage code) is
  deleted 30 days after it was last used. It can't hold photos before it's
  unlocked, so nothing is lost: a device still using it makes it again.
  Unlocked libraries stay. What's left of one after "Delete the online
  copy" is deleted 13 months after a device last used it, and its room is
  given back (audit 3 D-2); one that gets photos again stays.
- A token that only asks (a copy that doesn't exist, a file, a replaced-key
  check) keeps nothing at all.

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
  itself: the note is gone. Its old key no longer reaches anything, since the
  apps moved their copies to the new key.
- Each copy keeps a little more (when it was last used, and its room), and a
  copy that grows past its room makes one more request, to the meter.
- Copies and objects from before this change aren't counted until they next
  store something.

## Alternatives

- **Only the rate limit at Cloudflare.** It doesn't cover previews, and a
  slow script still fills 5 GB in time.
- **Accounts the server knows about, or an invite code for online
  features** (like Photos' storage code). That would tell real users from
  strangers, but it means a list of accounts, or that nobody but the owner's
  invitees could sync. It can be added later if needed.
- **Deleting the least recently used objects when full.** A script could
  then push out real copies just by making new ones.
- **One limit per day for new objects.** Easy to use up every day, which
  would stop new devices from linking or syncing at all.
