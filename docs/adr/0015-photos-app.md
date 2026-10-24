# 0015. The Photos app: original files on the device

Status: Accepted (2026-10-21). Builds on [ADR 0013](0013-photos-on-the-device.md)
(files on the device). Extended by [ADR 0016](0016-online-photo-library.md):
with sync on, the library is also online, in Cloudflare R2, and "Free up
space" can leave only the thumbnail on a device.

## Context

The owner wants a photo library that keeps the **original files** (not
smaller copies, as Repairs does) and can grow to about 1 TB, with the
photos online too. That's far more than other apps keep:

- Originals are 2–10 MB each (more for some phones), so 1 TB is 100,000 to
  300,000 photos.
- `localStorage` (about 5 MB) can't even hold the list of that many photos,
  and backup files are made from `localStorage`.
- Browsers can't show every kind of photo: HEIC (the iPhone's own format)
  shows only in Safari.

## Decision

This first part works on the device only, like every other app.

- **Everything in IndexedDB**, through `@shkriuss/storage/files`, which gains
  `all()` to list one kind of record. Each photo has two records:
  - `photo:<id>` holds its details (`Photo` in `src/lib/photos.ts`): when it
    was taken, its name, kind and size, its size in pixels, and its SHA-256.
    They're small, so the whole library loads at once.
  - `photo-files:<id>` holds the original file exactly as it was picked, a
    512-pixel JPEG thumbnail for the grid, and a 2,048-pixel JPEG for looking
    at it.

  The files are saved before the details, and deleted after them, so a
  photo never shows without its files.

- **Read in a worker** (`process.worker.ts`): the SHA-256 of the original,
  when it was taken, and the two copies. Big photos never freeze the page.
- **When it was taken:** for a JPEG, from what the camera wrote in it (Exif
  `DateTimeOriginal`, else `DateTime`, read by `src/lib/exif.ts`). Otherwise,
  from the file's own date. It's kept as the camera's local time
  (`"2026-10-21T14:03:22"`) with no time zone, so a photo stays in the same
  month wherever it's looked at.
- **Never twice:** a photo whose SHA-256 is already in the library isn't
  added again.
- **Photos a browser can't show** (like HEIC outside Safari) are still kept,
  original and all. They show their kind ("HEIC") instead of a thumbnail,
  and "Save original" still works.
- **The grid** groups photos by the month they were taken, newest first,
  120 at a time ("Show more"). Several can be chosen to save their originals
  or delete them.
- **No backup files** (`<DataControls backup={false} />`): photos are far too
  big for them. "Delete all data" deletes the photos, as in every app.

## Consequences

- Nothing leaves the device, and nothing costs anything.
- Each photo takes a little more room than its original, for the two copies:
  about 10–15%.
- How much a browser lets a site keep depends on the device's free space.
  The app shows how much more it can keep. A browser may clear it if the
  device runs out of space, though the app asks it not to (`keepFiles()`).
- There's no copy anywhere else until the photos are online (next part), or
  the person saves the originals themselves.
- Loading the list of all photos at once is fine for tens of thousands of
  photos. Much bigger libraries will want the list loaded a page at a time.

## Alternatives

- **Smaller copies only, like Repairs:** not what's wanted. The originals
  have the full detail and everything the camera wrote in them.
- **The list in `localStorage`, like other apps:** it can't hold a big
  library, and it would be the only part in backups.
- **Converting HEIC to JPEG:** that changes the original, and browsers other
  than Safari can't read HEIC to convert it anyway.
