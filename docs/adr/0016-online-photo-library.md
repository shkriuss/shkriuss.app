# 0016. The online photo library: sealed photos in Cloudflare R2

Status: Accepted (2026-10-22). Builds on [ADR 0010](0010-account-and-sync.md)
(account and sync), [ADR 0014](0014-syncing-photos.md) (sealed files) and
[ADR 0015](0015-photos-app.md) (the Photos app on the device). How many
libraries there can be is limited by [ADR 0017](0017-storage-limits.md).
Changed by [ADR 0019](0019-no-pull-request-previews.md): there are no pull
request previews, so no `shkriuss-photos-preview` bucket either.

## Context

Photos keeps original files on the device ([ADR 0015](0015-photos-app.md)).
The owner wants the library online too, up to about 1 TB, and the same on
every device. That's far beyond what sync can hold:

- An app's online copy is at most about 1.4 MB, and every device downloads
  all of it at each change. The list of 300,000 photos alone is bigger.
- Photos kept with the copy ([ADR 0014](0014-syncing-photos.md)) live in a
  Durable Object: at most 1 GB per account, 5 GB in all, on the free plan.
- A phone can't hold 1 TB, so a device must be able to show photos it
  hasn't downloaded, and drop originals that are safely online.
- Storage costs money, so nobody else may fill it, even with an account
  of their own (anyone can make one).

## Decision

### Where things are kept

- **The photos: Cloudflare R2**, a storage service billed by the GB (free up
  to 10 GB, then about $0.015 per GB a month, with free downloads). Bucket
  `shkriuss-photos`; PR previews use `shkriuss-photos-preview`, whose files
  are deleted after 7 days. Each photo is **one file**: its thumbnail, its
  screen-sized copy and its original, each sealed on the device
  (AES-256-GCM, labelled with the library, the photo and the part), one
  after the other. The server stores only the sealed bytes.
- **The list of photos: one Durable Object per library** (`Library`, in
  `packages/library`). For each photo: an id, a number that grows with
  every change (`seq`), its details sealed on the device (when it was
  taken, its name, size, kind and SHA-256), which key sealed them, and the
  sizes of its three parts. A deleted photo leaves a small marker, so other
  devices learn of it, and its id can't be used again.
- **The library's id and keys: in the app's synced copy**
  ([ADR 0010](0010-account-and-sync.md)), a small store with one record per
  library (`library:<id>`, so a merge keeps every library's): the library's
  random-looking id and the keys photos are sealed with. Both come from the
  app's own key (HKDF) when the library is first made, so two devices
  starting at once make the same one. A device only makes one once a sync
  has finished and found none it can use. The server never sees the keys,
  and only the account's devices know the id. (Version 1 of the store had a
  single record, `library`; it's read as its library's record.)
- **Which library a device uses:** one whose record has the device's own
  key, because the library was made with it or moved to it. So a record
  that came from another account is never used. Of several, the oldest: the
  one that has come through the most account keys. When the library a
  device uses changes (it joined another account, or an older library turned
  up), its photos are looked for in the new one, and go up to it if they
  aren't there. Photos that were only online in the other one stop showing
  on that device; its record, with its keys, is kept.

### Using it

- **Turning it on is turning on sync** in Photos: the same "Turn on sync",
  the same account. Photos on the device then go online, one at a time,
  while Photos is open.
- **Changes reach other devices** through the list: each device asks for
  changes after the last `seq` it saw, about once a minute while Photos is
  open, and keeps that place in its photo database (so "Delete all data"
  forgets it too). It asks only once its own photos are loaded: compared
  with a list not loaded yet, a photo here that the changes mentioned
  looked new from another device, and was saved as only online (audit 3
  F3-8).
- **Other devices download little:** thumbnails for the photos on screen
  (up to 40 in one request), the screen-sized copy when a photo is opened,
  and the original only to save it. Downloads read just that part of the
  file (a byte range).
