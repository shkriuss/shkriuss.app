# 0014. Syncing photos between devices

Status: Accepted (2026-10-21). Extends [ADR 0010](0010-account-and-sync.md)
(sync) and [ADR 0013](0013-photos-on-the-device.md) (photos on the device).
Repairs' copies and photos together have a limit (1 GB):
[ADR 0017](0017-storage-limits.md). Changed by audit 6 (S4): the daily
check of a device on an older version of the app deletes no photos while
the copy has data only a newer version syncs.

## Context

Repairs keeps photos on the device ([ADR 0013](0013-photos-on-the-device.md)).
With sync on, a repair's other details reach the person's other devices, but
its photos don't: the tablet says "1 photo on another device". People take
photos on their phone at work and want to see them on the tablet later.

The online copy of an app's data ([ADR 0010](0010-account-and-sync.md)) can't
hold photos: it's at most about 1.4 MB, and each device downloads the whole
copy whenever anything changes. A photo is a few hundred KB, and a year of
repairs may have a thousand of them.

## Decision

- **Each photo is a file of its own, sealed on the device** with the same
  key as the app's copy (AES-256-GCM, `sealBytes` in `@shkriuss/crypto`). The
  label names the app and the file, so the server can't swap one file for
  another. Only the person's devices can open them.
- **Two files per photo:** the 320-pixel thumbnail (`<photo id>.thumb`, a
  few tens of KB) and the 1,600-pixel photo (`<photo id>.full`). Another
  device downloads a thumbnail when the list first shows it, and the full
  photo only when it's opened (or saved as a copy). That keeps mobile data
  low. Each device then keeps what it downloaded, like its own photos.
- **Where:** in the account's own copy on the app's server (the same
  Durable Object, `SyncCopy` in `packages/sync`), next to the copy. No new
  Cloudflare setup, no new storage service, no new secrets. An app turns it
  on in its Worker with `syncHandler({ files: true })`; others don't accept
  files. Routes: `GET /api/sync/files` (the list: ids, sizes, times),
  `PUT`/`GET /api/sync/files/<id>`, and `DELETE /api/sync/files/<id>?base=N`.
- **Order:** a device uploads new photos before the data that uses them, so
  another device finds them as soon as the repair arrives. If they still
  haven't arrived (no connection), the list says "1 photo hasn't arrived
  yet" and tries again after the next sync.
- **Deleting:** removing a photo, or deleting its repair or vehicle, deletes
  it online at the next sync. The server only deletes a file while the copy
  is still the version that device just synced, so a photo that another
  device has just started using again is never deleted. "Delete the online
  copy" deletes all the photos too. A device deletes its own copy of a photo
  once a sync shows the photo was taken off its repair on another device.
- **A daily check:** once a day (and when sync is turned on) a device
  compares the online list with what its data uses: photos missing online go
  up (like ones taken before sync was on), and online photos nothing uses,
  more than a day old, are deleted. A device on an older version of the app
  deletes none while the copy has data only a newer version syncs, as it
  can't see which photos that data uses (audit 6 S4).
- **Replacing the account key:** the photos move with the copy, sealed again
  with the new key, before the old copy is deleted.
- **Limits:** a photo is saved small enough to sync (at most 1.4 MB; a very
  detailed one is saved again at a lower JPEG quality). Each account holds at
  most 5,000 files (2,500 photos) and 800 MB, and at most 300 changes in 10
  minutes. When it's full, the sync status says so and new photos stay on
  the device.

## Consequences

- Photos sync with no setup, end-to-end encrypted, on the free plan. The
  server sees how many files there are, how big they are and when they
  change, never what they show.
- **Space is limited.** On Cloudflare's free plan, Durable Objects hold
  5 GB in all (every app and every account together), and 1 GB per object,
  so per account. At a few hundred KB a photo, 800 MB is about two years of
  a technician's daily photos. The per-account limits (5,000 files, 800 MB)
  are in `packages/sync/src/validate.ts`; the change rate, and the total for
  all accounts together (1 GB, [ADR 0017](0017-storage-limits.md)), in
  `packages/sync/src/worker.ts`. The Workers paid plan (about $5 a month)
  lifts Cloudflare's limits; ours are raised by changing those numbers.
- Each upload costs three row writes, against 100,000 a day on the free plan.
- Photos still aren't in backup files (ADR 0013); with sync on, the online
  copy is a second place they're kept.
- A device that only downloaded a thumbnail shows the thumbnail when it's
  offline, and can't save the full photo as a copy until it's online.

## Alternatives

- **Cloudflare R2** (object storage, free up to 10 GB): more room, but it
  needs a new bucket, a binding in every environment, and a second store to
  keep in step with the copy (deleting the copy must delete the photos).
  Worth moving to if the 800 MB limit is reached.
- **Photos inside the copy:** the copy would grow past its limit with a few
  photos, and every device would download every photo at every change.
- **One file per photo (thumbnail and photo together):** simpler, but
  showing the list on a new device would download every full photo.