- **Deleting a photo deletes it everywhere:** online at once, and on every
  device at its next check. That's with sync on. With sync off on a
  device, deleting a photo there deletes it only there, as its dialog says:
  the online library and the other devices keep it, and it shows there
  again, as only online, once sync is on again (audit 3 F3-1; before, it
  was deleted everywhere then, though the dialog had said "from this
  device"). A photo deleted while sync was on is still deleted everywhere
  if sync is turned off before that reaches the online library, and it
  doesn't come back on that device meanwhile.
- **"Free up space on this device"** removes originals (and screen-sized
  copies) that are safely online, keeping thumbnails. Only when tapped, and
  only once the library has answered since Photos opened, while it isn't
  being deleted, moved or out of reach: what this device noted earlier may
  be out of date. Just before anything is removed, the library is asked
  again, and only photos it still has are freed. Each photo's original goes
  in the same step as the note that it's only online, so stopping half-way
  never leaves a photo marked as on the device without its original (audit
  finding F3-1).
- **The same photo twice:** a device skips a photo already in the library
  (same SHA-256). If two devices add it at once, the one with the larger id
  is deleted. Picking a photo again whose original isn't on the device
  (it's only online, say after "Free up space") puts the picked file back
  as its original: the same SHA-256 means the same bytes.

### Protecting the bill

- **A storage code.** Uploading needs the library to be unlocked once with
  the storage code, a passphrase the owner keeps as the GitHub secret
  `PHOTOS_STORAGE_CODE`. CI gives it to the production Worker as
  `LIBRARY_STORAGE_CODE`. Previews never get it: they run a pull request's
  code before it's merged, so their library stays locked. Without it, a
  library can be read and deleted, never added to. The code is compared in
  constant time.
- **A library stays unlocked only for the code it was unlocked with.**
  Changing `PHOTOS_STORAGE_CODE` locks every library, and each account gives
  the new code once.
- **Limits across all libraries,** because anyone can make up a library, so
  limits kept in each would protect nothing. One more Durable Object
  (`LibraryGate`) keeps them: 1 TB stored and 10,000 uploads a day in all.
  The upload limit keeps a big import from using up the free daily requests
  every app shares.
- **20 wrong codes an hour from each internet address** (for IPv6, each
  network: the first 64 bits), whatever the library. Not 20 for everyone
  together: then a stranger could use them up every hour and nobody could
  give the right code. The gate keeps only a hash of the address mixed with
  the code, hashed again with a random salt it makes for each hour, and
  deletes both when the hour is over. (Without the salt, someone with the
  code could find the address by trying every IPv4 address, and tell the
  same caller's tries in different hours: audit 3 D-8.) Someone with many
  addresses gets more tries, so what really stops guessing is the code
  itself: five or more random words (about 64 bits), far too many to guess.
- **Limits per library:** 400,000 photos, and 95 MB per photo (Cloudflare
  takes at most 100 MB in one request).
- **A library that was never unlocked costs nothing in R2.** Thumbnails and
  parts are read only for items its list has, deleting it lists no files,
  and "remove" leaves no markers in it.
- **Access:** requests carry a token from the app's own key (HKDF). The
  first one to reach a new library becomes its token; others are refused.

### Changing the account key, and deleting

- **Replacing the account key:** sync moves the copy (with the libraries'
  ids and keys) to the new key ([ADR 0010](0010-account-and-sync.md)). Just
  before the old copy is deleted, the device tells every library the old key
  had (not only the one in use) its new token, proven with the old one, and
  adds the new key to their records; the old token is refused from then on
  (410, "moved"). Nothing in R2 moves. New photos are sealed with a key from
  the new account key, so the lost device can't read them; older photos
  keep their key.
- **When the lost device moves the library first.** The old key's token
  proves the move, and the lost device has the old key too. Photos moves an
  old key's data only to the key that replaced it, which only the person's
  own devices can tell (audit A-3), so making an account of its own there
  moves nothing. But an older version of Photos still on that phone, or a
  request made by hand, could move a library first. Then the library is
  theirs, and the server refuses the person's move (403). The person's device then marks the library as taken in its
  record, still retires the old copy, and starts a new library with the new
  key. Photos says plainly what happened, photos on the person's devices go
  up to the new library, and photos that were only online are lost to them.
  A device tries the move even when another device moved the old copy
  first, since that may have been the lost one.
- **"Delete the online copy"** deletes the account's libraries first: each
  list is cleared at once, then the files are deleted in batches of 1,000
  (a Durable Object alarm, which keeps trying while R2 fails: audit B-2).
  Photos on each device stay; those only online are gone. A library known to be taken is left alone; if one refuses
  (another device took it), the copy stays, and the device says it
  couldn't delete the online copy instead of saying it's done.
  `packages/sync` gains a `linked` option for this: data an app keeps
  online beside its copy, deleted and moved with it.
  A photo still on its way up while its library is deleted isn't added to
  the new one: its file is deleted instead (audit finding B-7).
  What's left of a deleted library (its empty list, with the hashes of its
  token and of any replaced ones, a hash of the storage code it was
  unlocked with, how many changes it had, and the day and number of its
  last uploads) was kept for good. Now it's deleted too, with any file
  an upload left in R2 since, once nobody has used it for 13 months, and
  its room is given back (audit 3 D-2). A device that uses it in that time
  keeps it 13 months more; one that adds photos to it again makes it an
  ordinary library, which stays ([ADR 0017](0017-storage-limits.md)). A
  library deleted before this change keeps its record, as before.
  - A deleted library is locked until the storage code is given again.
    Another device that was putting photos online learns of the deletion
    only at its next sync, and its upload rounds would otherwise fill the
    library again, to be kept for good (audit 4 D-1). One deleted before
    this change is locked the first time it's used.
  - The device deleting reads the online copy's library records first, so
    one whose first sync hadn't finished (with no records of its own)
    deletes the libraries too (audit 4 D-2).
- **Files left outside the list.** A photo's file reaches R2 before the
  list has it. If adding it to the list then fails (say the day's free
  writes are used up), the file would stay in R2 for good, counted nowhere.
  So once a week, a library with files deletes those in R2 that its list
  doesn't have, if they're over a day old (newer ones may still be on their
  way in). It starts with the first upload, so a library nobody uploads to
  is never woken. Audit finding B-7.

## Consequences

- All libraries together can grow to 1 TB, about $15 a month at most. Below
  10 GB it costs nothing. Until the owner's device moves the library after
  the account key is replaced, the old key can still read, delete or take
  it ([ADR 0010](0010-account-and-sync.md)); if it takes it, the owner's
  devices start a new one, as above.
- **What the servers can see:** how many photos, how big each part is, and
  when they're added or deleted. Never what they show, their names or
  dates.
- **What a server could do if it went wrong** (audit finding A-8). It can't
  read photos or change them, or pass one off as another: each part is
  sealed and labelled with its library, item and part. It could hide photos
  or changes, hold back new ones, delete what it keeps, or say the library
  was deleted (devices then keep the photos they have). It can't make a
  device delete a photo: a "deleted" note, in the list of changes or in
  the answer to an upload, counts only with the seal of the device that
  deleted the photo, made with the library's key for that library and that
  photo. Notes from before seals were added have none, so a device that
  hadn't caught up with one keeps that photo. Whoever controls the servers
  could still change the apps themselves.
- **Free plan requests:** an upload is one Worker request and four Durable
  Object requests (the library twice, `LibraryGate` twice); a screen of
  thumbnails is a few. A device checks for changes about once a minute while
  open. A full day of 10,000 uploads takes about 40,000 of the free plan's
  100,000 daily Durable Object requests, and as many of its row writes, which
  every app shares (it was 20,000 a day until 24 October 2026, which could
  have left too few for the other apps). Bigger imports take several days,
  or the Workers paid plan ($5 a month) lifts the daily limits.
- **The list's size:** about 400 bytes per photo in the Durable Object
  (about 160 MB at 400,000 photos), well inside 1 GB.
- **Deleted photos leave small notes for good** (audit 3 B-5): two rows
  for each, about 300 bytes together, for the library's life. One is the
  note that it was deleted, with the deleting device's seal, which a
  device that hasn't checked since must still see, however long it was
  away; the other marks its id as used, so an upload of it still on its
  way, or from such a device, is refused. No rule for removing them is safe: the
  server doesn't know the devices (one may come back after months), and
  without the sealed note a device can't tell a deleted photo from one a
  server hides (audit A-8), so it would put the photo back online. The
  400,000-photo limit, and the free-plan budget in
  `tests/unit/free-plan.test.ts`, count photos that are there, not these
  notes: 100,000 deletions add about 30 MB, still well inside 1 GB.
- **Uploads only while Photos is open.** Browsers don't upload in the
  background for a website.
- **A lost device** keeps whatever it already downloaded, and still knows
  the old key, so photos online before the key was replaced could be read
  if someone also got them from R2. Photos added after can't.
- **Previews** share one bucket, so a preview's "Delete the online copy"
  could delete files another preview made with the same account. Previews
  are for testing only, and their files expire after 7 days.

## Alternatives

- **Photos in the Durable Object, like Repairs** ([ADR 0014](0014-syncing-photos.md)):
  1 GB per account and 5 GB in all is far from 1 TB.
- **The list in the synced copy:** 1.4 MB holds about 10,000 photos, and
  each change would download the whole list.
- **Uploading straight to R2 with signed links:** R2's own address is
  another site, which the CSP and "own origin only" rule forbid, and it
  needs an R2 API key as another secret.
- **Three files per photo:** simpler to read, but three uploads per photo
  instead of one. Byte ranges read the one file in parts.
- **Re-sealing every photo when the account key is replaced:** downloading
  and uploading a terabyte again isn't practical. Only new photos get the
  new key.
- **Backblaze B2 or Wasabi:** cheaper per TB, but another company, another
  account and another origin for the browser to talk to.
